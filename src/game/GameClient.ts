import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";
import { GameCrypt } from "./GameCrypt";
import { logState, assertState, check } from "../debug/DebugTools";
import { GameServerIn, GameClientOut, ExtendedOpcode, ServerExtendedOpcode } from "./Opcodes";
import type { Config } from "../config";

export interface GameInput {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
}

export function runGame(cfg: Config, input: GameInput, statePath: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Connection();
    const gameCrypt = new GameCrypt();
    let state = "IDLE";
    let enterWorldSent = false;
    let unknownCount = 0;
    let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;

    function sendEnc(body: Buffer): void {
      if (gameCrypt.isEnabled()) {
        conn.send(gameCrypt.encrypt(body));
      } else {
        conn.send(body);
      }
    }

    function decryptBody(body: Buffer): Buffer {
      if (!gameCrypt.isEnabled()) return body;
      return gameCrypt.decrypt(body);
    }

    function finish(reason?: string): void {
      if (keepaliveTimer) {
        clearTimeout(keepaliveTimer);
        keepaliveTimer = null;
      }
      conn.close();
      if (reason) reject(new Error(reason));
      else resolve();
    }

    conn.onConnect = () => {
      state = "WAIT_CRYPT_INIT";
      statePath.push("WAIT_CRYPT_INIT");
      logState("IDLE", "WAIT_CRYPT_INIT");

      // Send ProtocolVersion raw
      const protoBody = new PacketWriter()
        .writeUInt8(GameClientOut.ProtocolVersion)  // 0x0E
        .writeInt32LE(cfg.protocol)
        .toBuffer();
      conn.send(protoBody); // always raw, no game encryption
    };

    conn.onClose = () => {
      if (state !== "IN_GAME") {
        reject(new Error(`Game connection closed in state ${state}`));
      }
    };

    conn.onPacket = (frame: Buffer) => {
      try {
        // Strip 2-byte size prefix
        let body = frame.subarray(2);

        // CryptInit arrives raw; all subsequent packets may be encrypted
        if (state !== "WAIT_CRYPT_INIT") {
          body = decryptBody(body);
        }

        if (body.length < 1) return;
        let opcode = body[0]!;
        let r = new PacketReader(body, 1); // skip opcode

        // --- Handle server extended opcode 0xFE ---
        if (opcode === ServerExtendedOpcode) {
          if (body.length < 3) return;
          const subOpcode = body.readUInt16LE(1);
          r = new PacketReader(body, 3); // skip 0xFE + H subOpcode
          // Normalize: 0xFE 0x00D3 → treat as NetPingRequest (0xD3)
          if (subOpcode === 0x00D3) {
            opcode = GameServerIn.NetPingRequest;
          } else {
            opcode = subOpcode;
          }
        }

        // --- WAIT_CRYPT_INIT: expect CryptInit 0x2E ---
        if (state === "WAIT_CRYPT_INIT") {
          assertState(state, "WAIT_CRYPT_INIT", "CryptInit handler");
          if (opcode !== GameServerIn.CryptInit) {
            reject(new Error(`Expected CryptInit(0x2E), got 0x${opcode.toString(16)}`));
            return;
          }
          const status = r.readUInt8();
          const xorKey = r.readBytes(8);
          const encryptionFlag = r.readInt32LE();
          gameCrypt.init(xorKey, encryptionFlag !== 0);

          state = "WAIT_CHAR_LIST";
          statePath.push("WAIT_CHAR_LIST");
          logState("WAIT_CRYPT_INIT", "WAIT_CHAR_LIST");

          // Send AuthRequest
          const authBody = new PacketWriter()
            .writeUInt8(GameClientOut.AuthRequest)  // 0x2B
            .writeStringNullUTF16(cfg.username)
            .writeInt32LE(input.playOkId2)
            .writeInt32LE(input.playOkId1)
            .writeInt32LE(input.loginOkId1)
            .writeInt32LE(input.loginOkId2)
            .toBuffer();
          sendEnc(authBody);
          return;
        }

        // --- WAIT_CHAR_LIST: expect CharSelectInfo 0x09 ---
        if (state === "WAIT_CHAR_LIST") {
          assertState(state, "WAIT_CHAR_LIST", "CharSelectInfo handler");
          if (opcode !== GameServerIn.CharSelectInfo) {
            reject(new Error(`Expected CharSelectInfo(0x09), got 0x${opcode.toString(16)}`));
            return;
          }
          const charCount = r.readInt32LE();
          check("charCount >= 1", charCount >= 1);

          state = "WAIT_CHAR_SELECTED";
          statePath.push("WAIT_CHAR_SELECTED");
          logState("WAIT_CHAR_LIST", "WAIT_CHAR_SELECTED");

          // Send CharacterSelected
          const selBody = new PacketWriter()
            .writeUInt8(GameClientOut.CharacterSelected)  // 0x12
            .writeInt32LE(cfg.charSlot)
            .writeBytes(Buffer.alloc(14, 0))  // exactly 14 zero bytes
            .toBuffer();
          sendEnc(selBody);
          return;
        }

        // --- WAIT_CHAR_SELECTED: expect CharSelected 0x0B, or UserInfo 0x32 (skip) ---
        if (state === "WAIT_CHAR_SELECTED") {
          // EDGE CASE: UserInfo arrives before CharSelected confirm — skip
          if (opcode === GameServerIn.UserInfo) {
            state = "WAIT_USER_INFO";
            statePath.push("WAIT_USER_INFO");
            logState("WAIT_CHAR_SELECTED", "WAIT_USER_INFO");
            sendEnterWorld();
            return;
          }

          if (opcode === GameServerIn.CharSelected) {
            state = "WAIT_USER_INFO";
            statePath.push("WAIT_USER_INFO");
            logState("WAIT_CHAR_SELECTED", "WAIT_USER_INFO");
            sendEnterWorld();
            return;
          }

          // NetPing can arrive in this state too
          if (opcode === GameServerIn.NetPingRequest) {
            handlePing(r);
            return;
          }

          // Tolerate unknown packets
          unknownCount++;
          if (unknownCount > 10) {
            reject(new Error(`Too many unknown packets in WAIT_CHAR_SELECTED`));
            return;
          }
          return;
        }

        // --- WAIT_USER_INFO: expect UserInfo 0x32, or pings ---
        if (state === "WAIT_USER_INFO") {
          if (opcode === GameServerIn.UserInfo) {
            console.log("IN_GAME");
            state = "IN_GAME";
            statePath.push("IN_GAME");
            logState("WAIT_USER_INFO", "IN_GAME");

            // Start 60s keepalive timer
            keepaliveTimer = setTimeout(() => {
              finish();
            }, 60000);
            return;
          }

          if (opcode === GameServerIn.NetPingRequest) {
            handlePing(r);
            return;
          }

          // Tolerate unknown packets
          unknownCount++;
          if (unknownCount > 10) {
            reject(new Error(`Too many unknown packets in WAIT_USER_INFO`));
            return;
          }
          return;
        }

        // --- IN_GAME: only handle pings ---
        if (state === "IN_GAME") {
          if (opcode === GameServerIn.NetPingRequest) {
            handlePing(r);
            return;
          }
          // Silently drop all other packets
          return;
        }
      } catch (err) {
        reject(err);
      }
    };

    function sendEnterWorld(): void {
      if (enterWorldSent) return;
      enterWorldSent = true;

      // RequestKeyMapping as extended packet: 0xD0 0x0021
      const keyMapBody = new PacketWriter()
        .writeUInt8(ExtendedOpcode)             // 0xD0
        .writeUInt16LE(GameClientOut.RequestKeyMapping)  // 0x0021
        .toBuffer();
      sendEnc(keyMapBody);

      // EnterWorld: 0x11 + 104 zero bytes
      const enterBody = new PacketWriter()
        .writeUInt8(GameClientOut.EnterWorld)  // 0x11
        .writeBytes(Buffer.alloc(104, 0))      // exactly 104 zero bytes
        .toBuffer();
      sendEnc(enterBody);
    }

    function handlePing(r: PacketReader): void {
      const pingId = r.readInt32LE();

      const pongBody = new PacketWriter()
        .writeUInt8(GameClientOut.NetPing)  // 0xA8
        .writeInt32LE(pingId)
        .writeInt32LE(0x00000000)
        .writeInt32LE(0x00080000)
        .toBuffer();
      sendEnc(pongBody);
    }

    conn.connect(input.gameHost, input.gamePort);
  });
}
