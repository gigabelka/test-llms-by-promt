// Login-server state machine. runLogin wires the packets, applies crypto per PACKET PIPELINE,
// bounds every wait per TIMEOUTS & LIVENESS, and settles its promise exactly once.
//
// Note: LoginResult gains a `ggSkipped` field (added to the verbatim type) so the stage can feed
// the required `ggSkipped` report artifact forward to the game stage via GameInput.
import { Connection } from "../net/Connection.ts";
import { PacketReader } from "../net/PacketReader.ts";
import { PacketWriter } from "../net/PacketWriter.ts";
import { LoginCrypt } from "../crypto/LoginCrypt.ts";
import { unscrambleModulus } from "../crypto/ScrambledRsaKey.ts";
import { encryptCredentials } from "../crypto/RsaCrypt.ts";
import { OPCODES } from "../game/Opcodes.ts";
import { check, logState } from "../debug/DebugTools.ts";
import type { Config, LoginResult, LoginState } from "../types.ts";

// 0x00000123, 0x00004567, 0x000089AB, 0x0000CDEF as four little-endian words.
const GG_CONSTANTS_16 = Buffer.from([
  0x23, 0x01, 0x00, 0x00, 0x67, 0x45, 0x00, 0x00, 0xab, 0x89, 0x00, 0x00, 0xef, 0xcd, 0x00, 0x00,
]);
// The fixed 43-byte GG tail appended to RequestAuthLogin (16-byte block + 08 00 00 00 + 23 zero bytes).
const GG_BLOCK_43 = Buffer.from([
  0x23, 0x01, 0x00, 0x00, 0x67, 0x45, 0x00, 0x00, 0xab, 0x89, 0x00, 0x00, 0xef, 0xcd, 0x00, 0x00,
  0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

// Budgets (ms): 10 s connect, 15 s per WAIT_* state (no-progress), 3 s for WAIT_GG_AUTH.
// The 45 s whole-run watchdog is owned by index.ts.
const CONNECT_TIMEOUT_MS = 10_000;
const STATE_TIMEOUT_MS = 15_000;
const GG_AUTH_TIMEOUT_MS = 3_000;
const UNKNOWN_PACKET_LIMIT = 10;

export function runLogin(cfg: Config, statePath: string[]): Promise<LoginResult> {
  return new Promise<LoginResult>((resolve, reject) => {
    const conn = new Connection();
    const loginCrypt = new LoginCrypt();

    let state: LoginState = "WAIT_INIT";
    let unknownCount = 0;
    let ggSkipped = false;
    let ggResponse = 0;
    let sessionId = 0;
    let modulus: Buffer | null = null;
    let loginOkId1 = 0;
    let loginOkId2 = 0;
    let playOkId1 = 0;
    let playOkId2 = 0;
    let gameHost = "";
    let gamePort = 0;
    let resolved = false;
    let pending: Buffer | null = null;
    let stateTimer: ReturnType<typeof setTimeout> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (stateTimer) {
        clearTimeout(stateTimer);
        stateTimer = null;
      }
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
    };

    const settle = (fn: () => void): void => {
      if (resolved) return;
      resolved = true;
      clearTimers();
      fn();
    };

    const armStateTimer = () => {
      if (stateTimer) clearTimeout(stateTimer);
      const dur = state === "WAIT_GG_AUTH" ? GG_AUTH_TIMEOUT_MS : STATE_TIMEOUT_MS;
      stateTimer = setTimeout(() => {
        if (state === "WAIT_GG_AUTH") {
          skipGG(); // silence for 3 s => GG skipped
        } else {
          settle(() => reject(new Error(`timeout in ${state}`)));
        }
      }, dur);
    };

    const transition = (next: LoginState): void => {
      statePath.push(next);
      logState(state, next);
      state = next;
      unknownCount = 0;
      armStateTimer();
    };

    // Leave WAIT_GG_AUTH as "GG skipped": response 0, log, send AuthLogin, re-dispatch the packet.
    const skipGG = (replay?: Buffer): void => {
      if (resolved) return;
      ggSkipped = true;
      ggResponse = 0;
      transition("WAIT_LOGIN_OK");
      sendAuthLogin();
      if (replay) pending = replay;
    };

    // Outgoing login packets are all Blowfish-encrypted once the session key is installed.
    const send = (body: Buffer): void => {
      conn.send(loginCrypt.encrypt(body));
    };

    const sendGGAuth = () => {
      const body = new PacketWriter()
        .writeUInt8(OPCODES.login.out.RequestGGAuth)
        .writeInt32LE(sessionId)
        .writeBytes(GG_CONSTANTS_16)
        .writeBytes(Buffer.alloc(19))
        .toBuffer();
      send(body);
    };

    const sendAuthLogin = () => {
      if (!modulus) return;
      const body = new PacketWriter()
        .writeUInt8(OPCODES.login.out.RequestAuthLogin)
        .writeBytes(encryptCredentials(cfg.username, cfg.password, modulus))
        .writeInt32LE(ggResponse)
        .writeBytes(GG_BLOCK_43)
        .toBuffer();
      send(body);
    };

    const sendServerList = () => {
      const body = new PacketWriter()
        .writeUInt8(OPCODES.login.out.RequestServerList)
        .writeInt32LE(loginOkId1)
        .writeInt32LE(loginOkId2)
        .writeInt32LE(0x04000000)
        .toBuffer();
      send(body);
    };

    const sendServerLogin = () => {
      const body = new PacketWriter()
        .writeUInt8(OPCODES.login.out.RequestServerLogin)
        .writeInt32LE(loginOkId1)
        .writeInt32LE(loginOkId2)
        .writeUInt8(cfg.serverId)
        .toBuffer();
      send(body);
    };

    const fail = (msg: string): void => settle(() => reject(new Error(msg)));

    const dispatch = (body: Buffer): void => {
      try {
        const opcode = body[0];
        switch (state) {
          case "WAIT_INIT": {
            if (opcode !== OPCODES.login.in.Init) {
              failUnknown(opcode);
              return;
            }
            const r = new PacketReader(body);
            r.readUInt8(); // opcode 0x00
            sessionId = r.readInt32LE(); // off 1
            r.readInt32LE(); // off 5, protocol revision
            modulus = unscrambleModulus(r.readBytes(128)); // off 9
            check("modulus is 128 bytes", modulus.length === 128);
            r.skip(16); // off 137, unknown b[16]
            loginCrypt.setSessionKey(r.readBytes(16)); // off 153, install BEFORE sending
            transition("WAIT_GG_AUTH");
            sendGGAuth();
            break;
          }
          case "WAIT_GG_AUTH": {
            if (opcode === OPCODES.login.in.GGAuth) {
              const r = new PacketReader(body);
              r.readUInt8(); // opcode
              ggResponse = r.readInt32LE(); // keep GG response
              transition("WAIT_LOGIN_OK");
              sendAuthLogin();
            } else {
              // A non-0x0B packet, or the 3 s timer, means GG was skipped.
              skipGG(body);
            }
            break;
          }
          case "WAIT_LOGIN_OK": {
            if (opcode === OPCODES.login.in.LoginOk) {
              const r = new PacketReader(body);
              r.readUInt8();
              loginOkId1 = r.readInt32LE();
              loginOkId2 = r.readInt32LE();
              transition("WAIT_SERVER_LIST");
              sendServerList();
            } else if (opcode === OPCODES.login.in.LoginFail) {
              const r = new PacketReader(body);
              r.readUInt8();
              fail(`LoginFail: ${r.readUInt8()}`);
            } else {
              failUnknown(opcode);
            }
            break;
          }
          case "WAIT_SERVER_LIST": {
            if (opcode === OPCODES.login.in.ServerList) {
              const r = new PacketReader(body);
              r.readUInt8(); // opcode
              const serverCount = r.readUInt8();
              r.readUInt8(); // 0x00
              const foundIds: number[] = [];
              for (let i = 0; i < serverCount; i++) {
                const id = r.readUInt8();
                const ip = r.readBytes(4);
                const port = r.readInt32LE();
                r.skip(14); // ageLimit, pvp, online, maxPlayers, status, D 0, 0
                if (id === cfg.serverId) {
                  gameHost = `${ip[0]}.${ip[1]}.${ip[2]}.${ip[3]}`;
                  gamePort = port;
                } else {
                  foundIds.push(id);
                }
              }
              if (!gameHost) {
                fail(`ServerList: no server with id ${cfg.serverId}, found [${foundIds.join(",")}]`);
                return;
              }
              transition("WAIT_PLAY_OK");
              sendServerLogin();
            } else {
              failUnknown(opcode);
            }
            break;
          }
          case "WAIT_PLAY_OK": {
            if (opcode === OPCODES.login.in.PlayOk) {
              const r = new PacketReader(body);
              r.readUInt8();
              playOkId1 = r.readInt32LE();
              playOkId2 = r.readInt32LE();
              const result: LoginResult = {
                loginOkId1,
                loginOkId2,
                playOkId1,
                playOkId2,
                gameHost,
                gamePort,
                ggSkipped,
              };
              settle(() => {
                conn.close();
                resolve(result);
              });
            } else if (opcode === OPCODES.login.in.PlayFail) {
              const r = new PacketReader(body);
              r.readUInt8();
              fail(`PlayFail: ${r.readInt32LE()}`);
            } else {
              failUnknown(opcode);
            }
            break;
          }
          default:
            break;
        }
      } catch (e) {
        fail(`dispatch error in ${state}: ${(e as Error).message}`);
      }
    };

    const failUnknown = (opcode: number): void => {
      unknownCount += 1;
      console.log(
        `[unknown] ${state}: opcode 0x${opcode.toString(16).padStart(2, "0")}`,
      );
      if (unknownCount > UNKNOWN_PACKET_LIMIT) {
        fail(
          `unknown packet budget exhausted in ${state}: 0x${opcode.toString(16).padStart(2, "0")}`,
        );
      }
    };

    conn.onConnect = () => {
      if (connectTimer) clearTimeout(connectTimer);
      statePath.push(state);
      logState("IDLE", state);
      armStateTimer();
    };

    conn.onPacket = (frame: Buffer) => {
      try {
        const raw = frame.subarray(2); // length prefix is never encrypted
        const plain =
          state === "WAIT_INIT" ? loginCrypt.decryptInit(raw) : loginCrypt.decrypt(raw);
        const packet = pending !== null ? pending : plain;
        pending = null;
        dispatch(packet);
        // No-progress timer: restart on every frame fully parsed in this state (drops/pings included).
        armStateTimer();
      } catch (e) {
        fail(`receive error in ${state}: ${(e as Error).message}`);
      }
    };

    conn.onClose = () => {
      settle(() => reject(new Error("login socket closed before PlayOk")));
    };

    connectTimer = setTimeout(() => {
      settle(() => reject(new Error(`connect timeout ${cfg.loginIp}:${cfg.loginPort}`)));
    }, CONNECT_TIMEOUT_MS);

    conn.connect(cfg.loginIp, cfg.loginPort);
  });
}
