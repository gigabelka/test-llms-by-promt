import * as dotenv from "dotenv";

// Load .env file
dotenv.config();

export interface Config {
  loginIp: string;
  loginPort: number;
  gamePort: number;
  username: string;
  password: string;
  serverId: number;
  charSlot: number;
  protocol: number;
  phase?: number; // parsed for logging only, not for routing
}

export function loadConfig(): Config {
  const loginIp = process.env.L2_LOGIN_IP;
  if (!loginIp) throw new Error("Missing required env var: L2_LOGIN_IP");

  const loginPortStr = process.env.L2_LOGIN_PORT;
  if (!loginPortStr) throw new Error("Missing required env var: L2_LOGIN_PORT");
  const loginPort = parseInt(loginPortStr, 10);
  if (isNaN(loginPort)) throw new Error(`Invalid L2_LOGIN_PORT: ${loginPortStr}`);

  const gamePortStr = process.env.L2_GAME_PORT;
  if (!gamePortStr) throw new Error("Missing required env var: L2_GAME_PORT");
  const gamePort = parseInt(gamePortStr, 10);
  if (isNaN(gamePort)) throw new Error(`Invalid L2_GAME_PORT: ${gamePortStr}`);

  const username = process.env.L2_USERNAME;
  if (!username) throw new Error("Missing required env var: L2_USERNAME");

  const password = process.env.L2_PASSWORD;
  if (!password) throw new Error("Missing required env var: L2_PASSWORD");

  const serverIdStr = process.env.L2_SERVER_ID;
  if (!serverIdStr) throw new Error("Missing required env var: L2_SERVER_ID");
  const serverId = parseInt(serverIdStr, 10);
  if (isNaN(serverId)) throw new Error(`Invalid L2_SERVER_ID: ${serverIdStr}`);

  const charSlotStr = process.env.L2_CHAR_SLOT;
  if (!charSlotStr) throw new Error("Missing required env var: L2_CHAR_SLOT");
  const charSlot = parseInt(charSlotStr, 10);
  if (isNaN(charSlot)) throw new Error(`Invalid L2_CHAR_SLOT: ${charSlotStr}`);

  const protocolStr = process.env.L2_PROTOCOL;
  if (!protocolStr) throw new Error("Missing required env var: L2_PROTOCOL");
  const protocol = parseInt(protocolStr, 10);
  if (isNaN(protocol)) throw new Error(`Invalid L2_PROTOCOL: ${protocolStr}`);

  // Parse PHASE into a numeric field for logging only; do not use cfg.phase for routing.
  let phaseNum: number | undefined;
  const phaseEnv = process.env.PHASE;
  if (phaseEnv !== undefined && phaseEnv !== "") {
    const parsed = parseInt(phaseEnv, 10);
    if (!isNaN(parsed)) {
      phaseNum = parsed;
    }
  }

  return {
    loginIp,
    loginPort,
    gamePort,
    username,
    password,
    serverId,
    charSlot,
    protocol,
    phase: phaseNum,
  };
}
