import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { encryptCredentials } from "../crypto/RsaCrypt";
import { unscrambleModulus } from "../crypto/ScrambledRsaKey";
import { LoginOpcodes } from "../game/opcodes";
import { check, logState, assertState } from "../debug/DebugTools";
import type { Config } from "../config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LoginResult {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
}

type LoginState =
  | "WAIT_INIT"
  | "WAIT_GG_AUTH"
  | "WAIT_LOGIN_OK"
  | "WAIT_SERVER_LIST"
  | "WAIT_PLAY_OK"
  | "DONE"
  | "FAIL";

const FIXED_GG_BLOCK = Buffer.from([
  0x23, 0x01, 0x00, 0x00, 0x67, 0x45, 0x00, 0x00, 0xab, 0x89, 0x00, 0x00,
  0xef, 0xcd, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const GG_CONSTANTS = [0x00000123, 0x00004567, 0x000089ab, 0x0000cdef];

export class LoginClient {
  private conn = new Connection();
  private state: LoginState = "WAIT_INIT";
  private statePath = "IDLE";
  private crypt = new LoginCrypt();

  private sessionId = 0;
  private ggResponse = 0;
  private loginOkId1 = 0;
  private loginOkId2 = 0;
  private playOkId1 = 0;
  private playOkId2 = 0;
  private gameHost = "";
  private gamePort = 0;
  private unscrambledModulus = Buffer.alloc(0);

  private resolve!: (value: LoginResult) => void;
  private reject!: (reason: Error) => void;

  constructor(
    private cfg: Config,
    private readonly writeArtifact = true,
  ) {}

  run(): Promise<LoginResult> {
    return new Promise<LoginResult>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;

      this.conn.onConnect = () => {
        console.log("[login] connected");
      };

      this.conn.onPacket = (frame) => this.handlePacket(frame);

      this.conn.onClose = () => {
        if (this.state !== "DONE" && this.state !== "FAIL") {
          this.fail("connection closed unexpectedly");
        }
      };

      this.conn.connect(this.cfg.loginIp, this.cfg.loginPort);
    });
  }

  private transition(to: LoginState): void {
    logState(this.state, to);
    this.statePath += ` -> ${to}`;
    this.state = to;
  }

  private handlePacket(frame: Buffer): void {
    // frame includes 2-byte LE size prefix
    const body = frame.subarray(2);

    try {
      if (this.state === "WAIT_INIT") {
        this.handleInit(body);
        return;
      }

      const decrypted = this.crypt.decrypt(body);
      const r = new PacketReader(decrypted);
      const opcode = r.readUInt8();

      switch (this.state) {
        case "WAIT_GG_AUTH":
          if (opcode === LoginOpcodes.LoginOk) {
            // Skipped-GGAuth edge case.
            this.ggResponse = 0;
            this.transition("WAIT_LOGIN_OK");
            this.handleLoginOk(r);
          } else if (opcode === LoginOpcodes.GGAuth) {
            this.handleGGAuth(r);
          } else {
            this.unexpected(opcode);
          }
          break;
        case "WAIT_LOGIN_OK":
          if (opcode === LoginOpcodes.LoginOk) {
            this.handleLoginOk(r);
          } else if (opcode === LoginOpcodes.LoginFail) {
            this.handleLoginFail(r);
          } else {
            this.unexpected(opcode);
          }
          break;
        case "WAIT_SERVER_LIST":
          if (opcode === LoginOpcodes.ServerList) {
            this.handleServerList(r);
          } else {
            this.unexpected(opcode);
          }
          break;
        case "WAIT_PLAY_OK":
          if (opcode === LoginOpcodes.PlayOk) {
            this.handlePlayOk(r);
          } else if (opcode === LoginOpcodes.PlayFail) {
            this.handlePlayFail(r);
          } else {
            this.unexpected(opcode);
          }
          break;
        default:
          break;
      }
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private handleInit(body: Buffer): void {
    assertState(this.state, "WAIT_INIT", "handleInit");
    const decrypted = this.crypt.decryptInit(body);
    const r = new PacketReader(decrypted);
    const opcode = r.readUInt8();
    if (opcode !== LoginOpcodes.Init) {
      throw new Error(`Expected Init opcode 0x00, got 0x${opcode.toString(16)}`);
    }

    this.sessionId = r.readInt32LE();
    r.skip(4); // protocol revision

    const scrambledModulus = r.readBytes(128);
    this.unscrambledModulus = Buffer.from(unscrambleModulus(scrambledModulus));
    check("modulus is 128 bytes", this.unscrambledModulus.length === 128);

    r.skip(16); // unknown
    const blowfishKey = r.readBytes(16);

    this.crypt.setSessionKey(blowfishKey);

    this.transition("WAIT_GG_AUTH");
    this.sendRequestGGAuth();
  }

  private sendRequestGGAuth(): void {
    const w = new PacketWriter()
      .writeUInt8(LoginOpcodes.RequestGGAuth)
      .writeInt32LE(this.sessionId);
    for (const c of GG_CONSTANTS) {
      w.writeInt32LE(c);
    }
    w.writeBytes(Buffer.alloc(19));

    this.send(w.toBuffer());
  }

  private handleGGAuth(r: PacketReader): void {
    assertState(this.state, "WAIT_GG_AUTH", "handleGGAuth");
    this.ggResponse = r.readInt32LE();

    this.transition("WAIT_LOGIN_OK");
    this.sendRequestAuthLogin();
  }

  private sendRequestAuthLogin(): void {
    const rsaCipher = encryptCredentials(
      this.cfg.username,
      this.cfg.password,
      this.unscrambledModulus,
    );

    const w = new PacketWriter()
      .writeUInt8(LoginOpcodes.RequestAuthLogin)
      .writeBytes(rsaCipher)
      .writeInt32LE(this.ggResponse)
      .writeBytes(FIXED_GG_BLOCK);

    this.send(w.toBuffer());
  }

  private handleLoginOk(r: PacketReader): void {
    assertState(this.state, "WAIT_LOGIN_OK", "handleLoginOk");
    this.loginOkId1 = r.readInt32LE();
    this.loginOkId2 = r.readInt32LE();

    this.transition("WAIT_SERVER_LIST");
    this.sendRequestServerList();
  }

  private handleLoginFail(r: PacketReader): void {
    const reason = r.readUInt8();
    this.fail(`LoginFail reason=0x${reason.toString(16)}`);
  }

  private sendRequestServerList(): void {
    const w = new PacketWriter()
      .writeUInt8(LoginOpcodes.RequestServerList)
      .writeInt32LE(this.loginOkId1)
      .writeInt32LE(this.loginOkId2)
      .writeInt32LE(0x04000000);

    this.send(w.toBuffer());
  }

  private handleServerList(r: PacketReader): void {
    assertState(this.state, "WAIT_SERVER_LIST", "handleServerList");
    const serverCount = r.readUInt8();
    r.skip(1); // 0x00

    let found = false;
    for (let i = 0; i < serverCount; i++) {
      const id = r.readUInt8();
      const ipBytes = r.readBytes(4);
      const port = r.readInt32LE();
      r.skip(1); // ageLimit
      r.skip(1); // pvp
      r.skip(2); // online
      r.skip(2); // maxPlayers
      r.skip(1); // status
      r.skip(4); // 0
      r.skip(1); // 0

      if (id === this.cfg.serverId) {
        this.gameHost = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;
        this.gamePort = port;
        found = true;
      }
    }

    if (!found) {
      this.fail(`server id ${this.cfg.serverId} not found in server list`);
      return;
    }

    this.transition("WAIT_PLAY_OK");
    this.sendRequestServerLogin();
  }

  private sendRequestServerLogin(): void {
    const w = new PacketWriter()
      .writeUInt8(LoginOpcodes.RequestServerLogin)
      .writeInt32LE(this.loginOkId1)
      .writeInt32LE(this.loginOkId2)
      .writeUInt8(this.cfg.serverId);

    this.send(w.toBuffer());
  }

  private handlePlayOk(r: PacketReader): void {
    assertState(this.state, "WAIT_PLAY_OK", "handlePlayOk");
    this.playOkId1 = r.readInt32LE();
    this.playOkId2 = r.readInt32LE();

    this.transition("DONE");
    this.conn.close();

    const result: LoginResult = {
      loginOkId1: this.loginOkId1,
      loginOkId2: this.loginOkId2,
      playOkId1: this.playOkId1,
      playOkId2: this.playOkId2,
      gameHost: this.gameHost,
      gamePort: this.gamePort,
    };

    if (this.writeArtifact) {
      writeFileSync(
        join(process.cwd(), "artifacts", "phase-2-output.json"),
        JSON.stringify(result, null, 2),
      );
    }

    this.resolve(result);
  }

  private handlePlayFail(r: PacketReader): void {
    const reason = r.readUInt8();
    this.fail(`PlayFail reason=0x${reason.toString(16)}`);
  }

  private send(body: Buffer): void {
    const encrypted = this.crypt.encrypt(body);
    this.conn.send(encrypted);
  }

  private unexpected(opcode: number): void {
    this.fail(`unexpected opcode 0x${opcode.toString(16)} in state ${this.state}`);
  }

  private fail(message: string): void {
    if (this.state === "FAIL" || this.state === "DONE") return;
    this.transition("FAIL");
    console.log(`FAIL: ${message}`);
    this.conn.close();
    this.reject(new Error(message));
  }

  getStatePath(): string {
    return this.statePath;
  }
}
