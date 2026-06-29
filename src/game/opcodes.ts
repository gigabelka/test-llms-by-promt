// HighFive (protocol 267) opcode map for the game server.

/** Login Server opcodes */
export const LOGIN_OPCODES = {
  // ← server
  INIT: 0x00,
  GG_AUTH: 0x0b,
  LOGIN_OK: 0x03,
  LOGIN_FAIL: 0x01,
  SERVER_LIST: 0x04,

  // → client
  REQUEST_GG_AUTH: 0x07,
  REQUEST_AUTH_LOGIN: 0x00,
  REQUEST_SERVER_LIST: 0x05,
  REQUEST_SERVER_LOGIN: 0x02,
  PLAY_OK: 0x07,
  PLAY_FAIL: 0x06,
} as const;

/** Game Server opcodes (HighFive) */
export const GAME_OPCODES = {
  // Steps
  PROTOCOL_VERSION: 0x0e,       // →
  CRYPT_INIT: 0x2e,             // ←
  AUTH_REQUEST: 0x2b,           // →
  CHAR_SELECT_INFO: 0x09,       // ←
  CHARACTER_SELECTED: 0x12,     // →
  CHAR_SELECTED_CONFIRM: 0x0b,  // ←
  REQUEST_KEY_MAPPING: 0x21,    // → (sent as 0xD0 0x0021)
  ENTER_WORLD: 0x11,            // →
  USER_INFO: 0x32,              // ←

  // Keepalive
  NET_PING_REQUEST: 0xd3,       // ← (or 0xFE 0x00d3 for extended)
  NET_PONG: 0xa8,               // →
} as const;

/** Extended opcodes */
export const ExtendedOpcode = 0xd0;        // Client extended opcode prefix
export const ServerExtendedOpcode = 0xfe;  // Server extended opcode prefix

// Map of game opcodes to their names for debugging/logging
export const GAME_OPCODE_NAMES: Record<number, string> = {
  [GAME_OPCODES.PROTOCOL_VERSION]: 'ProtocolVersion',
  [GAME_OPCODES.CRYPT_INIT]: 'CryptInit',
  [GAME_OPCODES.AUTH_REQUEST]: 'AuthRequest',
  [GAME_OPCODES.CHAR_SELECT_INFO]: 'CharSelectInfo',
  [GAME_OPCODES.CHARACTER_SELECTED]: 'CharacterSelected',
  [GAME_OPCODES.CHAR_SELECTED_CONFIRM]: 'CharSelectedConfirm',
  [GAME_OPCODES.ENTER_WORLD]: 'EnterWorld',
  [GAME_OPCODES.USER_INFO]: 'UserInfo',
  [GAME_OPCODES.NET_PING_REQUEST]: 'NetPingRequest',
  [GAME_OPCODES.NET_PONG]: 'NetPong',
};

// Map of extended opcodes to their names
export const EXTENDED_OPCODE_NAMES: Record<number, string> = {
  [GAME_OPCODES.REQUEST_KEY_MAPPING]: 'RequestKeyMapping',
};
