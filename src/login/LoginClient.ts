import { mkdirSync, writeFileSync } from "node:fs";
import type { Config } from "../config";
import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { encryptCredentials } from "../crypto/RsaCrypt";
import { unscrambleModulus } from "../crypto/ScrambledRsaKey";
import {
  Init,
  RequestGGAuth,
  GGAuth,
  RequestAuthLogin,
  LoginOk,
  LoginFail,
  RequestServerList,
  ServerList,
  RequestServerLogin,
  PlayOk,
  PlayFail,
} from "../game/opcodes";
import { check, logState, report, runLoginCryptoSelfTests } from "../debug/DebugTools";

export interface LoginResult {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
}

export function runLoginPhase(cfg: Config): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    runLoginCryptoSelfTests();

    const conn = new Connection();
    const loginCrypt = new LoginCrypt();

    let state = "IDLE";
    let sessionId = 0;
    let unscrambledModulus: Buffer = Buffer.alloc(0);
    let ggResponse = 0;
    let loginOkId1 = 0;
    let loginOkId2 = 0;
    let gameHost = "";
    let gamePort = 0;
    let settled = false;

    function transition(to: string): void {
      logState(state, to);
      state = to;
    }

    function settleFail(err: unknown, notes: string): void {
      if (settled) return;
      settled = true;
      conn.close();
      check(notes, false);
      report({
        phase: 2,
        statePath: `IDLE -> ${state}`,
        artifacts: "none",
        notes,
      });
      reject(err);
    }

    function succeed(result: LoginResult): void {
      if (settled) return;
      settled = true;
      conn.close();

      mkdirSync("artifacts", { recursive: true });
      writeFileSync(
        "artifacts/phase-2-output.json",
        JSON.stringify(result, null, 2),
      );

      const artifacts =
        `loginOkId1=${result.loginOkId1}, loginOkId2=${result.loginOkId2}, ` +
        `playOkId1=${result.playOkId1}, playOkId2=${result.playOkId2}, ` +
        `gameHost=${result.gameHost}, gamePort=${result.gamePort}`;
      report({
        phase: 2,
        statePath:
          "IDLE -> WAIT_INIT -> WAIT_GG_AUTH -> WAIT_LOGIN_OK -> WAIT_SERVER_LIST -> WAIT_PLAY_OK",
        artifacts,
        notes: "-",
      });
      resolve(result);
    }

    function sendAuthLogin(): void {
      const ggBlock = Buffer.from([
        0x23, 0x01, 0x00, 0x00, 0x67, 0x45, 0x00, 0x00, 0xab, 0x89, 0x00, 0x00,
        0xef, 0xcd, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const rsa = encryptCredentials(
        cfg.username,
        cfg.password,
        unscrambledModulus,
      );
      const req = new PacketWriter()
        .writeUInt8(RequestAuthLogin)
        .writeBytes(rsa)
        .writeInt32LE(ggResponse)
        .writeBytes(ggBlock)
        .toBuffer();
      conn.send(loginCrypt.encrypt(req));
    }

    function handleLoginOk(reader: PacketReader): void {
      loginOkId1 = reader.readInt32LE();
      loginOkId2 = reader.readInt32LE();
      transition("WAIT_SERVER_LIST");
      const req = new PacketWriter()
        .writeUInt8(RequestServerList)
        .writeInt32LE(loginOkId1)
        .writeInt32LE(loginOkId2)
        .writeInt32LE(0x04000000)
        .toBuffer();
      conn.send(loginCrypt.encrypt(req));
    }

    conn.onConnect = () => {
      console.log(`[LOGIN] connected to ${cfg.loginIp}:${cfg.loginPort}`);
      transition("WAIT_INIT");
    };

    conn.onClose = () => {
      if (!settled) {
        settleFail(
          new Error("Connection closed unexpectedly"),
          "Connection closed before PlayOk",
        );
      }
    };

    conn.onPacket = (packet) => {
      try {
        const body = packet.subarray(2);
        const opcode = body[0]!;
        const reader = new PacketReader(body, 1);

        if (state === "WAIT_INIT" && opcode === Init) {
          const decrypted = loginCrypt.decryptInit(body);
          const initReader = new PacketReader(decrypted);
          initReader.readUInt8(); // opcode
          sessionId = initReader.readInt32LE();
          initReader.readInt32LE(); // protocol revision
          const scrambledModulus = initReader.readBytes(128);
          initReader.skip(16);
          const blowfishKey = initReader.readBytes(16);
          unscrambledModulus = unscrambleModulus(scrambledModulus);
          check("modulus is 128 bytes", unscrambledModulus.length === 128);
          loginCrypt.setSessionKey(blowfishKey);

          transition("WAIT_GG_AUTH");
          const req = new PacketWriter()
            .writeUInt8(RequestGGAuth)
            .writeInt32LE(sessionId)
            .writeInt32LE(0x00000123)
            .writeInt32LE(0x00004567)
            .writeInt32LE(0x000089ab)
            .writeInt32LE(0x0000cdef)
            .writeBytes(Buffer.alloc(19))
            .toBuffer();
          conn.send(loginCrypt.encrypt(req));
          return;
        }

        if (state === "WAIT_GG_AUTH" && opcode === GGAuth) {
          ggResponse = reader.readInt32LE();
          transition("WAIT_LOGIN_OK");
          sendAuthLogin();
          return;
        }

        // Skipped-GGAuth edge case: server sends LoginOk before GGAuth.
        if (state === "WAIT_GG_AUTH" && opcode === LoginOk) {
          ggResponse = 0;
          transition("WAIT_LOGIN_OK");
          handleLoginOk(reader);
          return;
        }

        if (state === "WAIT_LOGIN_OK" && opcode === LoginOk) {
          handleLoginOk(reader);
          return;
        }

        if (opcode === LoginFail) {
          const reason = reader.readUInt8();
          settleFail(
            new Error(`LoginFail reason=${reason}`),
            `LoginFail reason=${reason}`,
          );
          return;
        }

        if (state === "WAIT_SERVER_LIST" && opcode === ServerList) {
          const serverCount = reader.readUInt8();
          reader.skip(1);
          let found = false;
          for (let i = 0; i < serverCount; i++) {
            const id = reader.readUInt8();
            const ipBytes = reader.readBytes(4);
            const port = reader.readInt32LE();
            reader.skip(12);
            if (id === cfg.serverId) {
              found = true;
              gameHost = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;
              gamePort = port;
            }
          }
          if (!found) {
            settleFail(
              new Error(`Server id ${cfg.serverId} not found`),
              `Server id ${cfg.serverId} not found in server list`,
            );
            return;
          }

          transition("WAIT_PLAY_OK");
          const req = new PacketWriter()
            .writeUInt8(RequestServerLogin)
            .writeInt32LE(loginOkId1)
            .writeInt32LE(loginOkId2)
            .writeUInt8(cfg.serverId)
            .toBuffer();
          conn.send(loginCrypt.encrypt(req));
          return;
        }

        if (state === "WAIT_PLAY_OK" && opcode === PlayOk) {
          const playOkId1 = reader.readInt32LE();
          const playOkId2 = reader.readInt32LE();
          succeed({
            loginOkId1,
            loginOkId2,
            playOkId1,
            playOkId2,
            gameHost,
            gamePort,
          });
          return;
        }

        if (opcode === PlayFail) {
          const reason = reader.readUInt8();
          settleFail(
            new Error(`PlayFail reason=${reason}`),
            `PlayFail reason=${reason}`,
          );
          return;
        }

        settleFail(
          new Error(
            `Unhandled packet opcode=0x${opcode.toString(16)} in state ${state}`,
          ),
          `Unhandled packet opcode=0x${opcode.toString(16)} in state ${state}`,
        );
      } catch (err) {
        settleFail(err, String(err));
      }
    };

    conn.connect(cfg.loginIp, cfg.loginPort);
  });
}
