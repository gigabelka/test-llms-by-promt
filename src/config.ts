import { config as loadDotenv } from "dotenv";

loadDotenv();

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

// Load + validate .env. Never overwrites .env — dotenv only reads.
function requireInt(name: string, raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`config: missing required value ${name}`);
  }
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v) || String(v) !== raw.trim()) {
    throw new Error(`config: ${name} is not a valid integer: "${raw}"`);
  }
  return v;
}

function requireStr(name: string, raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`config: missing required value ${name}`);
  }
  return raw;
}

export function loadConfig(): Config {
  const cfg: Config = {
    loginIp: requireStr("L2_LOGIN_IP", process.env.L2_LOGIN_IP),
    loginPort: requireInt("L2_LOGIN_PORT", process.env.L2_LOGIN_PORT),
    gamePort: requireInt("L2_GAME_PORT", process.env.L2_GAME_PORT),
    username: requireStr("L2_USERNAME", process.env.L2_USERNAME),
    password: requireStr("L2_PASSWORD", process.env.L2_PASSWORD),
    serverId: requireInt("L2_SERVER_ID", process.env.L2_SERVER_ID),
    charSlot: requireInt("L2_CHAR_SLOT", process.env.L2_CHAR_SLOT),
    protocol: requireInt("L2_PROTOCOL", process.env.L2_PROTOCOL),
  };
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(cfg.loginIp)) {
    throw new Error(`config: L2_LOGIN_IP is not a valid IPv4 address: "${cfg.loginIp}"`);
  }
  return cfg;
}
