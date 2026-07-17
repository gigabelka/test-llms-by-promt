import { config } from "./config";
import {
  check,
  report,
  runGameCryptoSelfTests,
  runLoginCryptoSelfTests,
  selfTestCounts,
} from "./debug/DebugTools";
import { runGame, GameInput } from "./game/GameClient";
import { runLogin, LoginResult } from "./login/LoginClient";

async function main(): Promise<void> {
  const statePath: string[] = ["IDLE"];
  const artifacts: Record<string, unknown> = {};

  try {
    runLoginCryptoSelfTests();
    runGameCryptoSelfTests();

    const counts = selfTestCounts();
    if (counts.failed > 0) {
      throw new Error(`${counts.failed} crypto self-test(s) failed`);
    }

    const loginResult: LoginResult = await runLogin(config, statePath);
    artifacts.loginOkId1 = loginResult.loginOkId1;
    artifacts.loginOkId2 = loginResult.loginOkId2;
    artifacts.playOkId1 = loginResult.playOkId1;
    artifacts.playOkId2 = loginResult.playOkId2;
    artifacts.gameHost = loginResult.gameHost;
    artifacts.gamePort = loginResult.gamePort;
    artifacts.serverId = config.serverId;
    artifacts.charSlot = config.charSlot;
    artifacts.protocol = config.protocol;

    const gameInput: GameInput = {
      loginOkId1: loginResult.loginOkId1,
      loginOkId2: loginResult.loginOkId2,
      playOkId1: loginResult.playOkId1,
      playOkId2: loginResult.playOkId2,
      gameHost: loginResult.gameHost,
      gamePort: loginResult.gamePort,
    };
    await runGame(config, gameInput, statePath);

    check("run completed without error", true);
    report(statePath, artifacts);
    process.exit(0);
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err);
    check("run completed without error", false);
    report(statePath, artifacts, note);
    process.exit(1);
  }
}

main();
