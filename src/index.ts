import { loadConfig } from "./config";
import {
  check,
  report,
  runGameCryptoSelfTests,
  runLoginCryptoSelfTests,
  selfTestCounts,
} from "./debug/DebugTools";
import { runLogin } from "./login/LoginClient";
import { runGame } from "./game/GameClient";

// Single straight-line program: config -> self-tests -> login -> game -> one final report.
// No PHASE env var, no per-stage report blocks.
async function main(): Promise<void> {
  // statePath is owned here and shared into both stages, so the final report
  // shows one IDLE -> ... -> IN_GAME sequence.
  const statePath = ["IDLE"];
  const artifacts: Record<string, string> = {};

  let cfg;
  try {
    // 1. Load and validate config.
    cfg = loadConfig();

    // 2. Crypto self-tests run once, BEFORE any socket I/O.
    runLoginCryptoSelfTests();
    runGameCryptoSelfTests();
    if (selfTestCounts().failed > 0) {
      report(statePath, artifacts, "crypto self-tests failed");
      process.exitCode = 1;
      return;
    }

    // 3. Login server: session ids + game host/port.
    const input = await runLogin(cfg, statePath);
    artifacts.loginOkId1 = String(input.loginOkId1);
    artifacts.loginOkId2 = String(input.loginOkId2);
    artifacts.playOkId1 = String(input.playOkId1);
    artifacts.playOkId2 = String(input.playOkId2);
    artifacts.gameHost = input.gameHost;
    artifacts.gamePort = String(input.gamePort);

    // 4. Game server: enter the world, answer pings for 60 seconds.
    await runGame(cfg, input, statePath);
    check("run completed without error", true);

    // 5. Exactly one final report.
    report(statePath, artifacts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report(statePath, artifacts, msg);
    process.exitCode = 1;
  }
}

main();
