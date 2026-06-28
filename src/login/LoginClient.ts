import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { unscrambleModulus } from "../crypto/ScrambledRsaKey";
import { encryptCredentials } from "../crypto/RsaCrypt";
import { DebugTools } from "../debug/DebugTools";
import { LoginServer } from "../game/opcodes";
import { Config } from "../config";

export interface LoginResult {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
}

enum State {
  WAIT_INIT = "WAIT_INIT",
  WAIT_GG_AUTH = "WAIT_GG_AUTH",
  WAIT_LOGIN_OK = "WAIT_LOGIN_OK",
  WAIT_SERVER_LIST = "WAIT_SERVER_LIST",
  WAIT_PLAY_OK = "WAIT_PLAY_OK",
  DONE = "DONE",
  FAIL = "FAIL",
}

export class LoginClient {
  private conn = new Connection();
  private loginCrypt = new LoginCrypt();
  private dt: DebugTools;
  private cfg: Config;

  private state: State = State.WAIT_INIT;
  private sessionId = 0;
  private unscrambledModulus: Buffer | null = null;
  private ggResponse = 0;
  private loginOkId1 = 0;
  private loginOkId2 = 0;
  private playOkId1 = 0;
  private playOkId2 = 0;
  private gameHost = "";
  private gamePort = 0;

  // Promise resolvers
  private resolve!: (result: LoginResult) => void;
  private reject!: (err: Error) => void;

  constructor(dt: DebugTools, cfg: Config) {
    this.dt = dt;
    this.cfg = cfg;
    this.conn.onPacket = (frame) => this.handlePacket(frame);
    this.conn.onConnect = () => this.onConnected();
    this.conn.onClose = () => {
      if (
        this.state !== State.DONE &&
        this.state !== State.FAIL
      ) {
        this.fail("Connection closed unexpectedly");
      }
    };
  }

