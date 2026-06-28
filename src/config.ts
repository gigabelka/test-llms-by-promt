import dotenv from "dotenv";
import path from "node:path";

// Load .env from the project root (one level above src/).
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
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
  /** Parsed from PHASE env var — for logging only. Do NOT use for routing. */
  phase: number;
}

const rawPhase = process.env.PHASE ?? "full";
const phaseNum = parseInt(rawPhase, 10); // NaN for "full"

export const config: Config = {
  loginIp: requireEnv("L2_LOGIN_IP"),
  loginPort: parseInt(requireEnv("L2_LOGIN_PORT"), 10),
  gamePort: parseInt(requireEnv("L2_GAME_PORT"), 10),
  username: requireEnv("L2_USERNAME"),
  password: requireEnv("L2_PASSWORD"),
  serverId: parseInt(requireEnv("L2_SERVER_ID"), 10),
  charSlot: parseInt(requireEnv("L2_CHAR_SLOT"), 10),
  protocol: parseInt(requireEnv("L2_PROTOCOL"), 10),
  phase: isNaN(phaseNum) ? 0 : phaseNum,
};
