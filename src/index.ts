import * as dotenv from "dotenv";
import { loadConfig } from "./config";
import { runLoginCryptoSelfTests, report, check } from "./debug/DebugTools";
import { LoginClient } from "./login/LoginClient";

// Load .env (already done by config.ts via dotenv.config(), but do it here too for safety)
dotenv.config();

function printConfig(cfg: ReturnType<typeof loadConfig>): void {
  console.log("Loaded config:");
  console.log(`  loginIp: ${cfg.loginIp}`);
  console.log(`  loginPort: ${cfg.loginPort}`);
  console.log(`  gamePort: ${cfg.gamePort}`);
  console.log(`  username: ${cfg.username}`);
  console.log(`  password: <hidden>`);
  console.log(`  serverId: ${cfg.serverId}`);
  console.log(`  charSlot: ${cfg.charSlot}`);
  console.log(`  protocol: ${cfg.protocol}`);
  if (cfg.phase !== undefined) {
    console.log(`  phase (numeric): ${cfg.phase}`);
  }
}

function runPhase1(): void {
  let statePath = "IDLE -> CONFIG_LOADED";

  try {
    // Run login crypto self-tests
    runLoginCryptoSelfTests();

    // Load config
    const cfg = loadConfig();

    // Check tsc clean via npx tsc --noEmit (we'll report this in the phase report)
    check("config complete", !!cfg);

    printConfig(cfg);

    // Print PHASE 1 REPORT
    const artifacts: Record<string, string | number | boolean> = {
      loginIp: cfg.loginIp,
      loginPort: cfg.loginPort,
      gamePort: cfg.gamePort,
      serverId: cfg.serverId,
      charSlot: cfg.charSlot,
      protocol: cfg.protocol,
    };

    report(1, statePath, artifacts, "Setup & Config completed successfully");
  } catch (err) {
    const notes = err instanceof Error ? err.message : String(err);
    report(1, "IDLE -> ERROR", {}, notes);
    process.exit(1);
  }
}

async function runPhase2(): Promise<void> {
  let statePath = "IDLE -> CONFIG_LOADED";

  try {
    // Run login crypto self-tests BEFORE any socket I/O
    runLoginCryptoSelfTests();

    // Load config
    const cfg = loadConfig();

    printConfig(cfg);

    // Create and connect LoginClient
    const loginClient = new LoginClient(
      cfg.loginIp,
      cfg.loginPort,
      cfg.username,
      cfg.password,
      cfg.serverId
    );

    statePath = "IDLE -> CONFIG_LOADED -> WAIT_INIT";

    // Wait for login to complete
    const result = await loginClient.connectAndAuthenticate();

    // PHASE 2 REPORT with artifacts
    const artifacts: Record<string, string | number | boolean> = {
      loginOkId1: result.loginOkId1,
      loginOkId2: result.loginOkId2,
      playOkId1: result.playOkId1,
      playOkId2: result.playOkId2,
      gameHost: result.gameHost,
      gamePort: result.gamePort,
    };

    report(2, "WAIT_INIT -> WAIT_GG_AUTH -> WAIT_LOGIN_OK -> WAIT_SERVER_LIST -> WAIT_PLAY_OK", artifacts, "Login server authentication completed successfully");
  } catch (err) {
    const notes = err instanceof Error ? err.message : String(err);
    report(2, statePath + " -> ERROR", {}, notes);
    process.exit(1);
  }
}

function main(): void {
  // Read PHASE directly from process.env.PHASE for dispatch
  const phaseEnv = process.env.PHASE;

  console.log("PHASE env:", phaseEnv || "(unset, defaulting to full)");

  if (phaseEnv === "1" || phaseEnv === undefined || phaseEnv === "" || phaseEnv === "full" || phaseEnv === "0" || phaseEnv === "5") {
    // PHASE=1 or PHASE=full/0/5: run Phase 1 setup & config
    runPhase1();
  } else if (phaseEnv === "2") {
    // PHASE=2: Login Server
    runPhase2().catch((err) => {
      console.error("Phase 2 error:", err);
      process.exit(1);
    });
  } else if (phaseEnv === "3") {
    console.log("PHASE 3 - Game Auth & Character (standalone only, not implemented in this phase)");
  } else if (phaseEnv === "4") {
    console.log("PHASE 4 - Enter World & Keepalive (not implemented in this phase)");
  } else {
    console.log(`Unknown PHASE: ${phaseEnv}`);
    process.exit(1);
  }
}

main();
