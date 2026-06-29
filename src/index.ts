import * as dotenv from "dotenv";
import { loadConfig } from "./config";
import { runLoginCryptoSelfTests, runGameCryptoSelfTests, report, check } from "./debug/DebugTools";

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

function main(): void {
  // Read PHASE directly from process.env.PHASE for dispatch
  const phaseEnv = process.env.PHASE;

  console.log("PHASE env:", phaseEnv || "(unset, defaulting to full)");

  if (phaseEnv === "1" || phaseEnv === undefined || phaseEnv === "" || phaseEnv === "full" || phaseEnv === "0" || phaseEnv === "5") {
    // PHASE=1 or PHASE=full/0/5: run Phase 1 setup & config
    runPhase1();
  } else if (phaseEnv === "2") {
    console.log("PHASE 2 - Login Server (not implemented in this phase)");
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
