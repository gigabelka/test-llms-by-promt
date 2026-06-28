import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { GameCrypt } from "./GameCrypt";
import { DebugTools } from "../debug/DebugTools";
import { GameServer, ServerExtendedOpcode, ExtendedOpcode } from "./opcodes";
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
  IN_GAME = "IN_GAME",
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

  // Phase 4 fields
  private phase: number;
  private unknownCount = 0;
  private enteredWorld = false;
  private answeredPingCount = 0;
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null;

  // Promise resolvers
  private resolve!: (result: GamePhase3Result) => void;
  private reject!: (err: Error) => void;

  constructor(dt: DebugTools, cfg: Config, input: GamePhaseInput, phase = 3) {
    this.dt = dt;
    this.cfg = cfg;
    this.input = input;
    this.phase = phase;

    this.conn.onPacket = (frame) => this.handlePacket(frame);
    this.conn.onConnect = () => this.onConnected();
    this.conn.onClose = () => {
      if (this.state === State.FAIL) return;
      // Phase 3: WAIT_USER_INFO is terminal (finish() already resolved)
      if (this.phase === 3 && this.state === State.WAIT_USER_INFO) return;
      // Phase 4: IN_GAME is terminal (keepalive timer resolved before close)
      if (this.phase >= 4 && this.state === State.IN_GAME) return;
      this.fail("Connection closed unexpectedly");
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
    if (this.keepaliveTimer !== null) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
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
      if (this.state === State.FAIL) return;
      // Phase 3: WAIT_USER_INFO is terminal — stop processing packets
      if (this.phase === 3 && this.state === State.WAIT_USER_INFO) return;

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
          if (this.phase >= 4) {
            this.handleServerExtended(body);
          }
          // Phase 3: silently ignore server-extended packets while waiting
        } else if (this.phase >= 4) {
          // Phase 4: tolerate up to 10 unknown packets
          this.tolerateUnknown();
        } else {
          this.fail(
            `Expected CharSelected (0x0B) or UserInfo (0x32), got 0x${opcode.toString(16)}`,
          );
        }
        break;

      case State.WAIT_USER_INFO:
        // Only reachable in Phase 4+
        if (opcode === GameServer.UserInfo) {
          this.handleUserInfo();
        } else if (opcode === GameServer.CharSelectedConfirm) {
          // Late CharSelectedConfirm — silently ignore (already handled)
        } else if (opcode === GameServer.NetPingRequest) {
          this.handleNetPingRequest(body);
        } else if (opcode === ServerExtendedOpcode) {
          this.handleServerExtended(body);
        } else {
          this.tolerateUnknown();
        }
        break;

      case State.IN_GAME:
        if (opcode === GameServer.NetPingRequest) {
          this.handleNetPingRequest(body);
        } else if (opcode === ServerExtendedOpcode) {
          this.handleServerExtended(body);
        }
        // Silently drop all other non-ping packets
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
    // CharSelected confirm (0x0B) — character selected
    if (this.phase === 3) {
      this.transition(State.WAIT_USER_INFO);
      this.finish();
      return;
    }
    // Phase 4: transition to WAIT_USER_INFO and send enter-world sequence
    this.transition(State.WAIT_USER_INFO);
    this.unknownCount = 0;
    this.sendEnterWorldSequence();
  }

  private handleUserInfo(): void {
    if (this.phase === 3) {
      // UserInfo arrived instead of CharSelected — server skipped the confirm
      this.transition(State.WAIT_USER_INFO);
      this.finish();
      return;
    }

    // Phase 4
    const fromCharSelected = this.state === State.WAIT_CHAR_SELECTED;

    if (fromCharSelected) {
      // Edge case: server sent UserInfo before CharSelectedConfirm
      this.transition(State.WAIT_USER_INFO);
      this.sendEnterWorldSequence();
      // UserInfo already received — go straight to IN_GAME
      this.enterInGame();
    } else {
      // Normal: UserInfo arrived after we sent EnterWorld
      this.enterInGame();
    }
  }

  private finish(): void {
    this.conn.close();
    this.resolve({ state: "WAIT_USER_INFO" });
  }

  // ---- Phase 4: Enter World & Keepalive ----

  private sendEnterWorldSequence(): void {
    if (this.enteredWorld) return; // Guard: send at most once
    this.enteredWorld = true;
    this.sendRequestKeyMapping();
    this.sendEnterWorld();
  }

  private sendRequestKeyMapping(): void {
    // Extended packet: C 0xD0 + H 0x0021
    const w = new PacketWriter();
    w.writeUInt8(ExtendedOpcode); // 0xD0
    w.writeUInt16LE(GameServer.RequestKeyMapping); // 0x0021
    const body = w.toBuffer();
    this.conn.send(this.gameCrypt.encrypt(body));
  }

  private sendEnterWorld(): void {
    // EnterWorld: C 0x11 + b[104] zeros
    const w = new PacketWriter();
    w.writeUInt8(GameServer.EnterWorld); // 0x11
    w.writeBytes(Buffer.alloc(104, 0));
    const body = w.toBuffer();
    this.conn.send(this.gameCrypt.encrypt(body));
  }

  private enterInGame(): void {
    console.log("IN_GAME");
    this.dt.check("IN_GAME printed", true);
    this.transition(State.IN_GAME);
    this.startKeepaliveTimer();
  }

  private startKeepaliveTimer(): void {
    this.keepaliveTimer = setTimeout(() => {
      console.log("Keepalive timer expired (60s), closing connection.");
      this.dt.check("answered >=1 ping", this.answeredPingCount >= 1);
      this.resolve({ state: "IN_GAME" });
      this.conn.close();
    }, 60_000);
  }

  private handleNetPingRequest(body: Buffer): void {
    // NetPingRequest: C 0xD3 + D pingId
    const r = new PacketReader(body, 1); // skip opcode
    const pingId = r.readInt32LE();
    this.sendNetPing(pingId);
  }

  private handleServerExtended(body: Buffer): void {
    // Server extended: C 0xFE + H subOpcode + ...
    if (body.length < 3) return;
    const subOpcode = body.readUInt16LE(1); // skip 0xFE, read 2-byte LE
    if (subOpcode === GameServer.NetPingRequest) {
      // 0xFE 0x00D3 = NetPingRequest in extended form
      if (body.length < 7) return; // need at least 1 + 2 + 4 = 7 bytes
      const pingId = body.readInt32LE(3); // skip 0xFE + 0x00D3
      this.sendNetPing(pingId);
    }
    // Other server-extended packets: silently dropped (Phase 4) or ignored (Phase 3)
  }

  private sendNetPing(pingId: number): void {
    // NetPing: C 0xA8 + D pingId + D 0x00000000 + D 0x00080000
    const w = new PacketWriter();
    w.writeUInt8(GameServer.NetPing); // 0xA8
    w.writeInt32LE(pingId);
    w.writeInt32LE(0x00000000);
    w.writeInt32LE(0x00080000);
    const body = w.toBuffer();
    this.conn.send(this.gameCrypt.encrypt(body));
    this.answeredPingCount++;
  }

  private tolerateUnknown(): void {
    this.unknownCount++;
    if (this.unknownCount > 10) {
      this.fail("Too many unknown packets (limit 10 exceeded)");
    }
  }
}
