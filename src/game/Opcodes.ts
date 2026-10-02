// HighFive (protocol 267) opcode map. Values are bytes unless noted.
export const OPCODES = {
  login: {
    in: {
      Init: 0x00,
      GGAuth: 0x0b,
      LoginOk: 0x03,
      LoginFail: 0x01,
      ServerList: 0x04,
      PlayOk: 0x07,
      PlayFail: 0x06,
    },
    out: {
      RequestGGAuth: 0x07,
      RequestAuthLogin: 0x00,
      RequestServerList: 0x05,
      RequestServerLogin: 0x02,
    },
  },
  game: {
    in: {
      CryptInit: 0x2e,
      CharSelectInfo: 0x09,
      CharSelected: 0x0b,
      UserInfo: 0x32,
      NetPingRequest: 0xd3, // also arrives as 0xFE 0x00D3
    },
    out: {
      ProtocolVersion: 0x0e,
      AuthRequest: 0x2b,
      CharacterSelected: 0x12,
      RequestKeyMapping: 0x0021, // uint16LE sub-opcode: sent as 0xD0 + writeUInt16LE(0x0021)
      EnterWorld: 0x11,
      NetPing: 0xa8,
    },
  },
} as const;

export const ExtendedOpcode = 0xd0; // client extended-packet prefix
export const ServerExtendedOpcode = 0xfe; // server extended-packet prefix
