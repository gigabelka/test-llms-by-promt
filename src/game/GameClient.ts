import {
  assertState,
  check,
  logState,
} from "../debug/DebugTools";
import { GameCrypt } from "./GameCrypt";
import {
  ExtendedOpcode,
  GameClientOut,
  GameServerIn,
  ServerExtendedOpcode,
} from "./Opcodes";
import { Connection } from "../net/Connection";
import { PacketReader } from "../net/PacketReader";
import { PacketWriter } from "../net/PacketWriter";

export interface GameInput {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
}

export interface GameConfig {
  username: string;
  charSlot: number;
  protocol: number;
}

export function runGame(
  cfg: GameConfig,
  input: GameInput,
  statePath: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    let state = "WAIT_CRYPT_INIT";
    const push = (to: string) => {
      logState(state, to);
      statePath.push(to);
      state = to;
    };

    const gameCrypt = new GameCrypt();
    const conn = new Connection();

    let resolved = false;
    let enterWorldSent = false;
    let unknownCharSelected = 0;
    let unknownUserInfo = 0;
    let keepaliveTimer: NodeJS.Timeout | null = null;

    const finish = (err?: Error) => {
      if (resolved) return;
      resolved = true;
      if (keepaliveTimer) {
        clearTimeout(keepaliveTimer);
        keepaliveTimer = null;
      }
      conn.close();
      if (err) reject(err);
      else resolve();
    };

    const sendEnterWorld = () => {
      if (enterWorldSent) return;
      enterWorldSent = true;

      const keyMapping = new PacketWriter()
        .writeUInt8(ExtendedOpcode)
        .writeUInt16LE(GameClientOut.RequestKeyMapping)
        .toBuffer();
      conn.send(gameCrypt.encrypt(keyMapping));

      const enterWorld = new PacketWriter()
        .writeUInt8(GameClientOut.EnterWorld)
        .writeBytes(Buffer.alloc(104))
        .toBuffer();
      conn.send(gameCrypt.encrypt(enterWorld));
    };

    const handleUserInfo = () => {
      console.log("IN_GAME");
      push("IN_GAME");
      keepaliveTimer = setTimeout(() => finish(), 60000);
    };

    const parsePing = (opcode: number, body: Buffer): number | null => {
      if (opcode === GameServerIn.NetPingRequest) {
        const r = new PacketReader(body, 1);
        return r.readInt32LE();
      }
      if (
        opcode === ServerExtendedOpcode &&
        body.length >= 3 &&
        body.readUInt16LE(1) === GameServerIn.NetPingRequest
      ) {
        const r = new PacketReader(body, 3);
        return r.readInt32LE();
      }
      return null;
    };

    const replyPing = (pingId: number) => {
      const pong = new PacketWriter()
        .writeUInt8(GameClientOut.NetPing)
        .writeInt32LE(pingId)
        .writeInt32LE(0)
        .writeInt32LE(0x00080000)
        .toBuffer();
      conn.send(gameCrypt.encrypt(pong));
    };

    conn.onConnect = () => {
      const protocol = new PacketWriter()
        .writeUInt8(GameClientOut.ProtocolVersion)
        .writeInt32LE(cfg.protocol)
        .toBuffer();
      // ProtocolVersion is always sent raw, before CryptInit.
      conn.send(protocol);
    };

    conn.onClose = () => {
      if (!resolved) {
        if (state === "IN_GAME" && keepaliveTimer) {
          finish(new Error("Game server closed socket during keepalive"));
        } else {
          finish(new Error(`Game server closed socket in ${state}`));
        }
      }
    };

    conn.onPacket = (frame) => {
      try {
        let body = frame.subarray(2);

        // The first server packet (CryptInit) is unencrypted.
        if (state !== "WAIT_CRYPT_INIT") {
          body = gameCrypt.decrypt(body);
        }

        const opcode = body[0]!;

        // Ping handling is active from WAIT_USER_INFO onwards.
        if (state === "WAIT_USER_INFO" || state === "IN_GAME") {
          const pingId = parsePing(opcode, body);
          if (pingId !== null) {
            replyPing(pingId);
            return;
          }
        }

        if (state === "WAIT_CRYPT_INIT") {
          assertState(state, "WAIT_CRYPT_INIT");
          if (opcode !== GameServerIn.CryptInit) {
            throw new Error(
              `Expected CryptInit (0x${GameServerIn.CryptInit.toString(16)}), got 0x${opcode.toString(16)}`,
            );
          }

          const r = new PacketReader(body, 1);
          const status = r.readUInt8();
          const xorKey = r.readBytes(8);
          const encryptionFlag = r.readInt32LE();
          if (status !== 0) {
            console.warn(`CryptInit returned non-zero status: ${status}`);
          }
          gameCrypt.init(xorKey, encryptionFlag !== 0);

          push("WAIT_CHAR_LIST");

          const auth = new PacketWriter()
            .writeUInt8(GameClientOut.AuthRequest)
            .writeStringNullUTF16(cfg.username)
            .writeInt32LE(input.playOkId2)
            .writeInt32LE(input.playOkId1)
            .writeInt32LE(input.loginOkId1)
            .writeInt32LE(input.loginOkId2)
            .toBuffer();
          conn.send(gameCrypt.encrypt(auth));
        } else if (state === "WAIT_CHAR_LIST") {
          if (opcode !== GameServerIn.CharSelectInfo) {
            throw new Error(
              `Expected CharSelectInfo (0x${GameServerIn.CharSelectInfo.toString(16)}), got 0x${opcode.toString(16)}`,
            );
          }

          const r = new PacketReader(body, 1);
          const charCount = r.readInt32LE();
          console.log(`CharSelectInfo count=${charCount}`);
          check("charCount >= 1", charCount >= 1);

          push("WAIT_CHAR_SELECTED");

          const cs = new PacketWriter()
            .writeUInt8(GameClientOut.CharacterSelected)
            .writeInt32LE(cfg.charSlot)
            .writeBytes(Buffer.alloc(14))
            .toBuffer();
          conn.send(gameCrypt.encrypt(cs));
        } else if (state === "WAIT_CHAR_SELECTED") {
          if (opcode === GameServerIn.CharSelected) {
            push("WAIT_USER_INFO");
            sendEnterWorld();
          } else if (opcode === GameServerIn.UserInfo) {
            push("WAIT_USER_INFO");
            sendEnterWorld();
            handleUserInfo();
          } else {
            unknownCharSelected++;
            if (unknownCharSelected > 10) {
              throw new Error("Too many unknown packets in WAIT_CHAR_SELECTED");
            }
          }
        } else if (state === "WAIT_USER_INFO") {
          if (opcode === GameServerIn.UserInfo) {
            handleUserInfo();
          } else {
            unknownUserInfo++;
            if (unknownUserInfo > 10) {
              throw new Error("Too many unknown packets in WAIT_USER_INFO");
            }
          }
        } else if (state === "IN_GAME") {
          // Silently drop all non-ping packets (pings handled above).
        }
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    };

    conn.connect(input.gameHost, input.gamePort);
  });
}
