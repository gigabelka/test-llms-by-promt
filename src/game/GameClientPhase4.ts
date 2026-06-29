import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { GameCrypt } from "./GameCrypt";
import { GAME_OPCODES, ExtendedOpcode, ServerExtendedOpcode } from "./opcodes";
import { check, logState, report, runGameCryptoSelfTests, selfTestCounts } from "../debug/DebugTools";

export interface GamePhaseInput {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
  username: string;
  charSlot: number;
  protocol: number;
}

export interface GameClientPhase4Result {
  gameHost: string;
  gamePort: number;
}

type GameState = "WAIT_CRYPT_INIT" | "WAIT_CHAR_LIST" | "WAIT_CHAR_SELECTED" | "WAIT_USER_INFO" | "IN_GAME";

export class GameClientPhase4 {
  private state: GameState = "WAIT_CRYPT_INIT";
  private connection: Connection;
  private gameCrypt = new GameCrypt();
  private encryptionFlag = 0;
  private xorKey: Buffer | null = null;
  private charCount = 0;
  private answeredPingCount = 0;
  private unknownPacketCount = 0;
  private keyMappingSent = false;
  private enterWorldSent = false;

  constructor(
    private input: GamePhaseInput
  ) {
    this.connection = new Connection();
    this.connection.onConnect = () => {
      logState("CONNECTED", "WAIT_CRYPT_INIT");
      this.state = "WAIT_CRYPT_INIT";
    };

    this.connection.onClose = () => {
      console.log("Game connection closed");
    };

    this.connection.onPacket = (packet: Buffer) => {
      this.handlePacket(packet);
    };
  }

  private handlePacket(packet: Buffer): void {
    if (packet.length < 3) return;

    // Check for extended opcode prefix from server (0xFE)
    let opcodeIndex = 2;
    let opcode = packet[opcodeIndex];

    let isPingRequest = false;
    let pingId = 0;

    if (opcode === ServerExtendedOpcode && packet.length >= 5) {
      const subOpcode = packet.readUInt16LE(3);
      if (subOpcode === GAME_OPCODES.NET_PING_REQUEST) {
        isPingRequest = true;
        pingId = packet.readInt32LE(5);
      } else {
        // Unknown extended packet from server
        this.handleUnknownPacket();
        return;
      }
    } else if (opcode === GAME_OPCODES.NET_PING_REQUEST) {
      isPingRequest = true;
      pingId = packet.readInt32LE(3);
    }

    if (isPingRequest && this.state === "IN_GAME") {
      this.handleNetPingRequest(pingId);
      return;
    }

    // If IN_GAME and not a ping request, silently drop non-ping packets
    if (this.state === "IN_GAME" && !isPingRequest) {
      // Silently drop all non-ping packets once IN_GAME
      return;
    }

    switch (this.state) {
      case "WAIT_CRYPT_INIT":
        this.handleCryptInit(opcode, packet);
        break;
      case "WAIT_CHAR_LIST":
        this.handleCharSelectInfo(opcode, packet);
        break;
      case "WAIT_CHAR_SELECTED":
        this.handleCharSelectedOrUserInfo(opcode, packet);
        break;
      case "WAIT_USER_INFO":
        this.handleUserInfo(opcode, packet);
        break;
    }
  }

  private handleUnknownPacket(): void {
    if (this.state === "WAIT_CHAR_SELECTED" || this.state === "WAIT_USER_INFO") {
      this.unknownPacketCount++;
      if (this.unknownPacketCount > 10) {
        console.log(`Warning: exceeded 10 unknown packets in state ${this.state}`);
      }
    }
  }

  private handleCryptInit(opcode: number, packet: Buffer): void {
    if (opcode !== GAME_OPCODES.CRYPT_INIT) {
      // Not CryptInit, ignore or handle as unknown
      this.handleUnknownPacket();
      return;
    }

    logState("WAIT_CRYPT_INIT", "CRYPT_INIT_RECEIVED");

    const reader = new PacketReader(packet);
    // Packet format: [2-byte size][1-byte opcode 0x2E][payload...]
    // Skip 2-byte size and 1-byte opcode
    reader.skip(3);

    const status = reader.readUInt8();
    this.xorKey = reader.readBytes(8);
    this.encryptionFlag = reader.readInt32LE();

    // Initialize GameCrypt
    if (this.xorKey) {
      this.gameCrypt.init(this.xorKey, this.encryptionFlag !== 0);
    }

    // Self-test: crypt flag honored
    check("crypt flag honored", this.gameCrypt.isEnabled() === (this.encryptionFlag !== 0));

    logState("CRYPT_INIT_RECEIVED", "WAIT_CHAR_LIST");
    this.state = "WAIT_CHAR_LIST";

    // Send AuthRequest after CryptInit
    this.sendAuthRequest();
  }

