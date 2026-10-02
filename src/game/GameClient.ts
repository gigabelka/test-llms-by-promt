// Game-server state machine. runGame opens a fresh connection, enters the world, prints IN_GAME
// (exactly once) on UserInfo, answers pings for 60 s, then resolves with the report artifacts.
//
// `onInGame` is an optional bridge so index.ts can cancel its 45 s whole-run watchdog the instant
// IN_GAME is reached (the watchdog bounds time-to-IN_GAME; the 60 s keepalive governs thereafter).
import { Connection } from "../net/Connection.ts";
import { PacketReader } from "../net/PacketReader.ts";
import { PacketWriter } from "../net/PacketWriter.ts";
import { GameCrypt } from "../crypto/GameCrypt.ts";
import { OPCODES, ExtendedOpcode, ServerExtendedOpcode } from "./Opcodes.ts";
import { check, logState } from "../debug/DebugTools.ts";
import type { Artifacts, Config, GameInput, GameState } from "../types.ts";

const CONNECT_TIMEOUT_MS = 10_000;
const STATE_TIMEOUT_MS = 15_000;
const KEEPALIVE_MS = 60_000;
const UNKNOWN_PACKET_LIMIT = 10;

export async function runGame(
  cfg: Config,
  input: GameInput,
  statePath: string[],
  onInGame?: () => void,
): Promise<Artifacts> {
  return new Promise<Artifacts>((resolve, reject) => {
    const conn = new Connection();
    const gameCrypt = new GameCrypt();
    const targetHost = input.gameHost;
    const targetPort = input.gamePort && input.gamePort !== 0 ? input.gamePort : cfg.gamePort;

    let state: GameState = "WAIT_CRYPT_INIT";
    let unknownCount = 0;
    let encryptionFlag = 0;
    let charCount = 0;
    let pingsAnswered = 0;
    let enterWorldSent = false;
    let resolved = false;
    let stateTimer: ReturnType<typeof setTimeout> | null = null;
    let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (stateTimer) {
        clearTimeout(stateTimer);
        stateTimer = null;
      }
      if (keepaliveTimer) {
        clearTimeout(keepaliveTimer);
        keepaliveTimer = null;
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
      stateTimer = setTimeout(() => {
        settle(() => reject(new Error(`timeout in ${state}`)));
      }, STATE_TIMEOUT_MS);
    };

    const transition = (next: GameState): void => {
      statePath.push(next);
      logState(state, next);
      state = next;
      unknownCount = 0;
      if (next === "IN_GAME") {
        // IN_GAME is governed by the keepalive, not the no-progress timer.
        if (stateTimer) clearTimeout(stateTimer);
        stateTimer = null;
      } else {
        armStateTimer();
      }
    };

    const fail = (msg: string): void => settle(() => reject(new Error(msg)));

    const sendAuthRequest = () => {
      const body = new PacketWriter()
        .writeUInt8(OPCODES.game.out.AuthRequest)
        .writeStringNullUTF16(input.username)
        .writeInt32LE(input.playOkId2)
        .writeInt32LE(input.playOkId1)
        .writeInt32LE(input.loginOkId1)
        .writeInt32LE(input.loginOkId2)
        .toBuffer();
      conn.send(gameCrypt.encrypt(body));
    };

    const sendCharacterSelected = () => {
      const body = new PacketWriter()
        .writeUInt8(OPCODES.game.out.CharacterSelected)
        .writeInt32LE(cfg.charSlot)
        .writeBytes(Buffer.alloc(14))
        .toBuffer();
      conn.send(gameCrypt.encrypt(body));
    };

    // RequestKeyMapping (0xD0 0x0021) then EnterWorld (0x11 + 104 zero bytes). Sent at most once.
    const sendEnterWorld = () => {
      if (enterWorldSent) return;
      enterWorldSent = true;
      const km = new PacketWriter()
        .writeUInt8(ExtendedOpcode)
        .writeUInt16LE(OPCODES.game.out.RequestKeyMapping)
        .toBuffer();
      conn.send(gameCrypt.encrypt(km));
      const ew = new PacketWriter()
        .writeUInt8(OPCODES.game.out.EnterWorld)
        .writeBytes(Buffer.alloc(104))
        .toBuffer();
      conn.send(gameCrypt.encrypt(ew));
    };

    const handlePing = (pingId: number): void => {
      const body = new PacketWriter()
        .writeUInt8(OPCODES.game.out.NetPing)
        .writeInt32LE(pingId)
        .writeInt32LE(0)
        .writeInt32LE(0x00080000)
        .toBuffer();
      conn.send(gameCrypt.encrypt(body));
      pingsAnswered += 1;
    };

    const enterWorld = (): void => {
      console.log("IN_GAME");
      if (onInGame) onInGame();
      transition("IN_GAME");
      keepaliveTimer = setTimeout(() => {
        settle(() => {
          conn.close();
          resolve({
            gameHost: targetHost,
            gamePort: targetPort,
            serverId: cfg.serverId,
            charCount,
            // Artifacts is verbatim (string | number); render the flag as true/false.
            ggSkipped: input.ggSkipped ? "true" : "false",
            encryptionFlag,
            pingsAnswered,
          });
        });
      }, KEEPALIVE_MS);
    };

    const dropSilently = (): void => {
      // WAIT_USER_INFO and IN_GAME drop every non-ping packet with no counter.
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

    const dispatch = (body: Buffer): void => {
      try {
        // Ping first: answered in every state, never counted as unknown.
        const probe = new PacketReader(body);
        const first = probe.readUInt8();
        let pingId = 0;
        let isPing = false;
        if (first === OPCODES.game.in.NetPingRequest) {
          pingId = probe.readInt32LE();
          isPing = true;
        } else if (first === ServerExtendedOpcode) {
          const sub = probe.readUInt16LE();
          if (sub === OPCODES.game.in.NetPingRequest) {
            pingId = probe.readInt32LE();
            isPing = true;
          }
        }
        if (isPing) {
          handlePing(pingId);
          armStateTimer();
          return;
        }

        switch (state) {
          case "WAIT_CRYPT_INIT": {
            if (first === OPCODES.game.in.CryptInit) {
              const r = new PacketReader(body);
              r.readUInt8(); // opcode 0x2E
              r.readUInt8(); // status — exists, do not skip
              const xorKey = r.readBytes(8);
              encryptionFlag = r.readInt32LE();
              gameCrypt.init(xorKey, encryptionFlag !== 0);
              transition("WAIT_CHAR_LIST");
              sendAuthRequest();
            } else {
              failUnknown(first);
            }
            break;
          }
          case "WAIT_CHAR_LIST": {
            if (first === OPCODES.game.in.CharSelectInfo) {
              const r = new PacketReader(body);
              r.readUInt8(); // opcode
              charCount = r.readInt32LE();
              check("charCount >= 1", charCount >= 1);
              console.log(`[info] charCount=${charCount}`);
              transition("WAIT_CHAR_SELECTED");
              sendCharacterSelected();
            } else {
              failUnknown(first);
            }
            break;
          }
          case "WAIT_CHAR_SELECTED": {
            if (first === OPCODES.game.in.CharSelected) {
              transition("WAIT_USER_INFO");
              sendEnterWorld();
            } else if (first === OPCODES.game.in.UserInfo) {
              // UserInfo arrived early: send enter-world, treat THIS packet as the UserInfo.
              enterWorld();
            } else {
              failUnknown(first);
            }
            break;
          }
          case "WAIT_USER_INFO": {
            if (first === OPCODES.game.in.UserInfo) {
              enterWorld();
            } else {
              dropSilently();
            }
            break;
          }
          case "IN_GAME":
            dropSilently();
            break;
          default:
            break;
        }
      } catch (e) {
        fail(`dispatch error in ${state}: ${(e as Error).message}`);
      }
    };

    // ProtocolVersion is sent raw, before CryptInit, so before game encryption is enabled.
    conn.onConnect = () => {
      if (connectTimer) clearTimeout(connectTimer);
      const version = new PacketWriter()
        .writeUInt8(OPCODES.game.out.ProtocolVersion)
        .writeInt32LE(cfg.protocol)
        .toBuffer();
      conn.send(version);
      const from = statePath[statePath.length - 1] ?? "IDLE";
      statePath.push(state);
      logState(from, state);
      armStateTimer();
    };

    conn.onPacket = (frame: Buffer) => {
      try {
        // CryptInit arrives before init (cipher disabled => decrypt is identity); later bodies
        // are XOR-decrypted. Either way the length prefix is never part of the ciphered body.
        const plain = gameCrypt.decrypt(frame.subarray(2));
        dispatch(plain);
        armStateTimer();
      } catch (e) {
        fail(`receive error in ${state}: ${(e as Error).message}`);
      }
    };

    conn.onClose = () => {
      settle(() => reject(new Error("game socket closed before UserInfo")));
    };

    connectTimer = setTimeout(() => {
      settle(() => reject(new Error(`connect timeout ${targetHost}:${targetPort}`)));
    }, CONNECT_TIMEOUT_MS);

    conn.connect(targetHost, targetPort);
  });
}
