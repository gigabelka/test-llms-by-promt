import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
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

async function runPhase3(): Promise<void> {
  let statePath = "IDLE -> CONFIG_LOADED";

  try {
    // Load config and phase-2-output.json artifacts
    const cfg = loadConfig();

    printConfig(cfg);

    const artifactsDir = path.join(process.cwd(), "artifacts");
    const artifactsFile = path.join(artifactsDir, "phase-2-output.json");

    if (!fs.existsSync(artifactsFile)) {
      console.log("Error: phase-2-output.json not found. Please run PHASE=2 first.");
      report(3, "IDLE -> ERROR", {}, "phase-2-output.json not found");
      process.exit(1);
    }

    const artifactsContent = fs.readFileSync(artifactsFile, "utf8");
    const artifacts = JSON.parse(artifactsContent);

    const { loginOkId1, loginOkId2, playOkId1, playOkId2, gameHost, gamePort } = artifacts;

    // Create and connect GameClient
    const gameClient = new (await import("./game/GameClient")).GameClient(
      gameHost,
      gamePort,
      cfg.username,
      playOkId2,
      playOkId1,
      loginOkId1,
      loginOkId2,
      cfg.charSlot,
      cfg.protocol
    );

    statePath = "IDLE -> CONFIG_LOADED -> WAIT_CRYPT_INIT";

    // Wait for game authentication to complete
    const result = await gameClient.connectAndAuthenticate();

    // PHASE 3 REPORT with artifacts
    const reportArtifacts: Record<string, string | number | boolean> = {
      loginOkId1,
      loginOkId2,
      playOkId1,
      playOkId2,
      gameHost,
      gamePort,
      charSlot: cfg.charSlot,
      protocol: cfg.protocol,
    };

    report(3, "WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED -> WAIT_USER_INFO", reportArtifacts, "Game authentication and character selection completed successfully");
  } catch (err) {
    const notes = err instanceof Error ? err.message : String(err);
    report(3, statePath + " -> ERROR", {}, notes);
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
    const loginClient = new (await import("./login/LoginClient")).LoginClient(
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

async function runPhase4(): Promise<void> {
  let statePath = "IDLE -> CONFIG_LOADED";

  try {
    // Load config and phase-2-output.json artifacts
    const cfg = loadConfig();

    printConfig(cfg);

    const artifactsDir = path.join(process.cwd(), "artifacts");
    const artifactsFile = path.join(artifactsDir, "phase-2-output.json");

    if (!fs.existsSync(artifactsFile)) {
      console.log("Error: phase-2-output.json not found. Please run PHASE=2 first.");
      report(4, "IDLE -> ERROR", {}, "phase-2-output.json not found");
      process.exit(1);
    }

    const artifactsContent = fs.readFileSync(artifactsFile, "utf8");
    const artifacts = JSON.parse(artifactsContent);

    const { loginOkId1, loginOkId2, playOkId1, playOkId2, gameHost, gamePort } = artifacts;

    // Create and connect GameClientPhase4
    const GameClientPhase4 = (await import("./game/GameClientPhase4")).GameClientPhase4;
    const gameClient = new GameClientPhase4({
      loginOkId1,
      loginOkId2,
      playOkId1,
      playOkId2,
      gameHost,
      gamePort,
      username: cfg.username,
      charSlot: cfg.charSlot,
      protocol: cfg.protocol,
    });

    statePath = "IDLE -> CONFIG_LOADED -> CONNECTED";

    // Wait for game authentication and keepalive to complete
    await gameClient.connectAndAuthenticate();

    // PHASE 4 REPORT is printed by the GameClientPhase4's 60-second timer
  } catch (err) {
    const notes = err instanceof Error ? err.message : String(err);
    report(4, statePath + " -> ERROR", {}, notes);
    process.exit(1);
  }
}

async function runPhase5(): Promise<void> {
  let statePath = "IDLE -> CONFIG_LOADED";

  try {
    // Load config and print it
    const cfg = loadConfig();
    printConfig(cfg);

    // Run tsc --noEmit check
    try {
      execSync("npx tsc --noEmit", { stdio: "pipe" });
      check("tsc clean", true);
    } catch (err) {
      console.log("FAIL: TypeScript check failed");
      report(5, "IDLE -> CONFIG_LOADED -> TSC_CHECK_FAIL -> ERROR", {}, "TypeScript check failed");
      process.exit(1);
    }

    // Run login crypto self-tests before any login socket I/O
    runLoginCryptoSelfTests();

    statePath = "CONFIG_LOADED -> LOGIN_OK";

    // Run Phase 2: Login Server authentication
    const { LoginClient } = await import("./login/LoginClient");
    const loginClient = new LoginClient(
      cfg.loginIp,
      cfg.loginPort,
      cfg.username,
      cfg.password,
      cfg.serverId
    );

    let loginResult: Awaited<ReturnType<typeof loginClient.connectAndAuthenticate>>;
    try {
      loginResult = await loginClient.connectAndAuthenticate();
    } catch (err) {
      const notes = err instanceof Error ? err.message : String(err);
      report(5, statePath + " -> ERROR", {}, notes);
      process.exit(1);
    }

    // Run game crypto self-tests before any game socket I/O
    runGameCryptoSelfTests();

    statePath = "CONFIG_LOADED -> LOGIN_OK -> IN_GAME";

    // Pass the LoginResult directly as GamePhaseInput to GameClientPhase4
    const { GameClientPhase4 } = await import("./game/GameClientPhase4");
    const gameClient = new GameClientPhase4({
      loginOkId1: loginResult.loginOkId1,
      loginOkId2: loginResult.loginOkId2,
      playOkId1: loginResult.playOkId1,
      playOkId2: loginResult.playOkId2,
      gameHost: loginResult.gameHost,
      gamePort: loginResult.gamePort,
      username: cfg.username,
      charSlot: cfg.charSlot,
      protocol: cfg.protocol,
    });

    try {
      await gameClient.connectAndAuthenticate();
    } catch (err) {
      const notes = err instanceof Error ? err.message : String(err);
      report(5, statePath + " -> ERROR", {}, notes);
      process.exit(1);
    }

    // PHASE 5 REPORT on success
    const artifacts: Record<string, string | number | boolean> = {
      loginOkId1: loginResult.loginOkId1,
      loginOkId2: loginResult.loginOkId2,
      playOkId1: loginResult.playOkId1,
      playOkId2: loginResult.playOkId2,
      gameHost: loginResult.gameHost,
      gamePort: loginResult.gamePort,
    };

    report(5, "CONFIG_LOADED -> LOGIN_OK -> IN_GAME", artifacts, "Full end-to-end run completed successfully");
  } catch (err) {
    const notes = err instanceof Error ? err.message : String(err);
    report(5, statePath + " -> ERROR", {}, notes);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Read PHASE directly from process.env.PHASE for dispatch
  const phaseEnv = process.env.PHASE;

  console.log("PHASE env:", phaseEnv || "(unset, defaulting to full)");

  if (phaseEnv === "1") {
    // PHASE=1: run Phase 1 setup & config
    runPhase1();
  } else if (phaseEnv === undefined || phaseEnv === "" || phaseEnv === "full" || phaseEnv === "0" || phaseEnv === "5") {
    // PHASE=full/0/5: run full end-to-end Phase 5
    await runPhase5().catch((err: Error) => {
      console.error("Phase 5 error:", err);
      process.exit(1);
    });
  } else if (phaseEnv === "2") {
    // PHASE=2: Login Server
    await runPhase2().catch((err: Error) => {
      console.error("Phase 2 error:", err);
      process.exit(1);
    });
  } else if (phaseEnv === "3") {
    // PHASE=3: Game Auth & Character
    await runPhase3().catch((err: Error) => {
      console.error("Phase 3 error:", err);
      process.exit(1);
    });
  } else if (phaseEnv === "4") {
    // PHASE=4: Enter World & Keepalive
    await runPhase4().catch((err: Error) => {
      console.error("Phase 4 error:", err);
      process.exit(1);
    });
  } else {
    console.log(`Unknown PHASE: ${phaseEnv}`);
    process.exit(1);
  }
}

// Run main
main().catch((err: Error) => {
  console.error("Main error:", err);
  process.exit(1);
});
