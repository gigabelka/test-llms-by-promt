import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { GameCrypt } from "./GameCrypt";
import {
  GameOpcodes,
  ExtendedOpcode,
  ServerExtendedOpcode,
  ExtendedClientOpcodes,
} from "./opcodes";
import { check, logState, assertState } from "../debug/DebugTools";
import type { Config } from "../config";
import type { LoginResult } from "../login/LoginClient";

type GameState =
  | "WAIT_CRYPT_INIT"
  | "WAIT_CHAR_LIST"
  | "WAIT_CHAR_SELECTED"
  | "WAIT_USER_INFO"
  | "IN_GAME"
  | "DONE"
  | "FAIL";

export class GameClient {
  private conn = new Connection();
  private crypt = new GameCrypt();
  private state: GameState = "WAIT_CRYPT_INIT";
  private statePath = "IDLE";

  private resolve!: () => void;
  private reject!: (reason: Error) => void;
  private resolved = false;

  private unknownCount = 0;
  private readonly maxUnknown = 10;

  private charCount = 0;
  private encryptionFlag = 0;

  private answeredPingCount = 0;
  private enterWorldSent = false;
  private inGameTimer: NodeJS.Timeout | null = null;

  constructor(
    private cfg: Config,
    private result: LoginResult,
    private readonly phase: number = 3,
  ) {}

