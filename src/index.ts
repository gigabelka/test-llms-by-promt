import { config } from "./config";
import { DebugTools, runLoginCryptoSelfTests } from "./debug/DebugTools";
import { LoginClient, LoginResult } from "./login/LoginClient";
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

  // Future phases will be dispatched here.
  if (
    phaseRaw === "full" ||
    phaseRaw === "0" ||
    phaseRaw === "3" ||
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
