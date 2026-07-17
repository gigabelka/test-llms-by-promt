import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "..", ".env") });

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
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
  loginIp: req("L2_LOGIN_IP"),
  loginPort: parseInt(req("L2_LOGIN_PORT"), 10),
  gamePort: parseInt(req("L2_GAME_PORT"), 10),
  username: req("L2_USERNAME"),
  password: req("L2_PASSWORD"),
  serverId: parseInt(req("L2_SERVER_ID"), 10),
  charSlot: parseInt(req("L2_CHAR_SLOT"), 10),
  protocol: parseInt(req("L2_PROTOCOL"), 10),
};
