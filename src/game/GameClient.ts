import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { GameCrypt } from "./GameCrypt";
import { Game, ExtendedOpcode, ServerExtendedOpcode } from "./Opcodes";
import { assertState, check, logState } from "../debug/DebugTools";
import type { Config } from "../config";
import type { LoginResult } from "../login/LoginClient";

type GameState =
  | "WAIT_CRYPT_INIT"
  | "WAIT_CHAR_LIST"
  | "WAIT_CHAR_SELECTED"
  | "WAIT_USER_INFO"
  | "IN_GAME"
  | "DONE";

const KEEPALIVE_MS = 60_000; // stay connected and answer pings for 60 seconds
const MAX_UNKNOWN_PACKETS = 10; // tolerance in WAIT_CHAR_SELECTED / WAIT_USER_INFO

export function runGame(
  cfg: Config,
  input: LoginResult,
  statePath: string[],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let state: GameState = "WAIT_CRYPT_INIT";
    let settled = false;
    let cleanClose = false;
    let unknownCount = 0;
    let enterWorldSent = false; // enter-world sequence must run at most once

    const gameCrypt = new GameCrypt();
    const conn = new Connection();

    function fail(err: Error): void {
      if (settled) return;
      settled = true;
      cleanClose = true;
      conn.close();
      reject(err);
    }

    function transition(to: GameState): void {
      logState(state, to);
      statePath.push(to);
      state = to;
    }

    // Every body is encrypted per the CryptInit flag (GameCrypt passes through
    // when disabled). Connection.send() alone prepends the 2-byte LE length.
    function send(body: Buffer): void {
      conn.send(gameCrypt.encrypt(body));
    }

    // ProtocolVersion is always sent RAW, before CryptInit.
    function sendProtocolVersion(): void {
      const body = Buffer.alloc(5);
      body.writeUInt8(Game.ProtocolVersion, 0);
      body.writeInt32LE(cfg.protocol, 1);
      conn.send(body);
    }

    // AuthRequest 0x2B: key order is playOkId2, playOkId1, loginOkId1, loginOkId2.
    // HighFive has NO trailing language field.
    function sendAuthRequest(): void {
      const name = Buffer.from(cfg.username, "utf16le");
      const body = Buffer.alloc(
        1 + name.length + 2 + 4 + 4 + 4 + 4,
      );
      let o = 0;
      body.writeUInt8(Game.AuthRequest, o);
      o += 1;
      name.copy(body, o);
      o += name.length;
      body.writeUInt8(0, o);
      body.writeUInt8(0, o + 1);
      o += 2;
      body.writeInt32LE(input.playOkId2, o);
      o += 4;
      body.writeInt32LE(input.playOkId1, o);
      o += 4;
      body.writeInt32LE(input.loginOkId1, o);
      o += 4;
      body.writeInt32LE(input.loginOkId2, o);
      send(body);
    }

    function sendCharacterSelected(): void {
      // C 0x12 + D charSlot + exactly 14 zero bytes.
      const body = Buffer.alloc(1 + 4 + 14);
      body.writeUInt8(Game.CharacterSelected, 0);
      body.writeInt32LE(cfg.charSlot, 1);
      send(body);
    }

    // Enter world = RequestKeyMapping (0xD0 0x0021) FIRST, then
    // EnterWorld 0x11 + exactly 104 zero bytes. Guarded to run at most once.
    function enterWorld(): void {
      if (enterWorldSent) return;
      enterWorldSent = true;
      const keyMapping = Buffer.from([
        ExtendedOpcode,
        Game.RequestKeyMapping & 0xff,
        (Game.RequestKeyMapping >>> 8) & 0xff,
      ]);
      send(keyMapping);
      const enter = Buffer.alloc(1 + 104);
      enter.writeUInt8(Game.EnterWorld, 0);
      send(enter);
    }

    // 13-byte NetPing pong: 0xA8 + D pingId + D 0 + D 0x00080000.
    function sendPong(pingId: number): void {
      const body = Buffer.alloc(13);
      body.writeUInt8(Game.NetPing, 0);
      body.writeInt32LE(pingId, 1);
      body.writeInt32LE(0, 5);
      body.writeInt32LE(0x00080000, 9);
      send(body);
    }

    function handleCryptInit(body: Buffer): void {
      // This body is unencrypted; every subsequent body goes through GameCrypt.
      const r = new PacketReader(body);
      r.skip(1); // opcode
      r.skip(1); // status
      const xorKey = r.readBytes(8);
      const encryptionFlag = r.readInt32LE();
      gameCrypt.init(xorKey, encryptionFlag !== 0);
      console.log(
        `[GAME] CryptInit: encryption ${encryptionFlag !== 0 ? "ON" : "OFF"}`,
      );
      transition("WAIT_CHAR_LIST");
      sendAuthRequest();
    }

    function handleCharSelectInfo(body: Buffer): void {
      const r = new PacketReader(body);
      r.skip(1); // opcode
      const charCount = r.readInt32LE();
      if (!check("charCount >= 1", charCount >= 1)) {
        fail(new Error(`CharSelectInfo: charCount = ${charCount}`));
        return;
      }
      console.log(`[GAME] character list: ${charCount} character(s)`);
      transition("WAIT_CHAR_SELECTED");
      sendCharacterSelected();
    }

    function handleUserInfo(): void {
      console.log("IN_GAME");
      transition("IN_GAME");
      // Keep the connection alive answering pings for 60 seconds, then close.
      setTimeout(() => {
        console.log("[GAME] keepalive finished, closing connection");
        cleanClose = true;
        conn.close();
        if (!settled) {
          settled = true;
          resolve();
        }
      }, KEEPALIVE_MS).unref?.();
    }

    function handlePing(pingId: number): void {
      sendPong(pingId);
    }

    function isPing(body: Buffer): number | null {
      // 0xD3 form: C 0xD3 + D pingId.
      if (body[0] === Game.NetPingRequest && body.length >= 5) {
        return body.readInt32LE(1);
      }
      // Server-extended form: C 0xFE + H 0x00D3 + D pingId.
      if (
        body[0] === ServerExtendedOpcode &&
        body.length >= 7 &&
        body.readUInt16LE(1) === 0x00d3
      ) {
        return body.readInt32LE(3);
      }
      return null;
    }

    conn.onConnect = () => {
      console.log(
        `[GAME] connected to ${input.gameHost}:${input.gamePort}`,
      );
      sendProtocolVersion();
    };

    conn.onPacket = (frame: Buffer) => {
      if (settled) return;
      const raw = frame.subarray(2); // strip [uint16LE size]
      if (raw.length === 0) return;

      if (state === "WAIT_CRYPT_INIT") {
        // CryptInit body itself is unencrypted — do not run it through GameCrypt.
        if (raw[0] !== Game.CryptInit) {
          fail(
            new Error(
              `WAIT_CRYPT_INIT: expected CryptInit 0x2E, got 0x${raw[0]
                .toString(16)
                .padStart(2, "0")}`,
            ),
          );
          return;
        }
        assertState(state, "WAIT_CRYPT_INIT", "CryptInit");
        handleCryptInit(Buffer.from(raw));
        return;
      }

      const body = gameCrypt.decrypt(Buffer.from(raw));
      if (body.length === 0) return;

      const pingId = isPing(body);
      if (pingId !== null) {
        if (state === "WAIT_USER_INFO" || state === "IN_GAME") {
          handlePing(pingId);
          return;
        }
      }

      const op = body[0];
      switch (state) {
        case "WAIT_CHAR_LIST": {
          if (op === Game.CharSelectInfo) {
            assertState(state, "WAIT_CHAR_LIST", "CharSelectInfo");
            handleCharSelectInfo(body);
          } else {
            fail(
              new Error(
                `WAIT_CHAR_LIST: unexpected opcode 0x${op.toString(16).padStart(2, "0")}`,
              ),
            );
          }
          return;
        }
        case "WAIT_CHAR_SELECTED": {
          if (op === Game.CharSelected) {
            assertState(state, "WAIT_CHAR_SELECTED", "CharSelected confirm");
            transition("WAIT_USER_INFO");
            enterWorld();
          } else if (op === Game.UserInfo) {
            // Some servers skip the CharSelected confirm and jump straight to
            // UserInfo: treat this packet as the confirm — transition to
            // WAIT_USER_INFO, send RequestKeyMapping + EnterWorld, and wait
            // for the REAL UserInfo that follows EnterWorld (do NOT declare
            // IN_GAME here — the real one arrives after the enter-world step).
            console.log("[GAME] CharSelected confirm skipped, proceeding");
            assertState(state, "WAIT_CHAR_SELECTED", "skipped confirm -> UserInfo");
            transition("WAIT_USER_INFO");
            enterWorld();
          } else {
            unknownCount++;
            console.log(
              `[GAME] unknown packet in WAIT_CHAR_SELECTED (0x${op
                .toString(16)
                .padStart(2, "0")}, tolerated ${unknownCount}/${MAX_UNKNOWN_PACKETS})`,
            );
            if (unknownCount > MAX_UNKNOWN_PACKETS) {
              fail(new Error("too many unknown packets in WAIT_CHAR_SELECTED"));
            }
          }
          return;
        }
        case "WAIT_USER_INFO": {
          if (op === Game.UserInfo) {
            assertState(state, "WAIT_USER_INFO", "UserInfo");
            handleUserInfo();
          } else {
            unknownCount++;
            console.log(
              `[GAME] unknown packet in WAIT_USER_INFO (0x${op
                .toString(16)
                .padStart(2, "0")}, tolerated ${unknownCount}/${MAX_UNKNOWN_PACKETS})`,
            );
            if (unknownCount > MAX_UNKNOWN_PACKETS) {
              fail(new Error("too many unknown packets in WAIT_USER_INFO"));
            }
          }
          return;
        }
        case "IN_GAME": {
          // In-world: silently drop all non-ping packets.
          return;
        }
        default:
          fail(new Error(`unexpected packet in state ${state}`));
      }
    };

    // A server close before UserInfo must settle the promise — never leave it pending.
    conn.onClose = () => {
      if (settled) return;
      if (cleanClose) {
        cleanClose = true;
        settled = true;
        resolve();
        return;
      }
      fail(new Error("Game server closed the connection before UserInfo"));
    };

    conn.connect(input.gameHost, input.gamePort);
  });
}
