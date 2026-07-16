import type { Config } from "../config";
import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { GameCrypt } from "./GameCrypt";
import {
  AuthRequest,
  CharacterSelected,
  CharSelectInfo,
  CharSelected,
  ExtendedOpcode,
  NetPing,
  NetPingRequest,
  ProtocolVersion,
  ServerExtendedOpcode,
  UserInfo,
  CryptInit,
} from "../game/opcodes";
import {
  check,
  logState,
  report,
  runGameCryptoSelfTests,
  passedCount,
  totalCount,
} from "../debug/DebugTools";

export interface GamePhaseInput {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
}

export function runGamePhase(
  cfg: Config,
  input: GamePhaseInput,
  phase: 3 | 4,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (phase !== 3) {
      reject(new Error(`Phase ${phase} is not implemented in PHASE 3 scope`));
      return;
    }

    runGameCryptoSelfTests();
    if (passedCount() !== totalCount()) {
      report({
        phase: 3,
        statePath: "IDLE",
        artifacts: "none",
        notes: "Crypto self-tests failed before socket I/O",
      });
      reject(new Error("Game crypto self-tests failed"));
      return;
    }

    const conn = new Connection();
    const gameCrypt = new GameCrypt();

    let state = "IDLE";
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
        phase: 3,
        statePath: `IDLE -> ${state}`,
        artifacts: "none",
        notes,
      });
      reject(err);
    }

    function succeed(): void {
      if (settled) return;
      settled = true;
      report({
        phase: 3,
        statePath:
          "IDLE -> WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED -> WAIT_USER_INFO",
        artifacts: "none",
        notes: "-",
      });
      conn.close();
      resolve();
    }

    function sendPong(pingId: number): void {
      const pong = new PacketWriter()
        .writeUInt8(NetPing)
        .writeInt32LE(pingId)
        .writeInt32LE(0)
        .writeInt32LE(0x00080000)
        .toBuffer();
      conn.send(gameCrypt.encrypt(pong));
    }

    conn.onConnect = () => {
      console.log(`[GAME] connected to ${input.gameHost}:${input.gamePort}`);
      transition("WAIT_CRYPT_INIT");

      const protocol = new PacketWriter()
        .writeUInt8(ProtocolVersion)
        .writeInt32LE(cfg.protocol)
        .toBuffer();
      // ProtocolVersion is always sent raw, before CryptInit.
      conn.send(protocol);
    };

    conn.onClose = () => {
      if (!settled) {
        settleFail(
          new Error("Connection closed unexpectedly"),
          "Connection closed before reaching WAIT_USER_INFO",
        );
      }
    };

    conn.onPacket = (packet) => {
      try {
        let body = packet.subarray(2);
        if (gameCrypt.isEnabled()) {
          body = gameCrypt.decrypt(body);
        }

        const opcode = body[0]!;
        const reader = new PacketReader(body, 1);

        // NetPingRequest (simple form).
        if (opcode === NetPingRequest) {
          const pingId = reader.readInt32LE();
          sendPong(pingId);
          return;
        }

        // Server-extended packets; only NetPingRequest is handled here.
        if (opcode === ServerExtendedOpcode) {
          const subOpcode = reader.readUInt16LE();
          if (subOpcode === NetPingRequest) {
            const pingId = reader.readInt32LE();
            sendPong(pingId);
            return;
          }
          // Unknown extended packet — ignore to avoid failing on noise.
          return;
        }

        if (state === "WAIT_CRYPT_INIT" && opcode === CryptInit) {
          reader.readUInt8(); // status
          const xorKey = reader.readBytes(8);
          const encryptionFlag = reader.readInt32LE();

          gameCrypt.init(xorKey, encryptionFlag !== 0);

          if (
            !check(
              "crypt flag honored",
              gameCrypt.isEnabled() === (encryptionFlag !== 0),
            )
          ) {
            settleFail(
              new Error("Crypt flag not honored"),
              `crypt flag honored: expected ${encryptionFlag !== 0}, got ${gameCrypt.isEnabled()}`,
            );
            return;
          }

          transition("WAIT_CHAR_LIST");

          const authReq = new PacketWriter()
            .writeUInt8(AuthRequest)
            .writeStringNullUTF16(cfg.username)
            .writeInt32LE(input.playOkId2)
            .writeInt32LE(input.playOkId1)
            .writeInt32LE(input.loginOkId1)
            .writeInt32LE(input.loginOkId2)
            .toBuffer();
          conn.send(gameCrypt.encrypt(authReq));
          return;
        }

        if (state === "WAIT_CHAR_LIST" && opcode === CharSelectInfo) {
          const charCount = reader.readInt32LE();
          if (!check("charCount >= 1", charCount >= 1)) {
            settleFail(
              new Error("No characters available"),
              `charCount=${charCount} < 1`,
            );
            return;
          }

          transition("WAIT_CHAR_SELECTED");

          const charSel = new PacketWriter()
            .writeUInt8(CharacterSelected)
            .writeInt32LE(cfg.charSlot)
            .writeBytes(Buffer.alloc(14))
            .toBuffer();
          conn.send(gameCrypt.encrypt(charSel));
          return;
        }

        if (state === "WAIT_CHAR_SELECTED" && opcode === CharSelected) {
          transition("WAIT_USER_INFO");
          succeed();
          return;
        }

        // Tolerate the server skipping CharSelected and jumping straight to UserInfo.
        if (state === "WAIT_CHAR_SELECTED" && opcode === UserInfo) {
          transition("WAIT_USER_INFO");
          succeed();
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

    conn.connect(input.gameHost, input.gamePort);
  });
}

// Convenience re-export for callers that need the prefix helper.
export { ExtendedOpcode };
