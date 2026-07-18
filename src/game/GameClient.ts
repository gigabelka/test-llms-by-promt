import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { GameCrypt } from "./GameCrypt";
import {
  GameServerIn,
  GameClientOut,
  ExtendedOpcode,
  ServerExtendedOpcode,
  NetPingRequestExtSubOpcode,
} from "./Opcodes";
import { logState, assertState, check } from "../debug/DebugTools";
import { Config } from "../config";
import { LoginResult } from "../login/LoginClient";

type GameState =
  | "WAIT_CRYPT_INIT"
  | "WAIT_CHAR_LIST"
  | "WAIT_CHAR_SELECTED"
  | "WAIT_USER_INFO"
  | "IN_GAME";

const KEEPALIVE_MS = 60_000;
const MAX_UNKNOWN_PACKETS = 10;

// Game-server FSM: WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED -> WAIT_USER_INFO -> IN_GAME.
export function runGame(
  cfg: Config,
  input: LoginResult,
  statePath: string[],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const conn = new Connection();
    const crypt = new GameCrypt();
    let state: GameState = "WAIT_CRYPT_INIT";
    let settled = false;
    let enterWorldSent = false;
    let unknownCount = 0;
    let keepaliveTimer: NodeJS.Timeout | null = null;

    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      if (keepaliveTimer !== null) clearTimeout(keepaliveTimer);
      conn.close();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const done = (): void => {
      if (settled) return;
      settled = true;
      conn.close();
      resolve();
    };

    const transition = (to: GameState): void => {
      logState(state, to);
      state = to;
      statePath.push(to);
    };

    // Bodies go through GameCrypt; when the CryptInit flag was 0 this is passthrough.
    const sendEncrypted = (body: Buffer): void => {
      conn.send(crypt.encrypt(body));
    };

    // Enter world = RequestKeyMapping (0xD0 0x0021) then EnterWorld 0x11 + 104 zeros. At most once.
    const sendEnterWorld = (): void => {
      if (enterWorldSent) return;
      enterWorldSent = true;
      const km = new PacketWriter();
      km.writeUInt8(ExtendedOpcode);
      km.writeUInt16LE(GameClientOut.RequestKeyMapping); // sub-opcode 0x0021 LE
      sendEncrypted(km.toBuffer());
      const ew = new PacketWriter();
      ew.writeUInt8(GameClientOut.EnterWorld);
      ew.writeBytes(Buffer.alloc(104)); // exactly 104 zero bytes
      sendEncrypted(ew.toBuffer());
    };

    // 13-byte pong: C 0xA8 + D pingId + D 0 + D 0x00080000.
    const sendPong = (pingId: number): void => {
      const w = new PacketWriter();
      w.writeUInt8(GameClientOut.NetPing);
      w.writeInt32LE(pingId);
      w.writeInt32LE(0x00000000);
      w.writeInt32LE(0x00080000);
      sendEncrypted(w.toBuffer());
    };

    const isPingRequest = (opcode: number, body: Buffer): boolean =>
      opcode === GameServerIn.NetPingRequest ||
      (opcode === ServerExtendedOpcode &&
        body.length >= 3 &&
        body.readUInt16LE(1) === NetPingRequestExtSubOpcode);

    const readPingId = (opcode: number, body: Buffer): number =>
      opcode === ServerExtendedOpcode
        ? body.readInt32LE(3)
        : body.readInt32LE(1);

    const tolerateUnknown = (opcode: number): void => {
      unknownCount++;
      console.log(
        `unknown packet 0x${opcode.toString(16)} in ${state} (${unknownCount}/${MAX_UNKNOWN_PACKETS})`,
      );
      if (unknownCount > MAX_UNKNOWN_PACKETS) {
        throw new Error(`too many unknown packets in ${state}`);
      }
    };

    const onUserInfo = (): void => {
      console.log("IN_GAME");
      transition("IN_GAME");
      // Keep the connection alive (answering pings) for 60s, then close cleanly.
      keepaliveTimer = setTimeout(() => {
        keepaliveTimer = null;
        done();
      }, KEEPALIVE_MS);
    };

    conn.onConnect = () => {
      // ProtocolVersion is sent immediately, RAW (before CryptInit / any game encryption).
      const w = new PacketWriter();
      w.writeUInt8(GameClientOut.ProtocolVersion);
      w.writeInt32LE(cfg.protocol);
      conn.send(w.toBuffer());
    };

    conn.onClose = () => {
      if (keepaliveTimer !== null) {
        clearTimeout(keepaliveTimer);
        keepaliveTimer = null;
      }
      // Never leave the promise pending if the server closes before UserInfo.
      if (!settled) {
        fail(new Error(`game server closed connection in state ${state}`));
      }
    };

    conn.onPacket = (frame) => {
      try {
        let body: Buffer = frame.subarray(2); // strip 2-byte size
        // CryptInit itself is unencrypted; everything after goes through GameCrypt.
        if (state !== "WAIT_CRYPT_INIT") {
          body = crypt.decrypt(Buffer.from(body));
        }
        const r = new PacketReader(body);
        const opcode = r.readUInt8();

        switch (state) {
          case "WAIT_CRYPT_INIT": {
            assertState(state, "WAIT_CRYPT_INIT", "CryptInit");
            if (opcode !== GameServerIn.CryptInit) {
              throw new Error(
                `expected CryptInit 0x2E, got 0x${opcode.toString(16)}`,
              );
            }
            r.readUInt8(); // status
            const xorKey = r.readBytes(8);
            const encryptionFlag = r.readInt32LE();
            // Flag-driven: apply the 16-byte shifting XOR only when the flag is non-zero.
            crypt.init(xorKey, encryptionFlag !== 0);
            transition("WAIT_CHAR_LIST");
            // AuthRequest: C 0x2B + S username + D playOkId2 + D playOkId1
            //              + D loginOkId1 + D loginOkId2 (no trailing language field).
            const w = new PacketWriter();
            w.writeUInt8(GameClientOut.AuthRequest);
            w.writeStringNullUTF16(cfg.username);
            w.writeInt32LE(input.playOkId2);
            w.writeInt32LE(input.playOkId1);
            w.writeInt32LE(input.loginOkId1);
            w.writeInt32LE(input.loginOkId2);
            sendEncrypted(w.toBuffer());
            return;
          }
          case "WAIT_CHAR_LIST": {
            assertState(state, "WAIT_CHAR_LIST", "CharSelectInfo");
            if (opcode !== GameServerIn.CharSelectInfo) {
              throw new Error(
                `expected CharSelectInfo 0x09, got 0x${opcode.toString(16)}`,
              );
            }
            const charCount = r.readInt32LE();
            console.log(`charCount: ${charCount}`);
            check("charCount >= 1", charCount >= 1);
            transition("WAIT_CHAR_SELECTED");
            // CharacterSelected: C 0x12 + D slot + exactly 14 zero bytes.
            const w = new PacketWriter();
            w.writeUInt8(GameClientOut.CharacterSelected);
            w.writeInt32LE(cfg.charSlot);
            w.writeBytes(Buffer.alloc(14));
            sendEncrypted(w.toBuffer());
            return;
          }
          case "WAIT_CHAR_SELECTED": {
            if (opcode === GameServerIn.CharSelected) {
              transition("WAIT_USER_INFO");
              sendEnterWorld();
              return;
            }
            if (opcode === GameServerIn.UserInfo) {
              // Server skipped the CharSelected confirm: proceed as if confirmed.
              transition("WAIT_USER_INFO");
              sendEnterWorld();
              onUserInfo();
              return;
            }
            tolerateUnknown(opcode);
            return;
          }
          case "WAIT_USER_INFO": {
            if (opcode === GameServerIn.UserInfo) {
              onUserInfo();
              return;
            }
            if (isPingRequest(opcode, body)) {
              sendPong(readPingId(opcode, body));
              return;
            }
            tolerateUnknown(opcode);
            return;
          }
          case "IN_GAME": {
            if (isPingRequest(opcode, body)) {
              sendPong(readPingId(opcode, body));
            }
            // Silently drop all non-ping packets once IN_GAME.
            return;
          }
        }
      } catch (err) {
        fail(err);
      }
    };

    conn.connect(input.gameHost, input.gamePort);
  });
}
