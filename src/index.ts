import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import {
  check,
  report,
  runLoginCryptoSelfTests,
  runGameCryptoSelfTests,
  selfTestCounts,
} from "./debug/DebugTools";
import { LoginClient, type LoginResult } from "./login/LoginClient";
import { GameClient } from "./game/GameClient";
import type { Config } from "./config";

const execAsync = promisify(exec);

function loadPhase2Inputs(): LoginResult {
  const path = join(process.cwd(), "artifacts", "phase-2-output.json");
  if (!existsSync(path)) {
    throw new Error("Phase 2 output not found: artifacts/phase-2-output.json");
  }
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as LoginResult;
  return parsed;
}

function hasSelfTestFailures(): boolean {
  return selfTestCounts().failed > 0;
}

async function runLoginPhase(
  cfg: Config,
  options: { writeArtifact?: boolean } = {},
): Promise<LoginResult> {
  runLoginCryptoSelfTests();

  const client = new LoginClient(cfg, options.writeArtifact ?? true);
  try {
    const result = await client.run();
    check("have 4 session ids", true);
    check("have game host/port", result.gameHost.length > 0 && result.gamePort > 0);

    report(
      2,
      client.getStatePath(),
      {
        loginOkId1: String(result.loginOkId1),
        loginOkId2: String(result.loginOkId2),
        playOkId1: String(result.playOkId1),
        playOkId2: String(result.playOkId2),
        gameHost: result.gameHost,
        gamePort: String(result.gamePort),
      },
      "none",
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check("login phase completed", false);
    report(2, client.getStatePath(), {}, message);
    throw new Error(message);
  }
}

async function runGamePhase(
  cfg: Config,
  input: LoginResult,
  phase: number,
): Promise<void> {
  runGameCryptoSelfTests();

  if (hasSelfTestFailures()) {
    report(phase, "IDLE", {}, "crypto self-test failed");
    throw new Error("crypto self-test failed");
  }

  const client = new GameClient(cfg, input, phase);
  try {
    await client.run();

    if (phase === 4) {
      check("answered >=1 ping", client.getAnsweredPingCount() >= 1);
    }

    const artifacts: Record<string, string> = {
      gameHost: input.gameHost,
      gamePort: String(input.gamePort),
      charCount: String(client.getCharCount()),
      encryptionFlag: String(client.getEncryptionFlag()),
      encryptionEnabled: String(client.getEncryptionFlag() !== 0),
    };
    if (phase === 4) {
      artifacts.answeredPingCount = String(client.getAnsweredPingCount());
    }

    if (hasSelfTestFailures()) {
      report(
        phase,
        client.getStatePath(),
        artifacts,
        `a phase ${phase} check failed`,
      );
      throw new Error(`a phase ${phase} check failed`);
    }

    report(phase, client.getStatePath(), artifacts, "none");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (phase === 4) {
      check("phase 4 completed", false);
    }

    const artifacts: Record<string, string> = {
      gameHost: input.gameHost,
      gamePort: String(input.gamePort),
      charCount: String(client.getCharCount()),
      encryptionFlag: String(client.getEncryptionFlag()),
      encryptionEnabled: String(client.getEncryptionFlag() !== 0),
    };
    if (phase === 4) {
      artifacts.answeredPingCount = String(client.getAnsweredPingCount());
    }

    report(phase, client.getStatePath(), artifacts, message);
    throw new Error(message);
  }
}

async function runPhase5(cfg: Config): Promise<void> {
  const tscClean = await runTypecheck();
  check("tsc clean", tscClean);

  if (!tscClean) {
    report(
      5,
      "CONFIG_LOADED",
      {
        loginIp: cfg.loginIp,
        loginPort: String(cfg.loginPort),
        gamePort: String(cfg.gamePort),
        username: cfg.username,
        serverId: String(cfg.serverId),
        charSlot: String(cfg.charSlot),
        protocol: String(cfg.protocol),
      },
      "tsc --noEmit reported errors",
    );
    throw new Error("tsc --noEmit reported errors");
  }

  let loginResult: LoginResult | null = null;
  try {
    loginResult = await runLoginPhase(cfg, { writeArtifact: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report(
      5,
      "CONFIG_LOADED",
      {
        loginIp: cfg.loginIp,
        loginPort: String(cfg.loginPort),
        gamePort: String(cfg.gamePort),
        username: cfg.username,
        serverId: String(cfg.serverId),
        charSlot: String(cfg.charSlot),
        protocol: String(cfg.protocol),
      },
      message,
    );
    throw err;
  }

  try {
    await runGamePhase(cfg, loginResult, 4);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report(
      5,
      "CONFIG_LOADED -> LOGIN_OK",
      {
        loginOkId1: String(loginResult.loginOkId1),
        loginOkId2: String(loginResult.loginOkId2),
        playOkId1: String(loginResult.playOkId1),
        playOkId2: String(loginResult.playOkId2),
        gameHost: loginResult.gameHost,
        gamePort: String(loginResult.gamePort),
      },
      message,
    );
    throw err;
  }

  report(
    5,
    "CONFIG_LOADED -> LOGIN_OK -> IN_GAME",
    {
      loginOkId1: String(loginResult.loginOkId1),
      loginOkId2: String(loginResult.loginOkId2),
      playOkId1: String(loginResult.playOkId1),
      playOkId2: String(loginResult.playOkId2),
      gameHost: loginResult.gameHost,
      gamePort: String(loginResult.gamePort),
    },
    "none",
  );
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  check("config complete", true);

  console.log("Loaded config:");
  console.log(
    JSON.stringify(
      {
        loginIp: cfg.loginIp,
        loginPort: cfg.loginPort,
        gamePort: cfg.gamePort,
        username: cfg.username,
        serverId: cfg.serverId,
        charSlot: cfg.charSlot,
        protocol: cfg.protocol,
        phase: cfg.phase,
      },
      null,
      2,
    ),
  );

  const phase = process.env.PHASE ?? "1";
  console.log(`PHASE env: ${phase}`);

  if (phase === "1") {
    const tscClean = await runTypecheck();
    check("tsc clean", tscClean);

    report(
      1,
      "IDLE -> CONFIG_LOADED",
      {
        loginIp: cfg.loginIp,
        loginPort: String(cfg.loginPort),
        gamePort: String(cfg.gamePort),
        username: cfg.username,
        serverId: String(cfg.serverId),
        charSlot: String(cfg.charSlot),
        protocol: String(cfg.protocol),
      },
      tscClean ? "none" : "tsc --noEmit reported errors",
    );
    return;
  }

  if (phase === "2") {
    try {
      await runLoginPhase(cfg);
    } catch {
      process.exitCode = 1;
    }
    return;
  }

  if (phase === "3") {
    let inputs: LoginResult;
    try {
      inputs = loadPhase2Inputs();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      check("phase 2 inputs loaded", false);
      report(3, "IDLE", {}, message);
      process.exitCode = 1;
      return;
    }

    try {
      await runGamePhase(cfg, inputs, 3);
    } catch {
      process.exitCode = 1;
    }
    return;
  }

  if (phase === "4") {
    let inputs: LoginResult;
    try {
      inputs = loadPhase2Inputs();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      check("phase 2 inputs loaded", false);
      report(4, "IDLE", {}, message);
      process.exitCode = 1;
      return;
    }

    try {
      await runGamePhase(cfg, inputs, 4);
    } catch {
      process.exitCode = 1;
    }
    return;
  }

  if (phase === "full" || phase === "0" || phase === "5") {
    try {
      await runPhase5(cfg);
    } catch {
      process.exitCode = 1;
    }
    return;
  }

  console.log(`Phase ${phase} not yet implemented. Exiting.`);
  process.exitCode = 1;
}

async function runTypecheck(): Promise<boolean> {
  try {
    await execAsync("npx tsc --noEmit", {
      cwd: process.cwd(),
      timeout: 60000,
    });
    return true;
  } catch (err) {
    console.error("tsc --noEmit failed:", err);
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
