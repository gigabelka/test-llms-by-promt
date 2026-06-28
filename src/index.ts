import { config } from "./config";
import { DebugTools, runLoginCryptoSelfTests, runGameCryptoSelfTests } from "./debug/DebugTools";
import { LoginClient, LoginResult } from "./login/LoginClient";
import { GameClient, GamePhaseInput } from "./game/GameClient";
import * as fs from "node:fs";
import * as path from "node:path";

async function main(): Promise<void> {
  const phaseRaw = (process.env.PHASE ?? "full").toLowerCase();

  // Print the loaded config (mask password).
  const safeCfg = { ...config, password: "***" };
  console.log("Loaded config:", safeCfg);
  console.log(
    `PHASE env = "${process.env.PHASE ?? "(unset)"}" -> resolved to "${phaseRaw}"`,
  );

  if (phaseRaw === "1") {
    // --- PHASE 1: Setup & Config ---
    const dt = new DebugTools();

    // Self-debug: typecheck
    const { execSync } = await import("node:child_process");
    let tscOk = false;
    try {
      execSync("npx tsc --noEmit", {
        cwd: process.cwd(),
        stdio: "pipe",
        encoding: "utf-8",
      });
      tscOk = true;
    } catch {
      tscOk = false;
    }
    dt.check("tsc clean", tscOk);
    dt.check("config complete", config.loginIp.length > 0);

    dt.report(1, "IDLE -> CONFIG_LOADED", {
      loginIp: config.loginIp,
      loginPort: String(config.loginPort),
      gamePort: String(config.gamePort),
      serverId: String(config.serverId),
      charSlot: String(config.charSlot),
      protocol: String(config.protocol),
    });
    return;
  }

  if (phaseRaw === "2") {
    // --- PHASE 2: Login Server ---
    const dt = new DebugTools();

    // Run crypto self-tests BEFORE any socket I/O
    runLoginCryptoSelfTests(dt);

    // Connect and run the login FSM
    const client = new LoginClient(dt, config);
    try {
      const result: LoginResult = await client.run();

      // Write artifacts
      const artifactsDir = path.resolve(__dirname, "..", "artifacts");
      const artifacts: Record<string, string | number> = {
        loginOkId1: result.loginOkId1,
        loginOkId2: result.loginOkId2,
        playOkId1: result.playOkId1,
        playOkId2: result.playOkId2,
        gameHost: result.gameHost,
        gamePort: result.gamePort,
      };
      fs.mkdirSync(artifactsDir, { recursive: true });
      fs.writeFileSync(
        path.join(artifactsDir, "phase-2-output.json"),
        JSON.stringify(artifacts, null, 2),
        "utf-8",
      );

      // Print the PHASE 2 REPORT
      const statePath =
        "WAIT_INIT -> WAIT_GG_AUTH -> WAIT_LOGIN_OK -> WAIT_SERVER_LIST -> WAIT_PLAY_OK";
      dt.report(2, statePath, {
        loginOkId1: String(result.loginOkId1),
        loginOkId2: String(result.loginOkId2),
        playOkId1: String(result.playOkId1),
        playOkId2: String(result.playOkId2),
        gameHost: result.gameHost,
        gamePort: String(result.gamePort),
      });
    } catch (err: any) {
      // On failure, print the report with FAIL status
      const statePath =
        "WAIT_INIT -> WAIT_GG_AUTH -> WAIT_LOGIN_OK -> WAIT_SERVER_LIST -> WAIT_PLAY_OK";
      dt.report(
        2,
        statePath,
        {
          loginOkId1: "N/A",
          loginOkId2: "N/A",
          playOkId1: "N/A",
          playOkId2: "N/A",
          gameHost: "N/A",
          gamePort: "N/A",
        },
        err.message,
      );
      process.exit(1);
    }
    return;
  }

  if (phaseRaw === "3") {
    // --- PHASE 3: Game Auth & Character ---
    const dt = new DebugTools();

    // Run full crypto self-tests (Blowfish + GameCrypt round-trip) before socket I/O
    runLoginCryptoSelfTests(dt);
    runGameCryptoSelfTests(dt);

    // Check for self-test failures before proceeding
    const preCounts = dt.selfTestCounts();
    if (preCounts.failed > 0) {
      const statePath =
        "WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED";
      dt.report(3, statePath, {
        loginOkId1: "N/A",
        loginOkId2: "N/A",
        playOkId1: "N/A",
        playOkId2: "N/A",
        gameHost: "N/A",
        gamePort: "N/A",
      }, "Crypto self-tests failed before socket I/O");
      process.exit(1);
    }

    // Load inputs from artifacts file or config
    let input: GamePhaseInput;
    try {
      const artifactsRaw = fs.readFileSync(
        path.resolve(__dirname, "..", "artifacts", "phase-2-output.json"),
        "utf-8",
      );
      const artifacts = JSON.parse(artifactsRaw);
      input = {
        loginOkId1: artifacts.loginOkId1,
        loginOkId2: artifacts.loginOkId2,
        playOkId1: artifacts.playOkId1,
        playOkId2: artifacts.playOkId2,
        gameHost: artifacts.gameHost,
        gamePort: artifacts.gamePort,
      };
      console.log("Loaded Phase 2 artifacts from disk.");
    } catch {
      // Fallback: construct from config (for inline/pasted inputs)
      console.log(
        "No artifacts file found — using config-based game connection (host from L2_LOGIN_IP, port from L2_GAME_PORT).",
      );
      input = {
        loginOkId1: 0,
        loginOkId2: 0,
        playOkId1: 0,
        playOkId2: 0,
        gameHost: config.loginIp,
        gamePort: config.gamePort,
      };
    }

    console.log(
      `Connecting to game server ${input.gameHost}:${input.gamePort}...`,
    );

    const client = new GameClient(dt, config, input);
    try {
      await client.run();

      const statePath =
        "WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED -> WAIT_USER_INFO";
      dt.report(3, statePath, {
        loginOkId1: String(input.loginOkId1),
        loginOkId2: String(input.loginOkId2),
        playOkId1: String(input.playOkId1),
        playOkId2: String(input.playOkId2),
        gameHost: input.gameHost,
        gamePort: String(input.gamePort),
      });
    } catch (err: any) {
      // Mark as failed so the report shows FAIL status
      dt.check("phase completed", false);
      const statePath =
        "WAIT_CRYPT_INIT -> WAIT_CHAR_LIST -> WAIT_CHAR_SELECTED";
      dt.report(
        3,
        statePath,
        {
          loginOkId1: String(input.loginOkId1),
          loginOkId2: String(input.loginOkId2),
          playOkId1: String(input.playOkId1),
          playOkId2: String(input.playOkId2),
          gameHost: input.gameHost,
          gamePort: String(input.gamePort),
        },
        err.message,
      );
      process.exit(1);
    }
    return;
  }

  // Future phases will be dispatched here.
  if (
    phaseRaw === "full" ||
    phaseRaw === "0" ||
    phaseRaw === "4" ||
    phaseRaw === "5"
  ) {
    console.log(`Phase "${phaseRaw}" is not yet implemented.`);
    return;
  }

  console.log(`Unknown phase "${phaseRaw}".`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
