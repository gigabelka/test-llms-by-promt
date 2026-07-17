import dotenv from "dotenv";

dotenv.config();

function getRequired(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseIntRequired(name: string): number {
  const raw = getRequired(name);
  const value = parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a valid integer, got "${raw}"`);
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
}

export const config: Config = {
  loginIp: getRequired("L2_LOGIN_IP"),
  loginPort: parseIntRequired("L2_LOGIN_PORT"),
  gamePort: parseIntRequired("L2_GAME_PORT"),
  username: getRequired("L2_USERNAME"),
  password: getRequired("L2_PASSWORD"),
  serverId: parseIntRequired("L2_SERVER_ID"),
  charSlot: parseIntRequired("L2_CHAR_SLOT"),
  protocol: parseIntRequired("L2_PROTOCOL"),
};

if (config.protocol !== 267) {
  throw new Error(`Unsupported protocol ${config.protocol}; this client targets HighFive protocol 267`);
}

if (config.username.length === 0 || config.username.length > 14) {
  throw new Error("L2_USERNAME must be 1-14 characters");
}

if (config.password.length === 0 || config.password.length > 16) {
  throw new Error("L2_PASSWORD must be 1-16 characters");
}
