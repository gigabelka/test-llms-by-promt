import { config } from "./config";
import { runLogin } from "./login/LoginClient";
import { runGame } from "./game/GameClient";
import { runLoginCryptoSelfTests, runGameCryptoSelfTests, logState, report, check, selfTestCounts } from "./debug/DebugTools";

async function main(): Promise<void> {
  const statePath: string[] = ["IDLE"];
  const artifacts: Record<string, string | number> = {};
  let notes: string | undefined;

  try {
    // Gate 1: crypto self-tests BEFORE any socket I/O
    runLoginCryptoSelfTests();
    runGameCryptoSelfTests();

    // Login
    const loginResult = await runLogin(config, statePath);
    artifacts.loginOkId1 = loginResult.loginOkId1;
    artifacts.loginOkId2 = loginResult.loginOkId2;
    artifacts.playOkId1 = loginResult.playOkId1;
    artifacts.playOkId2 = loginResult.playOkId2;
    artifacts.gameHost = loginResult.gameHost;
    artifacts.gamePort = loginResult.gamePort;

    // Game
    await runGame(config, {
      loginOkId1: loginResult.loginOkId1,
      loginOkId2: loginResult.loginOkId2,
      playOkId1: loginResult.playOkId1,
      playOkId2: loginResult.playOkId2,
      gameHost: loginResult.gameHost,
      gamePort: loginResult.gamePort,
    }, statePath);

    notes = "run completed without error";
    check(notes, true);
  } catch (err: any) {
    notes = err.message ?? String(err);
  }

  report(statePath, artifacts, notes);
  if (notes && notes !== "run completed without error") process.exit(1);
}

main();