  run(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;

      this.conn.onConnect = () => {
        console.log("[game] connected");
        this.sendProtocolVersion();
      };

      this.conn.onPacket = (frame) => this.handlePacket(frame);

      this.conn.onClose = () => {
        if (this.resolved || this.state === "FAIL") return;
        this.fail("game connection closed unexpectedly");
      };

      this.conn.connect(this.result.gameHost, this.result.gamePort);
    });
  }

  getStatePath(): string {
    return this.statePath;
  }

  getEncryptionFlag(): number {
    return this.encryptionFlag;
  }

  getCharCount(): number {
    return this.charCount;
  }

  getAnsweredPingCount(): number {
    return this.answeredPingCount;
  }

  private transition(to: GameState): void {
    logState(this.state, to);
    this.statePath += ` -> ${to}`;
    this.state = to;
  }

  private handlePacket(frame: Buffer): void {
    if (this.state === "FAIL" || this.resolved) return;

    const body = frame.subarray(2);

    try {
      if (this.state === "WAIT_CRYPT_INIT") {
        this.handleCryptInit(body);
        return;
      }

      const decrypted = this.crypt.decrypt(body);
      const r = new PacketReader(decrypted);
      const opcode = this.readOpcode(r);

      switch (this.state) {
        case "WAIT_CHAR_LIST":
          if (opcode === GameOpcodes.CharSelectInfo) {
            this.handleCharSelectInfo(r);
          } else if (opcode === GameOpcodes.NetPingRequest) {
            this.handleNetPingRequest(r);
          } else {
            this.unexpected(opcode);
          }
          break;

        case "WAIT_CHAR_SELECTED":
          if (opcode === GameOpcodes.CharSelected) {
            this.transition("WAIT_USER_INFO");
            if (this.phase === 4) {
              this.sendEnterWorldSequence();
            } else {
              this.finish();
            }
          } else if (opcode === GameOpcodes.UserInfo) {
            // Server skipped CharSelected and jumped straight to UserInfo.
            this.transition("WAIT_USER_INFO");
            if (this.phase === 4) {
              this.sendEnterWorldSequence();
              this.printInGame();
              this.transition("IN_GAME");
              this.startInGameTimer();
            } else {
              this.finish();
            }
          } else if (opcode === GameOpcodes.NetPingRequest) {
            this.handleNetPingRequest(r);
          } else {
            this.unexpected(opcode);
          }
          break;

        case "WAIT_USER_INFO":
          if (opcode === GameOpcodes.UserInfo) {
            if (this.phase === 4) {
              this.sendEnterWorldSequence();
              this.printInGame();
              this.transition("IN_GAME");
              this.startInGameTimer();
            } else {
              this.finish();
            }
          } else if (opcode === GameOpcodes.NetPingRequest) {
            this.handleNetPingRequest(r);
          } else {
            this.unexpected(opcode);
          }
          break;

        case "IN_GAME":
          if (opcode === GameOpcodes.NetPingRequest) {
            this.handleNetPingRequest(r);
          }
          // Silently drop all non-ping packets once IN_GAME.
          break;

        default:
          break;
      }
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private readOpcode(r: PacketReader): number {
    const opcode = r.readUInt8();
    if (opcode === ServerExtendedOpcode) {
      return r.readUInt16LE();
    }
    return opcode;
  }

  private handleCryptInit(body: Buffer): void {
    assertState(this.state, "WAIT_CRYPT_INIT", "handleCryptInit");
    const r = new PacketReader(body);
    const opcode = r.readUInt8();
    if (opcode !== GameOpcodes.CryptInit) {
      throw new Error(
        `Expected CryptInit opcode 0x${GameOpcodes.CryptInit.toString(16)}, got 0x${opcode.toString(16)}`,
      );
    }

    r.readUInt8(); // status
    const xorKey = r.readBytes(8);
    this.encryptionFlag = r.readInt32LE();

    this.crypt.init(xorKey, this.encryptionFlag !== 0);
    if (
      !check(
        "crypt flag honored",
        this.crypt.isEnabled() === (this.encryptionFlag !== 0),
      )
    ) {
      this.fail("crypt flag self-test failed");
      return;
    }

    this.transition("WAIT_CHAR_LIST");
    this.sendAuthRequest();
  }

  private handleCharSelectInfo(r: PacketReader): void {
    assertState(this.state, "WAIT_CHAR_LIST", "handleCharSelectInfo");
    this.charCount = r.readInt32LE();
    if (!check("charCount >= 1", this.charCount >= 1)) {
      this.fail(`charCount ${this.charCount} is less than 1`);
      return;
    }

    this.transition("WAIT_CHAR_SELECTED");
    this.sendCharacterSelected();
  }

  private handleNetPingRequest(r: PacketReader): void {
    const pingId = r.readInt32LE();
    const w = new PacketWriter()
      .writeUInt8(GameOpcodes.NetPing)
      .writeInt32LE(pingId)
      .writeInt32LE(0x00000000)
      .writeInt32LE(0x00080000);
    this.send(w.toBuffer());
    this.answeredPingCount++;
  }

  private sendProtocolVersion(): void {
    const w = new PacketWriter()
      .writeUInt8(GameOpcodes.ProtocolVersion)
      .writeInt32LE(this.cfg.protocol);
    // ProtocolVersion is always sent raw (before CryptInit).
    this.conn.send(w.toBuffer());
  }

  private sendAuthRequest(): void {
    const w = new PacketWriter()
      .writeUInt8(GameOpcodes.AuthRequest)
      .writeStringNullUTF16(this.cfg.username)
      .writeInt32LE(this.result.playOkId2)
      .writeInt32LE(this.result.playOkId1)
      .writeInt32LE(this.result.loginOkId1)
      .writeInt32LE(this.result.loginOkId2);

    this.send(w.toBuffer());
  }

  private sendCharacterSelected(): void {
    const w = new PacketWriter()
      .writeUInt8(GameOpcodes.CharacterSelected)
      .writeInt32LE(this.cfg.charSlot)
      .writeBytes(Buffer.alloc(14));

    this.send(w.toBuffer());
  }

  private sendRequestKeyMapping(): void {
    const w = new PacketWriter()
      .writeUInt8(ExtendedOpcode)
      .writeUInt16LE(ExtendedClientOpcodes.RequestKeyMapping);
    this.send(w.toBuffer());
  }

  private sendEnterWorld(): void {
    const w = new PacketWriter()
      .writeUInt8(GameOpcodes.EnterWorld)
      .writeBytes(Buffer.alloc(104));
    this.send(w.toBuffer());
  }

  private sendEnterWorldSequence(): void {
    if (this.enterWorldSent) return;
    this.enterWorldSent = true;
    this.sendRequestKeyMapping();
    this.sendEnterWorld();
  }

  private printInGame(): void {
    console.log("IN_GAME");
  }

  private startInGameTimer(): void {
    this.clearInGameTimer();
    this.inGameTimer = setTimeout(() => {
      console.log("[game] 60s keepalive elapsed, closing");
      this.finish();
    }, 60000);
  }

  private clearInGameTimer(): void {
    if (this.inGameTimer) {
      clearTimeout(this.inGameTimer);
      this.inGameTimer = null;
    }
  }

  private send(body: Buffer): void {
    const encrypted = this.crypt.encrypt(body);
    this.conn.send(encrypted);
  }

  private unexpected(opcode: number): void {
    if (this.state === "WAIT_CHAR_SELECTED" || this.state === "WAIT_USER_INFO") {
      this.unknownCount++;
      console.log(
        `[game] tolerating unknown opcode 0x${opcode.toString(16)} in ${this.state} (${this.unknownCount}/${this.maxUnknown})`,
      );
      if (this.unknownCount <= this.maxUnknown) {
        return;
      }
    }
    this.fail(`unexpected opcode 0x${opcode.toString(16)} in state ${this.state}`);
  }

  private fail(message: string): void {
    if (this.resolved || this.state === "FAIL") return;
    this.transition("FAIL");
    this.clearInGameTimer();
    console.log(`FAIL: ${message}`);
    this.conn.close();
    this.reject(new Error(message));
  }

  private finish(): void {
    if (this.resolved) return;
    this.resolved = true;
    this.clearInGameTimer();
    this.conn.close();
    this.resolve();
  }
}
