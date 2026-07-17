import { LoginCrypt } from "../crypto/LoginCrypt";
import { encryptCredentials } from "../crypto/RsaCrypt";
import { unscrambleModulus } from "../crypto/ScrambledRsaKey";
import {
  assertState,
  check,
  logState,
} from "../debug/DebugTools";
import { LoginClientOut, LoginServerIn } from "../game/Opcodes";
import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";

export interface LoginResult {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
}

export interface LoginConfig {
  loginIp: string;
  loginPort: number;
  username: string;
  password: string;
  serverId: number;
}

export function runLogin(
  cfg: LoginConfig,
  statePath: string[],
): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    let state = "WAIT_INIT";
    const push = (to: string) => {
      logState(state, to);
      statePath.push(to);
      state = to;
    };

    const loginCrypt = new LoginCrypt();
    const conn = new Connection();

    let resolved = false;
    let sessionId = 0;
    let ggResponse = 0;
    let loginOkId1 = 0;
    let loginOkId2 = 0;
    let unscrambledModulus = Buffer.alloc(0);
    let gameHost = "";
    let gamePort = 0;

    const finish = (err?: Error, result?: LoginResult) => {
      if (resolved) return;
      resolved = true;
      conn.close();
      if (err) reject(err);
      else resolve(result!);
    };

    conn.onClose = () => {
      if (!resolved) {
        finish(new Error(`Login server closed socket in ${state}`));
      }
    };

    conn.onPacket = (frame) => {
      try {
        let body = frame.subarray(2);
        let opcode: number;

        if (state === "WAIT_INIT") {
          opcode = body[0]!;
        } else {
          body = loginCrypt.decrypt(body);
          opcode = body[0]!;
        }

        if (state === "WAIT_INIT") {
          assertState(state, "WAIT_INIT");
          body = loginCrypt.decryptInit(body);
          opcode = body[0]!;
          if (opcode !== LoginServerIn.Init) {
            throw new Error(
              `Expected Init (0x${LoginServerIn.Init.toString(16)}), got 0x${opcode.toString(16)}`,
            );
          }

          const r = new PacketReader(body, 1);
          sessionId = r.readInt32LE();
          r.skip(4); // protocol revision
          const scrambled = r.readBytes(128);
          r.skip(16);
          const blowfishKey = r.readBytes(16);

          loginCrypt.setSessionKey(blowfishKey);
          unscrambledModulus = unscrambleModulus(scrambled) as Buffer<ArrayBuffer>;
          check("modulus is 128 bytes", unscrambledModulus.length === 128);

          push("WAIT_GG_AUTH");

          const w = new PacketWriter()
            .writeUInt8(LoginClientOut.RequestGGAuth)
            .writeInt32LE(sessionId)
            .writeInt32LE(0x00000123)
            .writeInt32LE(0x00004567)
            .writeInt32LE(0x000089ab)
            .writeInt32LE(0x0000cdef)
            .writeBytes(Buffer.alloc(19));
          conn.send(loginCrypt.encrypt(w.toBuffer()));
        } else if (state === "WAIT_GG_AUTH") {
          if (opcode === LoginServerIn.GGAuth) {
            const r = new PacketReader(body, 1);
            ggResponse = r.readInt32LE();

            push("WAIT_LOGIN_OK");

            const rsa = encryptCredentials(
              cfg.username,
              cfg.password,
              unscrambledModulus,
            );
            const ggBlock = Buffer.concat([
              Buffer.from([
                0x23, 0x01, 0x00, 0x00, 0x67, 0x45, 0x00, 0x00, 0xab, 0x89,
                0x00, 0x00, 0xef, 0xcd, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00,
              ]),
              Buffer.alloc(23),
            ]);

            const auth = new PacketWriter()
              .writeUInt8(LoginClientOut.RequestAuthLogin)
              .writeBytes(rsa)
              .writeInt32LE(ggResponse)
              .writeBytes(ggBlock)
              .toBuffer();
            conn.send(loginCrypt.encrypt(auth));
          } else if (opcode === LoginServerIn.LoginOk) {
            // Server skipped the GGAuth step.
            ggResponse = 0;
            const r = new PacketReader(body, 1);
            loginOkId1 = r.readInt32LE();
            loginOkId2 = r.readInt32LE();

            push("WAIT_LOGIN_OK");
            push("WAIT_SERVER_LIST");

            const w = new PacketWriter()
              .writeUInt8(LoginClientOut.RequestServerList)
              .writeInt32LE(loginOkId1)
              .writeInt32LE(loginOkId2)
              .writeInt32LE(0x04000000)
              .toBuffer();
            conn.send(loginCrypt.encrypt(w));
          } else {
            throw new Error(
              `Unexpected opcode 0x${opcode.toString(16)} in WAIT_GG_AUTH`,
            );
          }
        } else if (state === "WAIT_LOGIN_OK") {
          if (opcode === LoginServerIn.LoginFail) {
            throw new Error(`LoginFail reason=${body[1] ?? "unknown"}`);
          }
          if (opcode !== LoginServerIn.LoginOk) {
            throw new Error(
              `Expected LoginOk (0x${LoginServerIn.LoginOk.toString(16)}), got 0x${opcode.toString(16)}`,
            );
          }

          const r = new PacketReader(body, 1);
          loginOkId1 = r.readInt32LE();
          loginOkId2 = r.readInt32LE();

          push("WAIT_SERVER_LIST");

          const w = new PacketWriter()
            .writeUInt8(LoginClientOut.RequestServerList)
            .writeInt32LE(loginOkId1)
            .writeInt32LE(loginOkId2)
            .writeInt32LE(0x04000000)
            .toBuffer();
          conn.send(loginCrypt.encrypt(w));
        } else if (state === "WAIT_SERVER_LIST") {
          if (opcode !== LoginServerIn.ServerList) {
            throw new Error(
              `Expected ServerList (0x${LoginServerIn.ServerList.toString(16)}), got 0x${opcode.toString(16)}`,
            );
          }

          const r = new PacketReader(body, 1);
          const serverCount = r.readUInt8();
          r.skip(1); // 0x00

          let found = false;
          for (let i = 0; i < serverCount; i++) {
            const id = r.readUInt8();
            const ipBytes = r.readBytes(4);
            const port = r.readInt32LE();
            r.skip(12); // ageLimit + pvp + online + maxPlayers + status + D 0 + C 0
            if (id === cfg.serverId) {
              found = true;
              gameHost = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;
              gamePort = port;
            }
          }

          if (!found) {
            throw new Error(`Server id ${cfg.serverId} not found in server list`);
          }

          push("WAIT_PLAY_OK");

          const w = new PacketWriter()
            .writeUInt8(LoginClientOut.RequestServerLogin)
            .writeInt32LE(loginOkId1)
            .writeInt32LE(loginOkId2)
            .writeUInt8(cfg.serverId)
            .toBuffer();
          conn.send(loginCrypt.encrypt(w));
        } else if (state === "WAIT_PLAY_OK") {
          if (opcode === LoginServerIn.PlayFail) {
            throw new Error(`PlayFail reason=${body[1] ?? "unknown"}`);
          }
          if (opcode !== LoginServerIn.PlayOk) {
            throw new Error(
              `Expected PlayOk (0x${LoginServerIn.PlayOk.toString(16)}), got 0x${opcode.toString(16)}`,
            );
          }

          const r = new PacketReader(body, 1);
          const playOkId1 = r.readInt32LE();
          const playOkId2 = r.readInt32LE();

          finish(undefined, {
            loginOkId1,
            loginOkId2,
            playOkId1,
            playOkId2,
            gameHost,
            gamePort,
          });
        }
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    };

    conn.connect(cfg.loginIp, cfg.loginPort);
  });
}