  private handleCharSelectInfo(opcode: number, packet: Buffer): void {
    if (opcode !== GAME_OPCODES.CHAR_SELECT_INFO) {
      this.handleUnknownPacket();
      return;
    }

    logState("WAIT_CHAR_LIST", "CHAR_SELECT_INFO_RECEIVED");

    const reader = new PacketReader(packet);
    // Skip 2-byte size and 1-byte opcode
    reader.skip(3);

    this.charCount = reader.readInt32LE();

    // Verify charCount >= 1
    check("charCount >= 1", this.charCount >= 1);

    if (this.charCount < 1) {
      report(4, "WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> CHAR_COUNT_INVALID", {}, `charCount is ${this.charCount}, expected >= 1`);
      process.exit(1);
    }

    logState("CHAR_SELECT_INFO_RECEIVED", "WAIT_CHAR_SELECTED");
    this.state = "WAIT_CHAR_SELECTED";

    // Send CharacterSelected
    this.sendCharacterSelected();
  }

  private handleCharSelectedOrUserInfo(opcode: number, packet: Buffer): void {
    // Check for UserInfo (0x32) - tolerate skip from CharSelected to UserInfo
    if (opcode === GAME_OPCODES.USER_INFO) {
      logState("WAIT_CHAR_SELECTED", "USER_INFO_RECEIVED");
      this.state = "WAIT_USER_INFO";

      // Send RequestKeyMapping and EnterWorld after transitioning to WAIT_USER_INFO
      this.sendRequestKeyMapping();
      this.sendEnterWorld();

      return;
    }

    if (opcode === GAME_OPCODES.CHAR_SELECTED_CONFIRM) {
      logState("WAIT_CHAR_SELECTED", "CHAR_SELECTED_CONFIRM_RECEIVED");
      // After CharSelected confirm, send RequestKeyMapping and EnterWorld
      this.state = "WAIT_USER_INFO";

      this.sendRequestKeyMapping();
      this.sendEnterWorld();

      return;
    }

    // Unknown packet in WAIT_CHAR_SELECTED state
    this.handleUnknownPacket();
  }

  private handleUserInfo(opcode: number, packet: Buffer): void {
    if (opcode === GAME_OPCODES.USER_INFO) {
      logState("WAIT_USER_INFO", "IN_GAME");
      this.state = "IN_GAME";

      // Print IN_GAME when UserInfo is received
      console.log("IN_GAME");

      return;
    }

    this.handleUnknownPacket();
  }

  private handleNetPingRequest(pingId: number): void {
    logState("IN_GAME", "NET_PING_REQUEST_RECEIVED");

    // Reply to every NetPingRequest (0xD3 or 0xFE 0x00D3) with NetPing: 0xA8 + D pingId + D 0x00000000 + D 0x00080000
    const writer = new PacketWriter();
    writer.writeUInt8(GAME_OPCODES.NET_PONG);
    writer.writeInt32LE(pingId);
    writer.writeInt32LE(0x00000000);
    writer.writeInt32LE(0x00080000);

    let body = writer.toBuffer();

    // Encrypt if GameCrypt is enabled
    if (this.gameCrypt.isEnabled()) {
      body = this.gameCrypt.encrypt(body);
    }

    this.connection.send(body);
    this.answeredPingCount++;

    logState("NET_PING_REQUEST_RECEIVED", "IN_GAME");
  }

  private sendProtocolVersion(): void {
    // ProtocolVersion: C 0x0E + D L2_PROTOCOL. Sent raw (no encryption yet).
    const writer = new PacketWriter();
    writer.writeUInt8(GAME_OPCODES.PROTOCOL_VERSION);
    writer.writeInt32LE(this.input.protocol);

    const body = writer.toBuffer();
    this.connection.send(body);
  }

  private sendAuthRequest(): void {
    // AuthRequest: C 0x2B + S username + D playOkId2 + D playOkId1 + D loginOkId1 + D loginOkId2.
    // HighFive has no trailing language field.
    const writer = new PacketWriter();
    writer.writeUInt8(GAME_OPCODES.AUTH_REQUEST);
    writer.writeStringNullUTF16(this.input.username);
    writer.writeInt32LE(this.input.playOkId2);
    writer.writeInt32LE(this.input.playOkId1);
    writer.writeInt32LE(this.input.loginOkId1);
    writer.writeInt32LE(this.input.loginOkId2);

    let body = writer.toBuffer();

    // Encrypt if GameCrypt is enabled
    if (this.gameCrypt.isEnabled()) {
      body = this.gameCrypt.encrypt(body);
    }

    this.connection.send(body);
  }

  private sendCharacterSelected(): void {
    // CharacterSelected: C 0x12 + D L2_CHAR_SLOT + b[14] zeros.
    const writer = new PacketWriter();
    writer.writeUInt8(GAME_OPCODES.CHARACTER_SELECTED);
    writer.writeInt32LE(this.input.charSlot);

    // 14 zero bytes
    for (let i = 0; i < 14; i++) {
      writer.writeUInt8(0);
    }

    let body = writer.toBuffer();

    // Encrypt if GameCrypt is enabled
    if (this.gameCrypt.isEnabled()) {
      body = this.gameCrypt.encrypt(body);
    }

    this.connection.send(body);
  }

