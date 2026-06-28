// HighFive (protocol 267) opcode map.
// Use these exact values — never the "textbook" L2 opcodes.

// ---- Login Server opcodes ----

export const LoginServer = {
  Init: 0x00,             // ← server
  RequestGGAuth: 0x07,    // → client
  GGAuth: 0x0b,           // ← server
  RequestAuthLogin: 0x00, // → client
  LoginOk: 0x03,          // ← server
  LoginFail: 0x01,        // ← server
  RequestServerList: 0x05,// → client
  ServerList: 0x04,       // ← server
  RequestServerLogin: 0x02,// → client
  PlayOk: 0x07,           // ← server
  PlayFail: 0x06,         // ← server
} as const;

// ---- Game Server opcodes (HighFive) ----

export const GameServer = {
  ProtocolVersion: 0x0e,    // → client  (step 1)
  CryptInit: 0x2e,          // ← server  (step 2)
  AuthRequest: 0x2b,        // → client  (step 3)
  CharSelectInfo: 0x09,     // ← server  (step 4)
  CharacterSelected: 0x12,  // → client  (step 5)
  CharSelectedConfirm: 0x0b,// ← server  (step 6)
  RequestKeyMapping: 0x21,  // → client  (step 7, sent as extended 0xD0 0x0021)
  EnterWorld: 0x11,         // → client  (step 8)
  UserInfo: 0x32,           // ← server  (step 9)
  NetPingRequest: 0xd3,     // ← server  (keepalive — also 0xFE 0x00D3)
  NetPing: 0xa8,            // → client  (pong)
} as const;

// Extended opcode markers.
export const ExtendedOpcode = 0xd0;        // client prefixes extended packets with this
export const ServerExtendedOpcode = 0xfe;  // server prefixes extended packets with this
