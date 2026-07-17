import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { unscrambleModulus } from "../crypto/ScrambledRsaKey";
import { encryptCredentials } from "../crypto/RsaCrypt";
import { logState, assertState, check } from "../debug/DebugTools";
import { LoginServerIn, LoginClientOut } from "../game/Opcodes";
import type { Config } from "../config";

export interface LoginResult {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
}

export function runLogin(cfg: Config, statePath: string[]): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    const conn = new Connection();
    const crypt = new LoginCrypt();
    let state = "IDLE";

    let sessionId = 0;
    let ggResponse = 0;
    let haveGGAuth = false;
    let loginOkId1 = 0;
    let loginOkId2 = 0;
    let playOkId1 = 0;
    let playOkId2 = 0;
    let gameHost = "";
    let gamePort = 0;
    let ggDone = false;

    // Unscrambled RSA modulus (set during Init)
    let modulus: Buffer | null = null;

    conn.onConnect = () => {
      state = "WAIT_INIT";
      statePath.push("WAIT_INIT");
      logState("IDLE", "WAIT_INIT");
      // Wait for server Init packet — nothing to send yet
    };

    conn.onClose = () => {
      if (state !== "WAIT_PLAY_OK" || !playOkId1) {
        reject(new Error(`Login connection closed in state ${state}`));
      }
    };

    conn.onPacket = (frame: Buffer) => {
      try {
        // Strip 2-byte size prefix
        const body = frame.subarray(2);
        let decrypted: Buffer;
        let opcode: number;

        if (state === "WAIT_INIT") {
          // Init uses special decryptInit
          const raw = crypt.decryptInit(body);
          opcode = raw[0]!;
          decrypted = raw;
        } else {
          // Subsequent packets use standard Blowfish decrypt
          const raw = crypt.decrypt(body);
          opcode = raw[0]!;
          decrypted = raw;
        }

        const r = new PacketReader(decrypted, 1); // skip opcode byte

        // --- WAIT_INIT: expect Init 0x00 ---
        if (state === "WAIT_INIT") {
          assertState(state, "WAIT_INIT", "Init handler");
          if (opcode !== LoginServerIn.Init) {
            reject(new Error(`Expected Init(0x00), got ${opcode.toString(16)}`));
            return;
          }
          sessionId = r.readInt32LE();
          const _protoRev = r.readInt32LE(); // protocol revision, skip
          const scrambled = r.readBytes(128);
          modulus = unscrambleModulus(scrambled);
          check("modulus is 128 bytes", modulus.length === 128);
          const _unknown = r.readBytes(16); // skip
          const blowfishKey = r.readBytes(16);
          crypt.setSessionKey(blowfishKey);

          state = "WAIT_GG_AUTH";
          statePath.push("WAIT_GG_AUTH");
          logState("WAIT_INIT", "WAIT_GG_AUTH");

          // Send RequestGGAuth
          const ggAuthBody = new PacketWriter()
            .writeUInt8(LoginClientOut.RequestGGAuth)   // 0x07
            .writeInt32LE(sessionId)
            .writeInt32LE(0x00000123)
            .writeInt32LE(0x00004567)
            .writeInt32LE(0x000089AB)
            .writeInt32LE(0x0000CDEF)
            .writeBytes(Buffer.alloc(19, 0))
            .toBuffer();
          conn.send(crypt.encrypt(ggAuthBody));
          return;
        }

        // --- WAIT_GG_AUTH: expect GGAuth 0x0B, or LoginOk 0x03 (skip) ---
        if (state === "WAIT_GG_AUTH") {
          // EDGE CASE: LoginOk arrives before GGAuth — skip GGAuth
          if (opcode === LoginServerIn.LoginOk) {
            // Server skipped GGAuth
            ggResponse = 0;
            haveGGAuth = true;
            // Process LoginOk now (fall through to loginOk logic below)
            loginOkId1 = r.readInt32LE();
            loginOkId2 = r.readInt32LE();
            state = "WAIT_SERVER_LIST";
            statePath.push("WAIT_SERVER_LIST");
            logState("WAIT_GG_AUTH", "WAIT_SERVER_LIST");
            sendRequestServerList();
            return;
          }

          assertState(state, "WAIT_GG_AUTH", "GGAuth handler");
          if (opcode !== LoginServerIn.GGAuth) {
            reject(new Error(`Expected GGAuth(0x0B), got ${opcode.toString(16)}`));
            return;
          }
          ggResponse = r.readInt32LE();
          haveGGAuth = true;

          state = "WAIT_LOGIN_OK";
          statePath.push("WAIT_LOGIN_OK");
          logState("WAIT_GG_AUTH", "WAIT_LOGIN_OK");

          // Send RequestAuthLogin
          sendRequestAuthLogin();
          return;
        }

        // --- WAIT_LOGIN_OK: expect LoginOk 0x03, or LoginFail 0x01 ---
        if (state === "WAIT_LOGIN_OK") {
          assertState(state, "WAIT_LOGIN_OK", "LoginOk handler");
          if (opcode === LoginServerIn.LoginFail) {
            const reason = r.readUInt8();
            reject(new Error(`LoginFail: reason=${reason}`));
            return;
          }
          if (opcode !== LoginServerIn.LoginOk) {
            reject(new Error(`Expected LoginOk(0x03), got ${opcode.toString(16)}`));
            return;
          }
          loginOkId1 = r.readInt32LE();
          loginOkId2 = r.readInt32LE();

          state = "WAIT_SERVER_LIST";
          statePath.push("WAIT_SERVER_LIST");
          logState("WAIT_LOGIN_OK", "WAIT_SERVER_LIST");

          sendRequestServerList();
          return;
        }

        // --- WAIT_SERVER_LIST: expect ServerList 0x04 ---
        if (state === "WAIT_SERVER_LIST") {
          assertState(state, "WAIT_SERVER_LIST", "ServerList handler");
          if (opcode !== LoginServerIn.ServerList) {
            reject(new Error(`Expected ServerList(0x04), got ${opcode.toString(16)}`));
            return;
          }
          const serverCount = r.readUInt8();
          r.readUInt8(); // 0x00 padding

          for (let i = 0; i < serverCount; i++) {
            const id = r.readUInt8();
            const ipBytes = r.readBytes(4);
            const port = r.readInt32LE();
            const ageLimit = r.readUInt8();
            const pvp = r.readUInt8();
            const online = r.readUInt16LE();
            const maxPlayers = r.readUInt16LE();
            const status = r.readUInt8();
            r.readInt32LE(); // D 0
            r.readUInt8();   // C 0

            if (id === cfg.serverId) {
              gameHost = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;
              gamePort = port;
            }
          }

          if (!gameHost) {
            reject(new Error(`Server id ${cfg.serverId} not found in server list`));
            return;
          }

          state = "WAIT_PLAY_OK";
          statePath.push("WAIT_PLAY_OK");
          logState("WAIT_SERVER_LIST", "WAIT_PLAY_OK");

          // Send RequestServerLogin
          const reqBody = new PacketWriter()
            .writeUInt8(LoginClientOut.RequestServerLogin)  // 0x02
            .writeInt32LE(loginOkId1)
            .writeInt32LE(loginOkId2)
            .writeUInt8(cfg.serverId)
            .toBuffer();
          conn.send(crypt.encrypt(reqBody));
          return;
        }

        // --- WAIT_PLAY_OK: expect PlayOk 0x07, or PlayFail 0x06 ---
        if (state === "WAIT_PLAY_OK") {
          assertState(state, "WAIT_PLAY_OK", "PlayOk handler");
          if (opcode === LoginServerIn.PlayFail) {
            reject(new Error("PlayFail received"));
            return;
          }
          if (opcode !== LoginServerIn.PlayOk) {
            reject(new Error(`Expected PlayOk(0x07), got ${opcode.toString(16)}`));
            return;
          }
          playOkId1 = r.readInt32LE();
          playOkId2 = r.readInt32LE();

          conn.close();

          const result: LoginResult = {
            loginOkId1,
            loginOkId2,
            playOkId1,
            playOkId2,
            gameHost,
            gamePort,
          };
          resolve(result);
          return;
        }
      } catch (err) {
        reject(err);
      }
    };

    // Helper: send RequestAuthLogin
    function sendRequestAuthLogin(): void {
      const credentials = encryptCredentials(cfg.username, cfg.password, modulus!);

      const authBody = new PacketWriter()
        .writeUInt8(LoginClientOut.RequestAuthLogin)  // 0x00
        .writeBytes(credentials)                       // b[128]
        .writeInt32LE(ggResponse)                      // D ggResponse
        .writeBytes(Buffer.from([
          0x23, 0x01, 0x00, 0x00, 0x67, 0x45, 0x00, 0x00,
          0xab, 0x89, 0x00, 0x00, 0xef, 0xcd, 0x00, 0x00,
          0x08, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]))
        .toBuffer();

      conn.send(crypt.encrypt(authBody));
    }

    // Helper: send RequestServerList
    function sendRequestServerList(): void {
      const body = new PacketWriter()
        .writeUInt8(LoginClientOut.RequestServerList)  // 0x05
        .writeInt32LE(loginOkId1)
        .writeInt32LE(loginOkId2)
        .writeInt32LE(0x04000000)
        .toBuffer();

      conn.send(crypt.encrypt(body));
    }

    conn.connect(cfg.loginIp, cfg.loginPort);
  });
}
