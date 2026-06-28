import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { GameCrypt } from "./GameCrypt";
import { DebugTools } from "../debug/DebugTools";
import { GameServer, ServerExtendedOpcode } from "./opcodes";
import { Config } from "../config";

export interface GamePhaseInput {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
}

export interface GamePhase3Result {
  state: string;
}

enum State {
  WAIT_CRYPT_INIT = "WAIT_CRYPT_INIT",
  WAIT_CHAR_LIST = "WAIT_CHAR_LIST",
  WAIT_CHAR_SELECTED = "WAIT_CHAR_SELECTED",
  WAIT_USER_INFO = "WAIT_USER_INFO",
  FAIL = "FAIL",
}

export class GameClient {
  private conn = new Connection();
  private gameCrypt = new GameCrypt();
  private dt: DebugTools;
  private cfg: Config;
  private input: GamePhaseInput;

  private state: State = State.WAIT_CRYPT_INIT;
  private encryptionFlag = 0;

  // Promise resolvers
  private resolve!: (result: GamePhase3Result) => void;
  private reject!: (err: Error) => void;

  constructor(dt: DebugTools, cfg: Config, input: GamePhaseInput) {
    this.dt = dt;
    this.cfg = cfg;
    this.input = input;

    this.conn.onPacket = (frame) => this.handlePacket(frame);
    this.conn.onConnect = () => this.onConnected();
    this.conn.onClose = () => {
      if (this.state !== State.WAIT_USER_INFO && this.state !== State.FAIL) {
        this.fail("Connection closed unexpectedly");
      }
    };
  }

  async run(): Promise<GamePhase3Result> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.conn.connect(this.input.gameHost, this.input.gamePort);
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
    // Send ProtocolVersion immediately on connect, raw (no encryption)
    const w = new PacketWriter();
    w.writeUInt8(GameServer.ProtocolVersion); // 0x0E
    w.writeInt32LE(this.cfg.protocol);
    this.conn.send(w.toBuffer());
  }

  private handlePacket(frame: Buffer): void {
    try {
      if (this.state === State.WAIT_USER_INFO || this.state === State.FAIL) return;

      // Extract body from frame (skip 2-byte size prefix)
      let body = frame.subarray(2);

      // CryptInit is always unencrypted.
      // After CryptInit, decrypt if encryption is enabled.
      if (this.state !== State.WAIT_CRYPT_INIT) {
        body = this.gameCrypt.decrypt(body);
      }

      const opcode = body[0]!;
      this.dispatch(opcode, body);
    } catch (err: any) {
      this.fail(`Packet handling error: ${err.message}`);
    }
  }

  private dispatch(opcode: number, body: Buffer): void {
    switch (this.state) {
      case State.WAIT_CRYPT_INIT:
        if (opcode === GameServer.CryptInit) {
          this.handleCryptInit(body);
        } else {
          this.fail(
            `Expected CryptInit (0x2E), got 0x${opcode.toString(16)}`,
          );
        }
        break;

      case State.WAIT_CHAR_LIST:
        if (opcode === GameServer.CharSelectInfo) {
          this.handleCharSelectInfo(body);
        } else if (opcode === ServerExtendedOpcode) {
          // Silently ignore server-extended packets while waiting
        } else {
          this.fail(
            `Expected CharSelectInfo (0x09), got 0x${opcode.toString(16)}`,
          );
        }
        break;

      case State.WAIT_CHAR_SELECTED:
        if (opcode === GameServer.CharSelectedConfirm) {
          this.handleCharSelectedConfirm(body);
        } else if (opcode === GameServer.UserInfo) {
          // Tolerate skip: server sent UserInfo instead of CharSelected
          this.handleUserInfo();
        } else if (opcode === ServerExtendedOpcode) {
          // Silently ignore server-extended packets while waiting
        } else {
          this.fail(
            `Expected CharSelected (0x0B) or UserInfo (0x32), got 0x${opcode.toString(16)}`,
          );
        }
        break;

      default:
        break;
    }
  }

  private handleCryptInit(body: Buffer): void {
    // CryptInit: C 0x2E + C status + b[8] xorKey + D encryptionFlag + rest
    const r = new PacketReader(body, 1); // skip opcode
    r.readUInt8(); // status (unused but advances reader)
    const xorKey = r.readBytes(8);
    this.encryptionFlag = r.readInt32LE();

    const enable = this.encryptionFlag !== 0;
    this.gameCrypt.init(xorKey, enable);

    // Self-test: crypt flag honored
    if (
      !this.dt.check(
        "crypt flag honored",
        this.gameCrypt.isEnabled() === (this.encryptionFlag !== 0),
      )
    ) {
      this.fail("Crypt flag self-test failed");
      return;
    }

    // Send AuthRequest
    this.transition(State.WAIT_CHAR_LIST);
    this.sendAuthRequest();
  }

  private sendAuthRequest(): void {
    // AuthRequest: C 0x2B + S username + D playOkId2 + D playOkId1 + D loginOkId1 + D loginOkId2
    // No trailing language field (HighFive).
    const w = new PacketWriter();
    w.writeUInt8(GameServer.AuthRequest); // 0x2B
    w.writeStringNullUTF16(this.cfg.username);
    w.writeInt32LE(this.input.playOkId2);
    w.writeInt32LE(this.input.playOkId1);
    w.writeInt32LE(this.input.loginOkId1);
    w.writeInt32LE(this.input.loginOkId2);

    const body = w.toBuffer();
    const toSend = this.gameCrypt.encrypt(body);
    this.conn.send(toSend);
  }

  private handleCharSelectInfo(body: Buffer): void {
    // CharSelectInfo: C 0x09 + D charCount + per-character data
    const r = new PacketReader(body, 1); // skip opcode
    const charCount = r.readInt32LE();

    console.log(`Character count: ${charCount}`);

    // Self-test: charCount >= 1
    if (!this.dt.check("charCount >= 1", charCount >= 1)) {
      this.fail("charCount self-test failed");
      return;
    }

    // Send CharacterSelected
    this.transition(State.WAIT_CHAR_SELECTED);
    this.sendCharacterSelected();
  }

  private sendCharacterSelected(): void {
    // CharacterSelected: C 0x12 + D L2_CHAR_SLOT + 14 zero bytes
    const w = new PacketWriter();
    w.writeUInt8(GameServer.CharacterSelected); // 0x12
    w.writeInt32LE(this.cfg.charSlot);
    w.writeBytes(Buffer.alloc(14, 0));

    const body = w.toBuffer();
    const toSend = this.gameCrypt.encrypt(body);
    this.conn.send(toSend);
  }

  private handleCharSelectedConfirm(_body: Buffer): void {
    // CharSelected confirm (0x0B) — character selected, we're done
    this.transition(State.WAIT_USER_INFO);
    this.finish();
  }

  private handleUserInfo(): void {
    // UserInfo arrived instead of CharSelected — server skipped the confirm
    this.transition(State.WAIT_USER_INFO);
    this.finish();
  }

  private finish(): void {
    this.conn.close();
    this.resolve({ state: "WAIT_USER_INFO" });
  }
}
