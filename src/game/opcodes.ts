/**
 * HighFive (protocol 267) opcode map.
 *
 * Login Server opcodes are used by the login client.
 * Game Server opcodes are used by the game client.
 */

export const LoginOpcodes = {
  // Server -> Client
  Init: 0x00,
  GGAuth: 0x0b,
  LoginOk: 0x03,
  LoginFail: 0x01,
  ServerList: 0x04,
  PlayOk: 0x07,
  PlayFail: 0x06,

  // Client -> Server
  RequestGGAuth: 0x07,
  RequestAuthLogin: 0x00,
  RequestServerList: 0x05,
  RequestServerLogin: 0x02,
} as const;

export const GameOpcodes = {
  // Client -> Server
  ProtocolVersion: 0x0e,
  AuthRequest: 0x2b,
  CharacterSelected: 0x12,
  EnterWorld: 0x11,
  NetPing: 0xa8,

  // Server -> Client
  CryptInit: 0x2e,
  CharSelectInfo: 0x09,
  CharSelected: 0x0b,
  UserInfo: 0x32,
  NetPingRequest: 0xd3,
} as const;

export const ExtendedOpcode = 0xd0;
export const ServerExtendedOpcode = 0xfe;

export const ExtendedClientOpcodes = {
  RequestKeyMapping: 0x0021,
} as const;
