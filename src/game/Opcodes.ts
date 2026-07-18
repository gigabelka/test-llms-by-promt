// HighFive (protocol 267) opcode map — from PLANE.md "OPCODE MAP (CRITICAL — HighFive)".
// Never use the "textbook" L2 opcodes; this server uses its own set.

// Client extended packets: [0xD0][2-byte sub-opcode LE][...].
export const ExtendedOpcode = 0xd0;
// Server extended packets are prefixed 0xFE followed by a 2-byte LE sub-opcode.
export const ServerExtendedOpcode = 0xfe;
// Server-extended form of NetPingRequest: 0xFE 0x00D3.
export const NetPingRequestExtSubOpcode = 0x00d3;

// Login server -> client
export enum LoginServerIn {
  Init = 0x00,
  LoginFail = 0x01,
  LoginOk = 0x03,
  ServerList = 0x04,
  PlayFail = 0x06,
  PlayOk = 0x07,
  GGAuth = 0x0b,
}

// Client -> login server
export enum LoginClientOut {
  RequestAuthLogin = 0x00,
  RequestServerLogin = 0x02,
  RequestServerList = 0x05,
  RequestGGAuth = 0x07,
}

// Game server -> client
export enum GameServerIn {
  CharSelectInfo = 0x09,
  CharSelected = 0x0b, // confirm
  CryptInit = 0x2e,
  UserInfo = 0x32,
  NetPingRequest = 0xd3, // or 0xFE 0x00D3
}

// Client -> game server
export enum GameClientOut {
  ProtocolVersion = 0x0e,
  EnterWorld = 0x11,
  CharacterSelected = 0x12,
  RequestKeyMapping = 0x21, // sub-opcode, sent as 0xD0 0x0021
  AuthRequest = 0x2b,
  NetPing = 0xa8, // pong
}
