import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { unscrambleModulus } from "../crypto/ScrambledRsaKey";
import { encryptCredentials } from "../crypto/RsaCrypt";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { check, logState, report } from "../debug/DebugTools";

export interface LoginResult {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
}

type LoginState = "WAIT_INIT" | "WAIT_GG_AUTH" | "WAIT_LOGIN_OK" | "WAIT_SERVER_LIST" | "WAIT_PLAY_OK" | "LOGIN_COMPLETE";

export class LoginClient {
  private state: LoginState = "WAIT_INIT";
  private connection: Connection;
  private loginCrypt = new LoginCrypt();
  private sessionId: number = 0;
  private protocolRevision: number = 0;
  private unscrambledModulus: Buffer | null = null;
  private ggResponse: number = 0;

  // Session IDs from server responses
  private loginOkId1: number = 0;
  private loginOkId2: number = 0;
  private playOkId1: number = 0;
  private playOkId2: number = 0;

  // Game server info
  private gameHost: string = "";
  private gamePort: number = 0;

  constructor(private loginIp: string, private loginPort: number, private username: string, private password: string, private serverId: number) {
    this.connection = new Connection();
    this.connection.onConnect = () => {
      logState("CONNECTED", "WAIT_INIT");
      this.state = "WAIT_INIT";
    };

    this.connection.onClose = () => {
      console.log("Login connection closed");
    };

    this.connection.onPacket = (packet: Buffer) => {
      this.handlePacket(packet);
    };
  }

  private handlePacket(packet: Buffer): void {
    // Packet includes 2-byte size at the start, so payload starts at index 2
    if (packet.length < 3) return;

    switch (this.state) {
      case "WAIT_INIT":
        // Init packet body is encrypted with special crypto (LoginCrypt.decryptInit)
        const initBody = packet.subarray(2);
        this.handleInit(initBody);
        break;
      case "WAIT_GG_AUTH":
      case "WAIT_LOGIN_OK":
      case "WAIT_SERVER_LIST":
      case "WAIT_PLAY_OK":
        {
          // After session key is set, server packets are encrypted with Blowfish
          const body = packet.subarray(2);
          const decryptedBody = this.loginCrypt.decrypt(body);

          const decReader = new PacketReader(decryptedBody);
          const opcode = decReader.readUInt8();
          this.handleOpcodePacket(opcode, decReader);
        }
        break;
    }
  }

  private handleInit(body: Buffer): void {
    // Decrypt the Init packet using special crypto
    const decryptedBody = this.loginCrypt.decryptInit(body);

    const decReader = new PacketReader(decryptedBody);
    const opcode = decReader.readUInt8();

    if (opcode !== 0x00) {
      console.log(`FAIL: Login server rejected connection or protocol mismatch. After decrypt, expected Init opcode 0x00, got ${opcode} (${opcode.toString(16).toUpperCase()})`);
      console.log('This typically means:');
      console.log('  - The login server IP/port is incorrect');
      console.log('  - Protocol version mismatch between client and server');
      console.log('  - Connection to a game server instead of login server');

      // Fail a self-test to ensure the report shows status: FAIL
      check("expected init opcode 0x00 after decrypt", false);

      report(2, "WAIT_INIT -> CONNECTION_REJECTED", {}, `Login server sent unexpected opcode ${opcode} after decrypt instead of Init (0x00)`);
      process.exit(1);
    }

    logState("WAIT_INIT", "INIT_RECEIVED");

    this.sessionId = decReader.readInt32LE();
    void decReader.readInt32LE(); // protocol revision (unused)

    const scrambledModulus = decReader.readBytes(128);
    this.unscrambledModulus = unscrambleModulus(scrambledModulus);

    // Explicit self-test: after unscrambling the modulus, run check
    check('modulus is 128 bytes', this.unscrambledModulus!.length === 128);

    void decReader.readBytes(16); // skip unknown 16 bytes
    const blowfishKey = decReader.readBytes(16);

    this.loginCrypt.setSessionKey(blowfishKey);

    logState("INIT_RECEIVED", "WAIT_GG_AUTH");
    this.state = "WAIT_GG_AUTH";

    this.sendRequestGGAuth();
  }