  private sendRequestKeyMapping(): void {
    if (this.keyMappingSent) return;
    this.keyMappingSent = true;

    // RequestKeyMapping as extended packet: 0xD0 0x21 0x00
    // Extended opcode prefix 0xD0 followed by 2-byte LE sub-opcode 0x0021
    const writer = new PacketWriter();
    writer.writeUInt8(ExtendedOpcode);
    writer.writeInt16LE(GAME_OPCODES.REQUEST_KEY_MAPPING); // 0x21 as little-endian 16-bit

    let body = writer.toBuffer();

    // Encrypt if GameCrypt is enabled
    if (this.gameCrypt.isEnabled()) {
      body = this.gameCrypt.encrypt(body);
    }

    this.connection.send(body);
  }

  private sendEnterWorld(): void {
    if (this.enterWorldSent) return;
    this.enterWorldSent = true;

    // EnterWorld: 0x11 + 104 zero bytes.
    const writer = new PacketWriter();
    writer.writeUInt8(GAME_OPCODES.ENTER_WORLD);

    // 104 zero bytes
    for (let i = 0; i < 104; i++) {
      writer.writeUInt8(0);
    }

    let body = writer.toBuffer();

    // Encrypt if GameCrypt is enabled
    if (this.gameCrypt.isEnabled()) {
      body = this.gameCrypt.encrypt(body);
    }

    this.connection.send(body);
  }

  public connectAndAuthenticate(): Promise<GameClientPhase4Result> {
    return new Promise((resolve, reject) => {
      // Run game crypto self-tests before socket I/O
      runGameCryptoSelfTests();

      const statePathStart = "IDLE -> CONNECTED -> WAIT_CRYPT_INIT";

      this.connection.connect(this.input.gameHost, this.input.gamePort);

      let keepAliveTimer: NodeJS.Timeout | null = null;
      let phaseCompleted = false;
      let inGameReached = false;

      const originalOnConnect = this.connection.onConnect;
      this.connection.onConnect = () => {
        originalOnConnect();
        // Send ProtocolVersion after connection is established
        this.sendProtocolVersion();
      };

      // Set up 60-second keepalive timer
      keepAliveTimer = setTimeout(() => {
        if (!phaseCompleted) {
          phaseCompleted = true;

          // Self-test: answered >=1 ping
          check("answered >=1 ping", this.answeredPingCount >= 1);

          const counts = selfTestCounts();
          const status = counts.failed > 0 ? "FAIL" : "PASS";

          console.log(`=== PHASE 4 REPORT ===`);
          console.log(`status: ${status}`);
          console.log(`self-tests: ${counts.passed}/${counts.passed + counts.failed}`);

          let statePath = statePathStart;
          if (this.state === "WAIT_CRYPT_INIT") {
            statePath += " -> WAIT_CRYPT_INIT";
          } else if (this.state === "WAIT_CHAR_LIST") {
            statePath += " -> WAIT_CRYPT_INIT -> WAIT_CHAR_LIST";
          } else if (this.state === "WAIT_CHAR_SELECTED") {
            statePath += " -> WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED";
          } else if (this.state === "WAIT_USER_INFO") {
            statePath += " -> WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED -> WAIT_USER_INFO";
          } else if (this.state === "IN_GAME") {
            statePath += " -> WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED -> WAIT_USER_INFO -> IN_GAME";
          }

          console.log(`state-path: ${statePath}`);

          const artifactStr = `gameHost=${this.input.gameHost} gamePort=${this.input.gamePort} answeredPingCount=${this.answeredPingCount}`;
          console.log(`artifacts: ${artifactStr}`);

          if (counts.failed > 0) {
            console.log(`notes: self-tests or checks failed`);
          } else {
            console.log(`notes: Keep-alive completed successfully for 60 seconds`);
          }
          console.log("");

          this.connection.close();
        }
      }, 60000);

      // If connection closes before completion, handle gracefully
      const originalOnClose = this.connection.onClose;
      this.connection.onClose = () => {
        if (keepAliveTimer) {
          clearTimeout(keepAliveTimer);
          keepAliveTimer = null;
        }
        originalOnClose();

        // If phase not completed and not in_game, report failure
        if (!phaseCompleted && !inGameReached) {
          const counts = selfTestCounts();
          console.log(`=== PHASE 4 REPORT ===`);
          console.log(`status: FAIL`);
          console.log(`self-tests: ${counts.passed}/${counts.passed + counts.failed}`);
          console.log(`state-path: ${statePathStart} -> ${this.state}`);
          console.log(`artifacts: gameHost=${this.input.gameHost} gamePort=${this.input.gamePort}`);
          console.log(`notes: Connection closed before IN_GAME state`);
          console.log("");
        }
      };

      // Monitor for IN_GAME state
      const checkComplete = setInterval(() => {
        if (this.state === "IN_GAME" && !inGameReached) {
          inGameReached = true;
          clearInterval(checkComplete);
          resolve({
            gameHost: this.input.gameHost,
            gamePort: this.input.gamePort,
          });
        }
      }, 100);

      // If connection closes after IN_GAME, it's handled by the keepalive timer
    });
  }
}
