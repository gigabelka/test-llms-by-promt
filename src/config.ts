import { config as loadEnv } from "dotenv";

// Load environment variables from .env in the project root.
loadEnv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseIntEnv(name: string): number {
  const value = requireEnv(name);
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid integer, got: ${value}`);
  }
  return parsed;
}

export interface Config {
  loginIp: string;
  loginPort: number;
  gamePort: number;
  username: string;
  password: string;
  serverId: number;
  charSlot: number;
  protocol: number;
  /** PHASE parsed as a number for logging only. NaN when PHASE is non-numeric (e.g. "full"). */
  phase: number;
}

export function loadConfig(): Config {
  return {
    loginIp: requireEnv("L2_LOGIN_IP"),
    loginPort: parseIntEnv("L2_LOGIN_PORT"),
    gamePort: parseIntEnv("L2_GAME_PORT"),
    username: requireEnv("L2_USERNAME"),
    password: requireEnv("L2_PASSWORD"),
    serverId: parseIntEnv("L2_SERVER_ID"),
    charSlot: parseIntEnv("L2_CHAR_SLOT"),
    protocol: parseIntEnv("L2_PROTOCOL"),
    phase: parseInt(process.env.PHASE ?? "1", 10),
  };
}
