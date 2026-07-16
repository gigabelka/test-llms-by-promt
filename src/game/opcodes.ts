// HighFive (protocol 267) opcode map.
// Source of truth: PLANE.md

// ---------------------------------------------------------------------------
// Client extended packet prefix
// opcodes >= 0xD0 are written as [0xD0][2-byte sub-opcode LE][...]
// ---------------------------------------------------------------------------
export const ExtendedOpcode = 0xd0;

// ---------------------------------------------------------------------------
// Server extended packet prefix
// Server may send extended packets prefixed with 0xFE; read the 2-byte
// sub-opcode that follows.
// ---------------------------------------------------------------------------
export const ServerExtendedOpcode = 0xfe;

// ---------------------------------------------------------------------------
// Login server opcodes
// ---------------------------------------------------------------------------
export const LoginOpcodes = {
  /** Server → Client: initial handshake packet (0x00) */
  Init: 0x00,
  /** Client → Server: request GG auth (0x07) */
  RequestGGAuth: 0x07,
  /** Server → Client: GG auth response (0x0B) */
  GGAuth: 0x0b,
  /** Client → Server: send RSA-encrypted credentials (0x00) */
  RequestAuthLogin: 0x00,
  /** Server → Client: login accepted (0x03) */
  LoginOk: 0x03,
  /** Server → Client: login rejected (0x01) */
  LoginFail: 0x01,
  /** Client → Server: request server list (0x05) */
  RequestServerList: 0x05,
  /** Server → Client: server list (0x04) */
  ServerList: 0x04,
  /** Client → Server: request server login (0x02) */
  RequestServerLogin: 0x02,
  /** Server → Client: play accepted (0x07) */
  PlayOk: 0x07,
  /** Server → Client: play rejected (0x06) */
  PlayFail: 0x06,
} as const;

// ---------------------------------------------------------------------------
// Game server opcodes
// ---------------------------------------------------------------------------
export const GameOpcodes = {
  /** Client → Server: protocol version (0x0E) */
  ProtocolVersion: 0x0e,
  /** Server → Client: crypt init (0x2E) */
  CryptInit: 0x2e,
  /** Client → Server: auth request (0x2B) */
  AuthRequest: 0x2b,
  /** Server → Client: character selection info (0x09) */
  CharSelectInfo: 0x09,
  /** Client → Server: character selected (0x12) */
  CharacterSelected: 0x12,
  /** Server → Client: character selected confirmation (0x0B) */
  CharSelected: 0x0b,
  /** Client → Server: request key mapping (0xD0 0x0021) */
  RequestKeyMapping: 0x0021,
  /** Client → Server: enter world (0x11) */
  EnterWorld: 0x11,
  /** Server → Client: user info (0x32) */
  UserInfo: 0x32,
  /** Server → Client: ping request (0xD3 or 0xFE 0x00D3) */
  NetPingRequest: 0xd3,
  /** Client → Server: ping response (0xA8) */
  NetPing: 0xa8,
} as const;

// Convenience exports for individual opcodes commonly referenced elsewhere.
export const {
  Init,
  RequestGGAuth,
  GGAuth,
  RequestAuthLogin,
  LoginOk,
  LoginFail,
  RequestServerList,
  ServerList,
  RequestServerLogin,
  PlayOk,
  PlayFail,
} = LoginOpcodes;

export const {
  ProtocolVersion,
  CryptInit,
  AuthRequest,
  CharSelectInfo,
  CharacterSelected,
  CharSelected,
  RequestKeyMapping,
  EnterWorld,
  UserInfo,
  NetPingRequest,
  NetPing,
} = GameOpcodes;