  private handleOpcodePacket(opcode: number, reader: PacketReader): void {
    switch (this.state) {
      case "WAIT_GG_AUTH":
        this.handleGGAuth(opcode, reader);
        break;
      case "WAIT_LOGIN_OK":
        this.handleLoginOkOrFail(opcode, reader);
        break;
      case "WAIT_SERVER_LIST":
        this.handleServerList(opcode, reader);
        break;
      case "WAIT_PLAY_OK":
        this.handlePlayOkOrFail(opcode, reader);
        break;
    }
  }

  private handleGGAuth(opcode: number, reader: PacketReader): void {
    if (opcode === 0x0B) {
      // GGAuth packet - opcode already consumed by decReader.readUInt8()
      logState("WAIT_GG_AUTH", "GG_AUTH_RECEIVED");
      this.ggResponse = reader.readInt32LE();

      logState("GG_AUTH_RECEIVED", "WAIT_LOGIN_OK");
      this.state = "WAIT_LOGIN_OK";

      this.sendRequestAuthLogin();
    } else if (opcode === 0x03) {
      // Skipped-GGAuth edge case: server sends LoginOk-shaped data before GGAuth
      logState("WAIT_GG_AUTH", "SKIPPED_GG_AUTH -> WAIT_LOGIN_OK");
      this.ggResponse = 0;
      this.state = "WAIT_LOGIN_OK";

      // Handle as LoginOk
      this.handleLoginOk(opcode, reader);
    } else {
      console.log(`Expected GGAuth opcode 0x0B or LoginOk 0x03, got ${opcode}`);
    }
  }

  private handleLoginOkOrFail(opcode: number, reader: PacketReader): void {
    if (opcode === 0x03) {
      this.handleLoginOk(opcode, reader);
    } else if (opcode === 0x01) {
      // LoginFail
      logState("WAIT_LOGIN_OK", "LOGIN_FAIL");
      console.log("FAIL: LoginFail received");
      report(2, "WAIT_INIT -> WAIT_GG_AUTH -> WAIT_LOGIN_OK -> LOGIN_FAIL", {}, "LoginFail received from server");
      process.exit(1);
    } else {
      console.log(`Expected LoginOk 0x03 or LoginFail 0x01, got ${opcode}`);
    }
  }

  private handleLoginOk(opcode: number, reader: PacketReader): void {
    if (opcode !== 0x03) return;

    logState("WAIT_LOGIN_OK", "LOGIN_OK_RECEIVED");
    // opcode already consumed by decReader.readUInt8() before calling handleOpcodePacket
    this.loginOkId1 = reader.readInt32LE();
    this.loginOkId2 = reader.readInt32LE();

    logState("LOGIN_OK_RECEIVED", "WAIT_SERVER_LIST");
    this.state = "WAIT_SERVER_LIST";

    this.sendRequestServerList();
  }

