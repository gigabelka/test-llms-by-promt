// HighFive (protocol 267) opcode map — the WHOLE map from PLANE.md `## OPCODE MAP (CRITICAL — HighFive)`.
// Never use "textbook" L2 opcodes; this server uses its own set (confirmed by captures).

export const LoginServerIn = {
  Init: 0x00,
  LoginFail: 0x01,
  LoginOk: 0x03,
  ServerList: 0x04,
  PlayFail: 0x06,
  PlayOk: 0x07,
  GGAuth: 0x0b,
} as const;

export const LoginClientOut = {
  RequestAuthLogin: 0x00,
  RequestServerLogin: 0x02,
  RequestServerList: 0x05,
  RequestGGAuth: 0x07,
} as const;

export const Game = {
  CharSelectInfo: 0x09,
  CharSelected: 0x0b,
  EnterWorld: 0x11,
  CharacterSelected: 0x12,
  ProtocolVersion: 0x0e,
  RequestKeyMapping: 0x21,
  AuthRequest: 0x2b,
  CryptInit: 0x2e,
  UserInfo: 0x32,
  NetPing: 0xa8,
  NetPingRequest: 0xd3,
} as const;

// Client extended packets are sent as [0xD0][2-byte sub-opcode LE][...].
export const ExtendedOpcode = 0xd0;

// Server extended packets are prefixed with 0xFE; e.g. 0xFE 0x00D3 is a NetPingRequest.
export const ServerExtendedOpcode = 0xfe;
