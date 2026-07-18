import { loadConfig } from "./config";
import {
  runLoginCryptoSelfTests,
  runGameCryptoSelfTests,
  check,
  report,
} from "./debug/DebugTools";
import { runLogin, LoginResult } from "./login/LoginClient";
import { runGame } from "./game/GameClient";

// Single straight-line program: config -> crypto self-tests -> login -> game -> one final report.
// No build phases, no PHASE env var, no per-stage reports.
async function main(): Promise<void> {
  const statePath: string[] = ["IDLE"];
  const artifacts: Record<string, unknown> = {};
  try {
    const cfg = loadConfig();

    // Crypto self-tests run ONCE, before any socket I/O.
    const loginCryptoOk = runLoginCryptoSelfTests();
    const gameCryptoOk = runGameCryptoSelfTests();
    if (!loginCryptoOk || !gameCryptoOk) {
      throw new Error("crypto self-tests failed — aborting before any socket I/O");
    }

    // Login server: authenticate and obtain session ids + game host/port.
    const login: LoginResult = await runLogin(cfg, statePath);
    artifacts.loginOkId1 = login.loginOkId1;
    artifacts.loginOkId2 = login.loginOkId2;
    artifacts.playOkId1 = login.playOkId1;
    artifacts.playOkId2 = login.playOkId2;
    artifacts.gameHost = login.gameHost;
    artifacts.gamePort = login.gamePort;

    // Game server: enter the world, print IN_GAME, answer pings for 60s, close cleanly.
    await runGame(cfg, login, statePath);

    check("run completed without error", true);
    report(statePath, artifacts);
    process.exit(0);
  } catch (err) {
    check("run completed without error", false);
    report(statePath, artifacts, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

void main();
