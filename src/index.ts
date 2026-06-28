import { exec } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "./config";
import { check, report, runLoginCryptoSelfTests } from "./debug/DebugTools";
import { LoginClient } from "./login/LoginClient";

const execAsync = promisify(exec);

// Entry point: load configuration and dispatch by PHASE.
// Routing uses process.env.PHASE directly, NOT cfg.phase.
async function main(): Promise<void> {
  const cfg = loadConfig();
  check("config complete", true);

  console.log("Loaded config:");
  console.log(JSON.stringify(
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
  ));

  const phase = process.env.PHASE ?? "1";
  console.log(`PHASE env: ${phase}`);

  // PHASE 1 is implemented first; later phases will be wired here.
  if (phase === "1") {
    const tscClean = await runTypecheck();
    check("tsc clean", tscClean);

    report(1, "IDLE -> CONFIG_LOADED", {
      loginIp: cfg.loginIp,
      loginPort: String(cfg.loginPort),
      gamePort: String(cfg.gamePort),
      username: cfg.username,
      serverId: String(cfg.serverId),
      charSlot: String(cfg.charSlot),
      protocol: String(cfg.protocol),
    }, tscClean ? "none" : "tsc --noEmit reported errors");
    return;
  }

  if (phase === "2") {
    runLoginCryptoSelfTests();

    const client = new LoginClient(cfg);
    try {
      const result = await client.run();
      check("have 4 session ids", true);
      check("have game host/port", result.gameHost.length > 0 && result.gamePort > 0);

      report(2, client.getStatePath(), {
        loginOkId1: String(result.loginOkId1),
        loginOkId2: String(result.loginOkId2),
        playOkId1: String(result.playOkId1),
        playOkId2: String(result.playOkId2),
        gameHost: result.gameHost,
        gamePort: String(result.gamePort),
      }, "none");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      check("login phase completed", false);
      report(2, client.getStatePath(), {}, message);
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
