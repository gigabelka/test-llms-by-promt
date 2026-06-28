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
    runLoginCryptoSelfTests();

    const client = new LoginClient(cfg);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      check("login phase completed", false);
      report(2, client.getStatePath(), {}, message);
      process.exitCode = 1;
    }
    return;
  }

  if (phase === "3") {
    runLoginCryptoSelfTests();
    runGameCryptoSelfTests();

    if (hasSelfTestFailures()) {
      report(3, "IDLE", {}, "crypto self-test failed");
      process.exitCode = 1;
      return;
    }

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

    const client = new GameClient(cfg, inputs);
    try {
      await client.run();

      if (hasSelfTestFailures()) {
        report(
          3,
          client.getStatePath(),
          {
            gameHost: inputs.gameHost,
            gamePort: String(inputs.gamePort),
            charCount: String(client.getCharCount()),
            encryptionFlag: String(client.getEncryptionFlag()),
            encryptionEnabled: String(client.getEncryptionFlag() !== 0),
          },
          "a phase 3 check failed",
        );
        process.exitCode = 1;
        return;
      }

      report(
        3,
        client.getStatePath(),
        {
          gameHost: inputs.gameHost,
          gamePort: String(inputs.gamePort),
          charCount: String(client.getCharCount()),
          encryptionFlag: String(client.getEncryptionFlag()),
          encryptionEnabled: String(client.getEncryptionFlag() !== 0),
        },
        "none",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report(
        3,
        client.getStatePath(),
        {
          gameHost: inputs.gameHost,
          gamePort: String(inputs.gamePort),
          charCount: String(client.getCharCount()),
          encryptionFlag: String(client.getEncryptionFlag()),
          encryptionEnabled: String(client.getEncryptionFlag() !== 0),
        },
        message,
      );
      process.exitCode = 1;
    }
    return;
  }

  if (phase === "4") {
    runLoginCryptoSelfTests();
    runGameCryptoSelfTests();

    if (hasSelfTestFailures()) {
      report(4, "IDLE", {}, "crypto self-test failed");
      process.exitCode = 1;
      return;
    }

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

    const client = new GameClient(cfg, inputs, 4);
    try {
      await client.run();

      check("answered >=1 ping", client.getAnsweredPingCount() >= 1);

      if (hasSelfTestFailures()) {
        report(
          4,
          client.getStatePath(),
          {
            gameHost: inputs.gameHost,
            gamePort: String(inputs.gamePort),
            charCount: String(client.getCharCount()),
            encryptionFlag: String(client.getEncryptionFlag()),
            encryptionEnabled: String(client.getEncryptionFlag() !== 0),
            answeredPingCount: String(client.getAnsweredPingCount()),
          },
          "a phase 4 check failed",
        );
        process.exitCode = 1;
        return;
      }

      report(
        4,
        client.getStatePath(),
        {
          gameHost: inputs.gameHost,
          gamePort: String(inputs.gamePort),
          charCount: String(client.getCharCount()),
          encryptionFlag: String(client.getEncryptionFlag()),
          encryptionEnabled: String(client.getEncryptionFlag() !== 0),
          answeredPingCount: String(client.getAnsweredPingCount()),
        },
        "none",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      check("phase 4 completed", false);
      report(
        4,
        client.getStatePath(),
        {
          gameHost: inputs.gameHost,
          gamePort: String(inputs.gamePort),
          charCount: String(client.getCharCount()),
          encryptionFlag: String(client.getEncryptionFlag()),
          encryptionEnabled: String(client.getEncryptionFlag() !== 0),
          answeredPingCount: String(client.getAnsweredPingCount()),
        },
        message,
      );
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
