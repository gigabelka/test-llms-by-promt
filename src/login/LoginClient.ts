import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { unscrambleModulus } from "../crypto/ScrambledRsaKey";
import { encryptCredentials } from "../crypto/RsaCrypt";
import { LoginServerIn, LoginClientOut } from "../game/Opcodes";
import { logState, assertState, check } from "../debug/DebugTools";
import { Config } from "../config";

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
  | "WAIT_PLAY_OK";

// Fixed 43-byte GG block appended to RequestAuthLogin (PLANE.md PART A).
const GG_BLOCK = Buffer.concat([
  Buffer.from([
    0x23, 0x01, 0x00, 0x00, 0x67, 0x45, 0x00, 0x00, 0xab, 0x89, 0x00, 0x00,
    0xef, 0xcd, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00,
  ]),
  Buffer.alloc(23),
]);

// Login-server FSM: WAIT_INIT -> WAIT_GG_AUTH -> WAIT_LOGIN_OK -> WAIT_SERVER_LIST -> WAIT_PLAY_OK.
export function runLogin(
  cfg: Config,
  statePath: string[],
): Promise<LoginResult> {
  return new Promise<LoginResult>((resolve, reject) => {
    const conn = new Connection();
    const crypt = new LoginCrypt();
    let state: LoginState = "WAIT_INIT";
    let settled = false;
    let sessionId = 0;
    let ggResponse = 0;
    let modulus: Buffer | null = null;
    let loginOkId1 = 0;
    let loginOkId2 = 0;
    let gameHost: string | null = null;
    let gamePort = 0;

    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      conn.close();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const transition = (to: LoginState): void => {
      logState(state, to);
      state = to;
      statePath.push(to);
    };

    // All outgoing login packets after Init are encrypted with the session key.
    const sendEncrypted = (body: Buffer): void => {
      conn.send(crypt.encrypt(body));
    };

    const sendAuthLogin = (): void => {
      if (modulus === null) throw new Error("modulus not set before AuthLogin");
      // C 0x00 + b[128] RSA credentials + D ggResponse + b[43] GG block
      const w = new PacketWriter();
      w.writeUInt8(LoginClientOut.RequestAuthLogin);
      w.writeBytes(encryptCredentials(cfg.username, cfg.password, modulus));
      w.writeInt32LE(ggResponse);
      w.writeBytes(GG_BLOCK);
      sendEncrypted(w.toBuffer());
    };

    const handleLoginOk = (r: PacketReader): void => {
      loginOkId1 = r.readInt32LE();
      loginOkId2 = r.readInt32LE();
      transition("WAIT_SERVER_LIST");
      // C 0x05 + D loginOkId1 + D loginOkId2 + D 0x04000000
      const w = new PacketWriter();
      w.writeUInt8(LoginClientOut.RequestServerList);
      w.writeInt32LE(loginOkId1);
      w.writeInt32LE(loginOkId2);
      w.writeInt32LE(0x04000000);
      sendEncrypted(w.toBuffer());
    };

    conn.onConnect = () => {
      // The login server speaks first (Init).
    };

    conn.onClose = () => {
      if (!settled) {
        fail(new Error(`login server closed connection in state ${state}`));
      }
    };

    conn.onPacket = (frame) => {
      try {
        const rawBody = Buffer.from(frame.subarray(2)); // strip 2-byte size

        if (state === "WAIT_INIT") {
          // Init: static-key Blowfish decrypt -> decXORPass -> drop last 8 bytes.
          const body = crypt.decryptInit(rawBody);
          const r = new PacketReader(body);
          const opcode = r.readUInt8();
          assertState(state, "WAIT_INIT", "Init");
          if (opcode !== LoginServerIn.Init) {
            throw new Error(
              `expected Init 0x00, got 0x${opcode.toString(16)}`,
            );
          }
          sessionId = r.readInt32LE();
          r.readInt32LE(); // protocol revision
          modulus = unscrambleModulus(r.readBytes(128));
          check("modulus is 128 bytes", modulus.length === 128);
          r.skip(16); // unknown
          crypt.setSessionKey(r.readBytes(16)); // Blowfish session key
          transition("WAIT_GG_AUTH");
          // RequestGGAuth: C 0x07 + D sessionId + 4 GG constants + b[19] zeros
          const w = new PacketWriter();
          w.writeUInt8(LoginClientOut.RequestGGAuth);
          w.writeInt32LE(sessionId);
          w.writeInt32LE(0x00000123);
          w.writeInt32LE(0x00004567);
          w.writeInt32LE(0x000089ab);
          w.writeInt32LE(0x0000cdef);
          w.writeBytes(Buffer.alloc(19));
          sendEncrypted(w.toBuffer());
          return;
        }

        const body = crypt.decrypt(rawBody);
        const r = new PacketReader(body);
        const opcode = r.readUInt8();

        switch (state) {
          case "WAIT_GG_AUTH": {
            assertState(state, "WAIT_GG_AUTH", "GGAuth/LoginOk");
            if (opcode === LoginServerIn.LoginFail) {
              const reason = r.readUInt8();
              throw new Error(`LoginFail, reason=${reason}`);
            }
            if (opcode === LoginServerIn.LoginOk) {
              // Server skipped GGAuth: use ggResponse = 0.
              ggResponse = 0;
              transition("WAIT_LOGIN_OK");
              handleLoginOk(r);
              return;
            }
            if (opcode !== LoginServerIn.GGAuth) {
              throw new Error(
                `expected GGAuth 0x0B, got 0x${opcode.toString(16)}`,
              );
            }
            ggResponse = r.readInt32LE();
            transition("WAIT_LOGIN_OK");
            sendAuthLogin();
            return;
          }
          case "WAIT_LOGIN_OK": {
            assertState(state, "WAIT_LOGIN_OK", "LoginOk");
            if (opcode === LoginServerIn.LoginFail) {
              const reason = r.readUInt8();
              throw new Error(`LoginFail, reason=${reason}`);
            }
            if (opcode !== LoginServerIn.LoginOk) {
              throw new Error(
                `expected LoginOk 0x03, got 0x${opcode.toString(16)}`,
              );
            }
            handleLoginOk(r);
            return;
          }
          case "WAIT_SERVER_LIST": {
            assertState(state, "WAIT_SERVER_LIST", "ServerList");
            if (opcode !== LoginServerIn.ServerList) {
              throw new Error(
                `expected ServerList 0x04, got 0x${opcode.toString(16)}`,
              );
            }
            const serverCount = r.readUInt8();
            r.readUInt8(); // 0x00
            for (let i = 0; i < serverCount; i++) {
              const id = r.readUInt8();
              const ip = r.readBytes(4);
              const port = r.readInt32LE();
              r.readUInt8(); // ageLimit
              r.readUInt8(); // pvp
              r.readUInt16LE(); // online
              r.readUInt16LE(); // maxPlayers
              r.readUInt8(); // status
              r.readInt32LE(); // 0
              r.readUInt8(); // 0
              if (id === cfg.serverId) {
                gameHost = `${ip[0]}.${ip[1]}.${ip[2]}.${ip[3]}`;
                gamePort = port;
              }
            }
            if (gameHost === null) {
              throw new Error(
                `server id ${cfg.serverId} not found in ServerList (${serverCount} servers)`,
              );
            }
            transition("WAIT_PLAY_OK");
            // C 0x02 + D loginOkId1 + D loginOkId2 + C serverId
            const w = new PacketWriter();
            w.writeUInt8(LoginClientOut.RequestServerLogin);
            w.writeInt32LE(loginOkId1);
            w.writeInt32LE(loginOkId2);
            w.writeUInt8(cfg.serverId);
            sendEncrypted(w.toBuffer());
            return;
          }
          case "WAIT_PLAY_OK": {
            assertState(state, "WAIT_PLAY_OK", "PlayOk");
            if (opcode === LoginServerIn.PlayFail) {
              throw new Error("PlayFail");
            }
            if (opcode !== LoginServerIn.PlayOk) {
              throw new Error(
                `expected PlayOk 0x07, got 0x${opcode.toString(16)}`,
              );
            }
            if (gameHost === null) {
              throw new Error("PlayOk received but no game server selected");
            }
            const playOkId1 = r.readInt32LE();
            const playOkId2 = r.readInt32LE();
            settled = true;
            conn.close();
            resolve({
              loginOkId1,
              loginOkId2,
              playOkId1,
              playOkId2,
              gameHost,
              gamePort,
            });
            return;
          }
          default:
            throw new Error(`unexpected packet in login state ${state}`);
        }
      } catch (err) {
        fail(err);
      }
    };

    conn.connect(cfg.loginIp, cfg.loginPort);
  });
}