  private handleServerList(opcode: number, reader: PacketReader): void {
    if (opcode !== 0x04) {
      console.log(`Expected ServerList opcode 0x04, got ${opcode}`);
      return;
    }

    logState("WAIT_SERVER_LIST", "SERVER_LIST_RECEIVED");
    // opcode already consumed by decReader.readUInt8() before calling handleOpcodePacket
    const serverCount = reader.readUInt8();
    reader.readUInt8(); // skip 0x00

    let foundServerId = -1;
    let foundHost = "";
    let foundPort = 0;

    for (let i = 0; i < serverCount; i++) {
      const srvId = reader.readUInt8();
      const ipBytes = reader.readBytes(4);
      const port = reader.readInt32LE();
      reader.readUInt8(); // ageLimit
      reader.readUInt8(); // pvp
      reader.readUInt16LE(); // online
      reader.readUInt16LE(); // maxPlayers
      reader.readUInt8(); // status
      reader.readInt32LE(); // 0
      reader.readUInt8(); // 0

      const host = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;

      if (srvId === this.serverId) {
        foundServerId = srvId;
        foundHost = host;
        foundPort = port;
        break;
      }
    }

    if (foundServerId === -1) {
      console.log(`Server ID ${this.serverId} not found in server list`);
      report(2, "WAIT_INIT -> WAIT_GG_AUTH -> WAIT_LOGIN_OK -> WAIT_SERVER_LIST -> SERVER_NOT_FOUND", {}, `Server ID ${this.serverId} not found`);
      process.exit(1);
    }

    this.gameHost = foundHost;
    this.gamePort = foundPort;

    logState("SERVER_LIST_RECEIVED", "WAIT_PLAY_OK");
    this.state = "WAIT_PLAY_OK";

    this.sendRequestServerLogin();
  }

  private handlePlayOkOrFail(opcode: number, reader: PacketReader): void {
    if (opcode === 0x07) {
      this.handlePlayOk(opcode, reader);
    } else if (opcode === 0x06) {
      // PlayFail
      logState("WAIT_PLAY_OK", "PLAY_FAIL");
      console.log("FAIL: PlayFail received");
      report(2, "WAIT_INIT -> WAIT_GG_AUTH -> WAIT_LOGIN_OK -> WAIT_SERVER_LIST -> WAIT_PLAY_OK -> PLAY_FAIL", {}, "PlayFail received from server");
      process.exit(1);
    } else {
      console.log(`Expected PlayOk 0x07 or PlayFail 0x06, got ${opcode}`);
    }
  }

  private handlePlayOk(opcode: number, reader: PacketReader): void {
    if (opcode !== 0x07) return;

    logState("WAIT_PLAY_OK", "PLAY_OK_RECEIVED");
    // opcode already consumed by decReader.readUInt8() before calling handleOpcodePacket
    this.playOkId1 = reader.readInt32LE();
    this.playOkId2 = reader.readInt32LE();

    logState("PLAY_OK_RECEIVED", "LOGIN_COMPLETE");

    // Close login connection
    this.connection.close();

    // Write artifacts to phase-2-output.json
    const fs = require("fs");
    const path = require("path");
    const artifactsDir = path.join(process.cwd(), "artifacts");
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    const artifacts = {
      loginOkId1: this.loginOkId1,
      loginOkId2: this.loginOkId2,
      playOkId1: this.playOkId1,
      playOkId2: this.playOkId2,
      gameHost: this.gameHost,
      gamePort: this.gamePort,
    };

    const outputPath = path.join(artifactsDir, "phase-2-output.json");
    fs.writeFileSync(outputPath, JSON.stringify(artifacts, null, 2));

    // Print PHASE 2 REPORT
    report(2, "WAIT_INIT -> WAIT_GG_AUTH -> WAIT_LOGIN_OK -> WAIT_SERVER_LIST -> WAIT_PLAY_OK", artifacts, "Login server authentication completed successfully");
  }

  private sendRequestGGAuth(): void {
    // RequestGGAuth: C 0x07 + D sessionId + four D GG constants (0x00000123, 0x00004567, 0x000089AB, 0x0000CDEF) + 19 zero bytes.
    const writer = new PacketWriter();
    writer.writeUInt8(0x07);
    writer.writeInt32LE(this.sessionId);
    writer.writeInt32LE(0x00000123);
    writer.writeInt32LE(0x00004567);
    writer.writeInt32LE(0x000089AB);
    writer.writeInt32LE(0x0000CDEF);
    for (let i = 0; i < 19; i++) {
      writer.writeUInt8(0);
    }

    const body = writer.toBuffer();
    const encryptedBody = this.loginCrypt.encrypt(body);
    this.connection.send(encryptedBody);
  }

