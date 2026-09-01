import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { encryptCredentials } from "../crypto/RsaCrypt";
import { unscrambleModulus } from "../crypto/ScrambledRsaKey";
import {
  assertState,
  check,
  logState,
} from "../debug/DebugTools";
import { LoginClientOut, LoginServerIn } from "../game/Opcodes";
import type { Config } from "../config";

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
  | "DONE";

// Fixed 43-byte GG block from PLANE.md PART A (RequestAuthLogin), verbatim.
const GG_BLOCK_43 = Buffer.from([
  0x23, 0x01, 0x00, 0x00, 0x67, 0x45, 0x00, 0x00, 0xab, 0x89, 0x00, 0x00,
  0xef, 0xcd, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00,
  ...Buffer.alloc(23, 0),
]);

// Four GG constants for RequestGGAuth, each as a little-endian D.
const GG_CONSTANTS = Buffer.from([
  0x23, 0x01, 0x00, 0x00,
  0x67, 0x45, 0x00, 0x00,
  0xab, 0x89, 0x00, 0x00,
  0xef, 0xcd, 0x00, 0x00,
]);

export function runLogin(
  cfg: Config,
  statePath: string[],
): Promise<LoginResult> {
  return new Promise<LoginResult>((resolve, reject) => {
    let state: LoginState = "WAIT_INIT";
    let settled = false;

    const loginCrypt = new LoginCrypt();
    const conn = new Connection();

    let sessionId = 0;
    let ggResponse = 0;
    let loginOkId1 = 0;
    let loginOkId2 = 0;
    let unscrambledModulus: Buffer | null = null;
    let gameHost = "";
    let gamePort = 0;

    function fail(err: Error): void {
      if (settled) return;
      settled = true;
      conn.close();
      reject(err);
    }

    function transition(to: LoginState): void {
      logState(state, to);
      statePath.push(to);
      state = to;
    }

    // Every frame on the wire is [uint16LE size][body]; the length prefix is
    // managed by Connection.send() alone — here we only build the body.
    function send(body: Buffer): void {
      conn.send(loginCrypt.encrypt(body));
    }

    function sendRequestGGAuth(): void {
      const body = Buffer.concat([
        Buffer.from([LoginClientOut.RequestGGAuth]),
        Buffer.from([
          sessionId & 0xff,
          (sessionId >>> 8) & 0xff,
          (sessionId >>> 16) & 0xff,
          (sessionId >>> 24) & 0xff,
        ]),
        GG_CONSTANTS,
        Buffer.alloc(19, 0),
      ]);
      send(body);
    }

    function sendRequestAuthLogin(): void {
      if (!unscrambledModulus) {
        fail(new Error("RequestAuthLogin: RSA modulus not available"));
        return;
      }
      const creds = encryptCredentials(
        cfg.username,
        cfg.password,
        unscrambledModulus,
      );
      const body = Buffer.concat([
        Buffer.from([LoginClientOut.RequestAuthLogin]),
        creds,
        Buffer.from([
          ggResponse & 0xff,
          (ggResponse >>> 8) & 0xff,
          (ggResponse >>> 16) & 0xff,
          (ggResponse >>> 24) & 0xff,
        ]),
        GG_BLOCK_43,
      ]);
      send(body);
    }

    function sendRequestServerList(): void {
      const body = new PacketWriter()
        .writeUInt8(LoginClientOut.RequestServerList)
        .writeInt32LE(loginOkId1)
        .writeInt32LE(loginOkId2)
        .writeInt32LE(0x04000000)
        .toBuffer();
      send(body);
    }

    function sendRequestServerLogin(serverId: number): void {
      const body = new PacketWriter()
        .writeUInt8(LoginClientOut.RequestServerLogin)
        .writeInt32LE(loginOkId1)
        .writeInt32LE(loginOkId2)
        .writeUInt8(serverId)
        .toBuffer();
      send(body);
    }

    function handleInit(body: Buffer): void {
      const r = new PacketReader(body);
      r.skip(1); // opcode
      sessionId = r.readInt32LE();
      r.readInt32LE(); // protocol revision
      const modulus = r.readBytes(128);
      if (!check("modulus is 128 bytes", modulus.length === 128)) {
        fail(new Error("Init: RSA modulus is not 128 bytes"));
        return;
      }
      unscrambledModulus = unscrambleModulus(modulus);
      r.skip(16); // unknown
      const blowfishKey = r.readBytes(16);
      loginCrypt.setSessionKey(blowfishKey);
      transition("WAIT_GG_AUTH");
      sendRequestGGAuth();
    }

    function handleGGAuth(body: Buffer): void {
      const r = new PacketReader(body);
      r.skip(1); // opcode
      ggResponse = r.readInt32LE();
      transition("WAIT_LOGIN_OK");
      sendRequestAuthLogin();
    }

    function handleLoginOk(body: Buffer): void {
      const r = new PacketReader(body);
      r.skip(1); // opcode
      loginOkId1 = r.readInt32LE();
      loginOkId2 = r.readInt32LE();
      transition("WAIT_SERVER_LIST");
      sendRequestServerList();
    }

    function handleServerList(body: Buffer): void {
      const r = new PacketReader(body);
      r.skip(1); // opcode
      const serverCount = r.readUInt8();
      r.skip(1); // fixed 0x00
      let foundHost = "";
      let foundPort = 0;
      for (let i = 0; i < serverCount; i++) {
        const id = r.readUInt8();
        const ip = r.readBytes(4);
        const port = r.readInt32LE();
        r.skip(1); // ageLimit
        r.skip(1); // pvp
        r.skip(2); // online
        r.skip(2); // maxPlayers
        r.skip(1); // status
        r.skip(4); // fixed D 0
        r.skip(1); // fixed C 0
        if (id === cfg.serverId) {
          foundHost = `${ip[0]}.${ip[1]}.${ip[2]}.${ip[3]}`;
          foundPort = port;
        }
      }
      if (!foundHost) {
        fail(
          new Error(
            `ServerList: no server with id ${cfg.serverId} (${serverCount} servers listed)`,
          ),
        );
        return;
      }
      gameHost = foundHost;
      gamePort = foundPort;
      console.log(`[LOGIN] game server ${gameHost}:${gamePort}`);
      transition("WAIT_PLAY_OK");
      sendRequestServerLogin(cfg.serverId);
    }

    function handlePlayOk(body: Buffer): void {
      const r = new PacketReader(body);
      r.skip(1); // opcode
      const playOkId1 = r.readInt32LE();
      const playOkId2 = r.readInt32LE();
      const result: LoginResult = {
        loginOkId1,
        loginOkId2,
        playOkId1,
        playOkId2,
        gameHost,
        gamePort,
      };
      transition("DONE");
      if (!settled) {
        settled = true;
      }
      conn.close();
      resolve(result);
    }

    conn.onConnect = () => {
      console.log(
        `[LOGIN] connected to ${cfg.loginIp}:${cfg.loginPort}`,
      );
    };

    conn.onPacket = (frame: Buffer) => {
      if (settled) return;
      const body = frame.subarray(2); // strip [uint16LE size]
      if (body.length === 0) return;
      try {
        if (state === "WAIT_INIT") {
          assertState(state, "WAIT_INIT", "Init");
          // Init is the only packet decrypted with the static key; the opcode
          // only exists at offset 0 of the DECRYPTED body (wire byte 0 is
          // static-key Blowfish ciphertext).
          const dec = loginCrypt.decryptInit(Buffer.from(body));
          if (dec[0] !== LoginServerIn.Init) {
            fail(
              new Error(
                `Init: expected opcode 0x00, got 0x${dec[0].toString(16)}`,
              ),
            );
            return;
          }
          handleInit(dec);
          return;
        }
        // Every subsequent server body is Blowfish-decrypted with the session key.
        const dec = loginCrypt.decrypt(Buffer.from(body));
        const op = dec[0];
        switch (state) {
          case "WAIT_GG_AUTH": {
            if (op === LoginServerIn.GGAuth) {
              assertState(state, "WAIT_GG_AUTH", "GGAuth");
              handleGGAuth(dec);
            } else if (op === LoginServerIn.LoginOk) {
              // Some servers skip GGAuth: use ggResponse = 0 and continue.
              console.log("[LOGIN] GGAuth skipped by server, using ggResponse = 0");
              ggResponse = 0;
              assertState(state, "WAIT_GG_AUTH", "skipped GGAuth -> LoginOk");
              handleLoginOk(dec);
            } else {
              fail(
                new Error(
                  `WAIT_GG_AUTH: unexpected opcode 0x${op.toString(16)}`,
                ),
              );
            }
            return;
          }
          case "WAIT_LOGIN_OK": {
            if (op === LoginServerIn.LoginOk) {
              assertState(state, "WAIT_LOGIN_OK", "LoginOk");
              handleLoginOk(dec);
            } else if (op === LoginServerIn.LoginFail) {
              const reason = dec.length > 1 ? dec[1] : 0;
              fail(new Error(`LoginFail (reason ${reason})`));
            } else {
              fail(
                new Error(
                  `WAIT_LOGIN_OK: unexpected opcode 0x${op.toString(16)}`,
                ),
              );
            }
            return;
          }
          case "WAIT_SERVER_LIST": {
            if (op === LoginServerIn.ServerList) {
              assertState(state, "WAIT_SERVER_LIST", "ServerList");
              handleServerList(dec);
            } else {
              fail(
                new Error(
                  `WAIT_SERVER_LIST: unexpected opcode 0x${op.toString(16)}`,
                ),
              );
            }
            return;
          }
          case "WAIT_PLAY_OK": {
            if (op === LoginServerIn.PlayOk) {
              assertState(state, "WAIT_PLAY_OK", "PlayOk");
              handlePlayOk(dec);
            } else if (op === LoginServerIn.PlayFail) {
              fail(new Error("PlayFail"));
            } else {
              fail(
                new Error(
                  `WAIT_PLAY_OK: unexpected opcode 0x${op.toString(16)}`,
                ),
              );
            }
            return;
          }
          default:
            fail(new Error(`unexpected packet in state ${state}`));
        }
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    };

    // Server close before PlayOk must settle the promise — never leave it pending.
    conn.onClose = () => {
      if (!settled) {
        fail(new Error("Login server closed the connection before PlayOk"));
      }
    };

    conn.connect(cfg.loginIp, cfg.loginPort);
  });
}
