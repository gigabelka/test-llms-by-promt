import dotenv from 'dotenv';

// Load environment variables from the repository's .env file.
// The file already exists and contains real credentials; this module only reads it.
dotenv.config();

export interface Config {
  /** Login server IP */
  loginIp: string;
  /** Login server port */
  loginPort: number;
  /** Game server port (host is taken from the login server list) */
  gamePort: number;
  /** Account login */
  username: string;
  /** Account password */
  password: string;
  /** Server id to pick from the login server list */
  serverId: number;
  /** Character slot index (0-based) */
  charSlot: number;
  /** Protocol version (HighFive = 267) */
  protocol: number;
  /**
   * Parsed PHASE value for logging only.
   * Will be NaN for non-numeric values such as "full".
   * Do NOT use this field for routing.
   */
  phase: number;
}

function requireString(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireInt(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a valid integer, got: ${raw}`);
  }
  return value;
}

function parsePhase(): number {
  const raw = process.env.PHASE;
  if (raw === undefined || raw === '') {
    return 1;
  }
  const value = parseInt(raw, 10);
  return Number.isFinite(value) ? value : NaN;
}

export const cfg: Config = {
  loginIp: requireString('L2_LOGIN_IP'),
  loginPort: requireInt('L2_LOGIN_PORT'),
  gamePort: requireInt('L2_GAME_PORT'),
  username: requireString('L2_USERNAME'),
  password: requireString('L2_PASSWORD'),
  serverId: requireInt('L2_SERVER_ID'),
  charSlot: requireInt('L2_CHAR_SLOT'),
  protocol: requireInt('L2_PROTOCOL'),
  phase: parsePhase(),
};
