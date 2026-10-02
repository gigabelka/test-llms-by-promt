// The single source of shared types. config.ts, net/, login/, game/, debug/ and index.ts
// all import from here, always as `import type { … } from "../types.ts"` — verbatimModuleSyntax
// is on, so a value import of a type is a hard TS1484 error.
// login/ and game/ must NOT import from each other — anything they both need lives in this file
// and is threaded through index.ts. The ONE exception: login/LoginClient.ts imports OPCODES from
// game/Opcodes.ts, because that file holds the whole opcode map, the login opcodes included.

export interface Config {
  loginIp: string;
  loginPort: number;
  gamePort: number;
  // Optional L2_GAME_IP override. Empty/absent (the normal case) = use the ServerList ip.
  gameIp?: string;
  username: string;
  password: string;
  serverId: number;
  charSlot: number;
  protocol: number;
}

// Resolved by the login stage, carried in memory into the game stage. gameHost/gamePort come
// from the picked ServerList record; L2_GAME_PORT is only the fallback for an unusable port.
// `ggSkipped` is fed into the required `ggSkipped` report artifact by the game stage.
export interface LoginResult {
  loginOkId1: number;
  loginOkId2: number;
  playOkId1: number;
  playOkId2: number;
  gameHost: string;
  gamePort: number;
  ggSkipped: boolean;
}

// What runGame() needs: the login result plus the account name for AuthRequest.
export type GameInput = LoginResult & { username: string };

// key=value session data printed in the final report.
export type Artifacts = Record<string, string | number>;

export type LoginState =
  | "WAIT_INIT"
  | "WAIT_GG_AUTH"
  | "WAIT_LOGIN_OK"
  | "WAIT_SERVER_LIST"
  | "WAIT_PLAY_OK";

export type GameState =
  | "WAIT_CRYPT_INIT"
  | "WAIT_CHAR_LIST"
  | "WAIT_CHAR_SELECTED"
  | "WAIT_USER_INFO"
  | "IN_GAME";

export type AnyState = "IDLE" | LoginState | GameState;
