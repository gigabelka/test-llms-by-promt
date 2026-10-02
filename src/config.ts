// Loads and validates .env. Numbers become numbers; any missing required var throws.
// L2_GAME_IP is the only optional variable — absent or empty means "not set".
import { config as loadEnv } from "dotenv";
import type { Config } from "./types.ts";

function requireVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function requireNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Env var ${name} is not a valid integer: ${raw}`);
  }
  return n;
}

export function loadConfig(): Config {
  loadEnv();

  return {
    loginIp: requireVar("L2_LOGIN_IP"),
    loginPort: requireNumber("L2_LOGIN_PORT", 2106),
    gamePort: requireNumber("L2_GAME_PORT", 7777),
    gameIp: process.env["L2_GAME_IP"] === "" ? undefined : process.env["L2_GAME_IP"],
    username: requireVar("L2_USERNAME"),
    password: requireVar("L2_PASSWORD"),
    serverId: requireNumber("L2_SERVER_ID", 2),
    charSlot: requireNumber("L2_CHAR_SLOT", 0),
    protocol: requireNumber("L2_PROTOCOL", 267),
  };
}
