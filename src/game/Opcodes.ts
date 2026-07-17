// Login Server opcodes
export const LoginServerIn = {
  Init: 0x00,
  GGAuth: 0x0B,
  LoginOk: 0x03,
  LoginFail: 0x01,
  ServerList: 0x04,
  PlayOk: 0x07,
  PlayFail: 0x06,
} as const;

export const LoginClientOut = {
  RequestGGAuth: 0x07,
  RequestAuthLogin: 0x00,
  RequestServerList: 0x05,
  RequestServerLogin: 0x02,
} as const;

// Game Server opcodes
export const GameServerIn = {
  CryptInit: 0x2E,
  CharSelectInfo: 0x09,
  CharSelected: 0x0B,
  UserInfo: 0x32,
  NetPingRequest: 0xD3,
} as const;

export const GameClientOut = {
  ProtocolVersion: 0x0E,
  AuthRequest: 0x2B,
  CharacterSelected: 0x12,
  RequestKeyMapping: 0x21,    // sent as extended: 0xD0 0x0021
  EnterWorld: 0x11,
  NetPing: 0xA8,
} as const;

export const ExtendedOpcode = 0xD0;
export const ServerExtendedOpcode = 0xFE;
