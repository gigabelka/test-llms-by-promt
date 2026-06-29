import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { GameCrypt } from "./GameCrypt";
import { GAME_OPCODES, ExtendedOpcode, ServerExtendedOpcode } from "./opcodes";
import { check, logState, report, runGameCryptoSelfTests } from "../debug/DebugTools";

export interface GameClientResult {
  gameHost: string;
  gamePort: number;
}

type GameState = "WAIT_CRYPT_INIT" | "WAIT_CHAR_LIST" | "WAIT_CHAR_SELECTED" | "WAIT_USER_INFO";

export class GameClient {
  private state: GameState = "WAIT_CRYPT_INIT";
  private connection: Connection;
  private gameCrypt = new GameCrypt();
  private encryptionFlag = 0;
  private xorKey: Buffer | null = null;
  private charCount = 0;

  constructor(
    private gameHost: string,
    private gamePort: number,
    private username: string,
    private playOkId2: number,
    private playOkId1: number,
    private loginOkId1: number,
    private loginOkId2: number,
    private charSlot: number,
    private protocol: number
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

    if (opcode === ServerExtendedOpcode && packet.length >= 4) {
      const subOpcode = packet.readUInt16LE(3);
      if (subOpcode === GAME_OPCODES.NET_PING_REQUEST) {
        // This is a ping request, but we should only handle pings after IN_GAME state
        // For now, ignore non-ping extended packets in early states
        return;
      }
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
    }
  }

  private handleCryptInit(opcode: number, packet: Buffer): void {
    if (opcode !== GAME_OPCODES.CRYPT_INIT) {
      console.log(`Expected CryptInit opcode ${GAME_OPCODES.CRYPT_INIT}, got ${opcode}`);
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
      console.log(`Expected CharSelectInfo opcode ${GAME_OPCODES.CHAR_SELECT_INFO}, got ${opcode}`);
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
      report(3, "WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> CHAR_COUNT_INVALID", {}, `charCount is ${this.charCount}, expected >= 1`);
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

      // Print IN_GAME when UserInfo is received
      console.log("IN_GAME");

      report(3, "WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED -> WAIT_USER_INFO", {
        gameHost: this.gameHost,
        gamePort: this.gamePort,
        charCount: this.charCount,
        encryptionFlag: this.encryptionFlag,
        cryptoEnabled: this.gameCrypt.isEnabled(),
      }, "Game authentication and character selection completed successfully");

      return;
    }

    if (opcode === GAME_OPCODES.CHAR_SELECTED_CONFIRM) {
      logState("WAIT_CHAR_SELECTED", "CHAR_SELECTED_CONFIRM_RECEIVED");
      // After CharSelected confirm, the server should send UserInfo next
      // We stay in WAIT_USER_INFO state conceptually, but we need to receive UserInfo
      this.state = "WAIT_USER_INFO";

      report(3, "WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED -> CHAR_SELECTED_CONFIRM -> WAIT_USER_INFO", {
        gameHost: this.gameHost,
        gamePort: this.gamePort,
        charCount: this.charCount,
        encryptionFlag: this.encryptionFlag,
        cryptoEnabled: this.gameCrypt.isEnabled(),
      }, "Game authentication and character selection completed successfully");

      return;
    }

    console.log(`Expected CharSelected confirm ${GAME_OPCODES.CHAR_SELECTED_CONFIRM} or UserInfo ${GAME_OPCODES.USER_INFO}, got ${opcode}`);
  }

  private sendProtocolVersion(): void {
    // ProtocolVersion: C 0x0E + D L2_PROTOCOL. Sent raw (no encryption yet).
    const writer = new PacketWriter();
    writer.writeUInt8(GAME_OPCODES.PROTOCOL_VERSION);
    writer.writeInt32LE(this.protocol);

    const body = writer.toBuffer();
    this.connection.send(body);
  }

  private sendAuthRequest(): void {
    // AuthRequest: C 0x2B + S username + D playOkId2 + D playOkId1 + D loginOkId1 + D loginOkId2.
    // HighFive has no trailing language field.
    const writer = new PacketWriter();
    writer.writeUInt8(GAME_OPCODES.AUTH_REQUEST);
    writer.writeStringNullUTF16(this.username);
    writer.writeInt32LE(this.playOkId2);
    writer.writeInt32LE(this.playOkId1);
    writer.writeInt32LE(this.loginOkId1);
    writer.writeInt32LE(this.loginOkId2);

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
    writer.writeInt32LE(this.charSlot);

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

  public connectAndAuthenticate(): Promise<GameClientResult> {
    return new Promise((resolve, reject) => {
      // Run game crypto self-tests before socket I/O
      runGameCryptoSelfTests();

      this.connection.connect(this.gameHost, this.gamePort);

      const timeout = setTimeout(() => {
        console.log("Game connection timeout");
        report(3, "WAIT_CRYPT_INIT -> TIMEOUT", {}, "Connection timeout");
        this.connection.close();
        reject(new Error("Connection timeout"));
      }, 30000);

      const originalOnConnect = this.connection.onConnect;
      this.connection.onConnect = () => {
        clearTimeout(timeout);
        originalOnConnect();
        // Send ProtocolVersion after connection is established
        this.sendProtocolVersion();
      };

      // Wait for game authentication to complete
      const checkComplete = setInterval(() => {
        if (this.state === "WAIT_USER_INFO") {
          clearInterval(checkComplete);
          resolve({
            gameHost: this.gameHost,
            gamePort: this.gamePort,
          });
        }
      }, 100);

      // If connection closes before completion, reject
      this.connection.onClose = () => {
        clearInterval(checkComplete);
        if (this.state !== "WAIT_USER_INFO") {
          reject(new Error("Game connection closed before completion"));
        }
      };
    });
  }
}