  async run(): Promise<LoginResult> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.conn.connect(this.cfg.loginIp, this.cfg.loginPort);
    });
  }

  private transition(newState: State): void {
    this.dt.logState(this.state, newState);
    this.state = newState;
  }

  private fail(reason: string): void {
    console.log(`FAIL: ${reason}`);
    this.transition(State.FAIL);
    this.conn.close();
    this.reject(new Error(reason));
  }

  private onConnected(): void {
    // Nothing to do — wait for Init from server.
  }

  private handlePacket(frame: Buffer): void {
    try {
      if (this.state === State.DONE || this.state === State.FAIL) return;

      // The frame includes the 2-byte size prefix. Body starts at offset 2.
      let body = frame.subarray(2);
      let opcode: number;

      // Decrypt based on state
      if (this.state === State.WAIT_INIT) {
        // Init packet is specially decrypted
        const decrypted = this.loginCrypt.decryptInit(body);
        opcode = decrypted[0]!;
        body = decrypted;
      } else {
        // All other packets use normal decrypt
        const decrypted = this.loginCrypt.decrypt(body);
        opcode = decrypted[0]!;
        body = decrypted;
      }

      this.dispatch(opcode, body);
    } catch (err: any) {
      this.fail(`Packet handling error: ${err.message}`);
    }
  }

  private dispatch(opcode: number, body: Buffer): void {
    switch (this.state) {
      case State.WAIT_INIT:
        if (opcode === LoginServer.Init) {
          this.handleInit(body);
        } else {
          this.fail(`Expected Init (0x00), got 0x${opcode.toString(16)}`);
        }
        break;

      case State.WAIT_GG_AUTH:
        if (opcode === LoginServer.GGAuth) {
          this.handleGGAuth(body);
        } else if (opcode === LoginServer.LoginOk) {
          // Skipped GGAuth edge case
          this.ggResponse = 0;
          this.handleLoginOk(body);
        } else if (opcode === LoginServer.LoginFail) {
          this.handleLoginFail(body);
        } else {
          this.fail(
            `Unexpected opcode in WAIT_GG_AUTH: 0x${opcode.toString(16)}`,
          );
        }
        break;

      case State.WAIT_LOGIN_OK:
        if (opcode === LoginServer.LoginOk) {
          this.handleLoginOk(body);
        } else if (opcode === LoginServer.LoginFail) {
          this.handleLoginFail(body);
        } else {
          this.fail(
            `Unexpected opcode in WAIT_LOGIN_OK: 0x${opcode.toString(16)}`,
          );
        }
        break;

      case State.WAIT_SERVER_LIST:
        if (opcode === LoginServer.ServerList) {
          this.handleServerList(body);
        } else {
          this.fail(
            `Unexpected opcode in WAIT_SERVER_LIST: 0x${opcode.toString(16)}`,
          );
        }
        break;

      case State.WAIT_PLAY_OK:
        if (opcode === LoginServer.PlayOk) {
          this.handlePlayOk(body);
        } else if (opcode === LoginServer.PlayFail) {
          this.fail(`PlayFail (0x${opcode.toString(16)})`);
        } else {
          this.fail(
            `Unexpected opcode in WAIT_PLAY_OK: 0x${opcode.toString(16)}`,
          );
        }
        break;

      default:
        break;
    }
  }

  private handleInit(body: Buffer): void {
    const r = new PacketReader(body, 1); // skip opcode

    this.sessionId = r.readInt32LE();
    const protocolRev = r.readInt32LE();
    const scrambledModulus = r.readBytes(128);
    const _unknown = r.readBytes(16); // skip
    const blowfishKey = r.readBytes(16);

    // Unscramble the RSA modulus
    const unscrambled = unscrambleModulus(scrambledModulus);
    this.unscrambledModulus = unscrambled;

    // Self-test: modulus is 128 bytes (Phase 2: failing check does NOT halt)
    this.dt.check("modulus is 128 bytes", unscrambled.length === 128);

    // Set the session key on LoginCrypt for all subsequent packets
    this.loginCrypt.setSessionKey(blowfishKey);

    // Send RequestGGAuth
    this.transition(State.WAIT_GG_AUTH);
    this.sendRequestGGAuth();
  }

  private sendRequestGGAuth(): void {
    // RequestGGAuth: C 0x07 + D sessionId + four D GG constants + 19 zero bytes
    const w = new PacketWriter();
    w.writeUInt8(LoginServer.RequestGGAuth); // 0x07
    w.writeInt32LE(this.sessionId);
    // Four GG constants as D (int32LE)
    w.writeInt32LE(0x00000123);
    w.writeInt32LE(0x00004567);
    w.writeInt32LE(0x000089ab);
    w.writeInt32LE(0x0000cdef);
    // 19 zero bytes
    w.writeBytes(Buffer.alloc(19, 0));

    const body = w.toBuffer();
    const encrypted = this.loginCrypt.encrypt(body);
    this.conn.send(encrypted);
  }

  private handleGGAuth(body: Buffer): void {
    // GGAuth: C 0x0B + D response
    const r = new PacketReader(body, 1); // skip opcode
    this.ggResponse = r.readInt32LE();

    // Send RequestAuthLogin
    this.transition(State.WAIT_LOGIN_OK);
    this.sendRequestAuthLogin();
  }

  private sendRequestAuthLogin(): void {
    if (!this.unscrambledModulus) {
      this.fail("No modulus for RSA encryption");
      return;
    }

    const rsaCiphertext = encryptCredentials(
      this.cfg.username,
      this.cfg.password,
      this.unscrambledModulus,
    );

    // RequestAuthLogin: C 0x00 + b[128] RSA ciphertext + D ggResponse + fixed 43-byte GG block
    const w = new PacketWriter();
    w.writeUInt8(LoginServer.RequestAuthLogin); // 0x00
    w.writeBytes(rsaCiphertext); // 128 bytes
    w.writeInt32LE(this.ggResponse);

    // Fixed 43-byte GG block
    const ggBlock = Buffer.from([
      0x23, 0x01, 0x00, 0x00, 0x67, 0x45, 0x00, 0x00, 0xab, 0x89, 0x00, 0x00,
      0xef, 0xcd, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    w.writeBytes(ggBlock);

    const body = w.toBuffer();
    const encrypted = this.loginCrypt.encrypt(body);
    this.conn.send(encrypted);
  }

  private handleLoginOk(body: Buffer): void {
    // LoginOk: C 0x03 + D loginOkId1 + D loginOkId2
    const r = new PacketReader(body, 1); // skip opcode
    this.loginOkId1 = r.readInt32LE();
    this.loginOkId2 = r.readInt32LE();

    // Send RequestServerList
    this.transition(State.WAIT_SERVER_LIST);
    this.sendRequestServerList();
  }

  private handleLoginFail(body: Buffer): void {
    const reason = body.length >= 2 ? body[1] : 0;
    this.fail(`LoginFail — reason code: ${reason}`);
  }

  private sendRequestServerList(): void {
    // RequestServerList: C 0x05 + D loginOkId1 + D loginOkId2 + D 0x04000000
    const w = new PacketWriter();
    w.writeUInt8(LoginServer.RequestServerList); // 0x05
    w.writeInt32LE(this.loginOkId1);
    w.writeInt32LE(this.loginOkId2);
    w.writeInt32LE(0x04000000);

    const body = w.toBuffer();
    const encrypted = this.loginCrypt.encrypt(body);
    this.conn.send(encrypted);
  }

  private handleServerList(body: Buffer): void {
    // ServerList: C 0x04 + C serverCount + C 0x00, then serverCount records
    const r = new PacketReader(body, 1); // skip opcode
    const serverCount = r.readUInt8();
    r.skip(1); // skip 0x00 byte

    let found = false;
    for (let i = 0; i < serverCount; i++) {
      const id = r.readUInt8();
      const ipBytes = r.readBytes(4); // 4 bytes IP
      const port = r.readInt32LE();
      const _ageLimit = r.readUInt8();
      const _pvp = r.readUInt8();
      const _online = r.readUInt16LE();
      const _maxPlayers = r.readUInt16LE();
      const _status = r.readUInt8();
      r.skip(4); // D 0
      r.skip(1); // C 0

      if (id === this.cfg.serverId) {
        this.gameHost = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;
        this.gamePort = port;
        found = true;
        break;
      }
    }

    if (!found) {
      this.fail(`Server id ${this.cfg.serverId} not found in server list`);
      return;
    }

    // Send RequestServerLogin
    this.transition(State.WAIT_PLAY_OK);
    this.sendRequestServerLogin();
  }

  private sendRequestServerLogin(): void {
    // RequestServerLogin: C 0x02 + D loginOkId1 + D loginOkId2 + C serverId
    const w = new PacketWriter();
    w.writeUInt8(LoginServer.RequestServerLogin); // 0x02
    w.writeInt32LE(this.loginOkId1);
    w.writeInt32LE(this.loginOkId2);
    w.writeUInt8(this.cfg.serverId);

    const body = w.toBuffer();
    const encrypted = this.loginCrypt.encrypt(body);
    this.conn.send(encrypted);
  }

  private handlePlayOk(body: Buffer): void {
    // PlayOk: C 0x07 + D playOkId1 + D playOkId2
    const r = new PacketReader(body, 1); // skip opcode
    this.playOkId1 = r.readInt32LE();
    this.playOkId2 = r.readInt32LE();

    this.transition(State.DONE);
    this.conn.close();

    // Build result
    const result: LoginResult = {
      loginOkId1: this.loginOkId1,
      loginOkId2: this.loginOkId2,
      playOkId1: this.playOkId1,
      playOkId2: this.playOkId2,
      gameHost: this.gameHost,
      gamePort: this.gamePort,
    };

    this.resolve(result);
  }
}