  private sendRequestAuthLogin(): void {
    // RequestAuthLogin: C 0x00 + b[128] RSA ciphertext + D ggResponse + fixed 43-byte GG block.
    if (!this.unscrambledModulus) {
      throw new Error("Unscrambled modulus not available");
    }

    const rsaCiphertext = encryptCredentials(this.username, this.password, this.unscrambledModulus);

    const writer = new PacketWriter();
    writer.writeUInt8(0x00);
    writer.writeBytes(rsaCiphertext); // 128 bytes
    writer.writeInt32LE(this.ggResponse);

    // Fixed 43-byte GG block:
    // 23 01 00 00 67 45 00 00 ab 89 00 00 ef cd 00 00 08 00 00 00
    // 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    const fixedGgBlock = Buffer.from([
      0x23, 0x01, 0x00, 0x00, 0x67, 0x45, 0x00, 0x00, 0xab, 0x89, 0x00, 0x00,
      0xef, 0xcd, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    writer.writeBytes(fixedGgBlock);

    const body = writer.toBuffer();
    const encryptedBody = this.loginCrypt.encrypt(body);
    this.connection.send(encryptedBody);
  }

  private sendRequestServerList(): void {
    // RequestServerList: C 0x05 + D loginOkId1 + D loginOkId2 + D 0x04000000.
    const writer = new PacketWriter();
    writer.writeUInt8(0x05);
    writer.writeInt32LE(this.loginOkId1);
    writer.writeInt32LE(this.loginOkId2);
    writer.writeInt32LE(0x04000000);

    const body = writer.toBuffer();
    const encryptedBody = this.loginCrypt.encrypt(body);
    this.connection.send(encryptedBody);
  }

  private sendRequestServerLogin(): void {
    // RequestServerLogin: C 0x02 + D loginOkId1 + D loginOkId2 + C serverId.
    const writer = new PacketWriter();
    writer.writeUInt8(0x02);
    writer.writeInt32LE(this.loginOkId1);
    writer.writeInt32LE(this.loginOkId2);
    writer.writeUInt8(this.serverId);

    const body = writer.toBuffer();
    const encryptedBody = this.loginCrypt.encrypt(body);
    this.connection.send(encryptedBody);
  }

  public connectAndAuthenticate(): Promise<LoginResult> {
    return new Promise((resolve, reject) => {
      this.connection.connect(this.loginIp, this.loginPort);

      // Set a timeout for the connection
      const timeout = setTimeout(() => {
        console.log("Login connection timeout");
        report(2, "WAIT_INIT -> TIMEOUT", {}, "Connection timeout");
        this.connection.close();
        reject(new Error("Connection timeout"));
      }, 30000);

      // Override onConnect to clear timeout and handle resolution
      const originalOnConnect = this.connection.onConnect;
      this.connection.onConnect = () => {
        clearTimeout(timeout);
        originalOnConnect();
      };

      // Wait for login to complete via the state machine
      // We'll resolve when PLAY_OK_RECEIVED is reached
      const checkComplete = setInterval(() => {
        if (this.state === "LOGIN_COMPLETE") {
          clearInterval(checkComplete);
          resolve({
            loginOkId1: this.loginOkId1,
            loginOkId2: this.loginOkId2,
            playOkId1: this.playOkId1,
            playOkId2: this.playOkId2,
            gameHost: this.gameHost,
            gamePort: this.gamePort,
          });
        }
      }, 100);

      // If connection closes before completion, reject
      this.connection.onClose = () => {
        clearInterval(checkComplete);
        if (this.state !== "LOGIN_COMPLETE") {
          // Check if it was a successful close after PlayOk
          if (this.playOkId1 !== 0 || this.playOkId2 !== 0) {
            resolve({
              loginOkId1: this.loginOkId1,
              loginOkId2: this.loginOkId2,
              playOkId1: this.playOkId1,
              playOkId2: this.playOkId2,
              gameHost: this.gameHost,
              gamePort: this.gamePort,
            });
          } else {
            reject(new Error("Connection closed before completion"));
          }
        }
      };
    });
  }
}
