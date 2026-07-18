import dotenv from "dotenv";

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
}

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new Error(`config: missing required env var ${name}`);
  }
  return v.trim();
}

function requiredInt(name: string): number {
  const raw = required(name);
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new Error(`config: env var ${name} must be a number, got "${raw}"`);
  }
  return n;
}

// Loads and validates .env. Throws a clear error on any missing/invalid value.
export function loadConfig(): Config {
  return {
    loginIp: required("L2_LOGIN_IP"),
    loginPort: requiredInt("L2_LOGIN_PORT"),
    gamePort: requiredInt("L2_GAME_PORT"),
    username: required("L2_USERNAME"),
    password: required("L2_PASSWORD"),
    serverId: requiredInt("L2_SERVER_ID"),
    charSlot: requiredInt("L2_CHAR_SLOT"),
    protocol: requiredInt("L2_PROTOCOL"),
  };
}
