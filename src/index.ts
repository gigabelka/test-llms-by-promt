// One straight-line run: crypto self-tests → login → enter world → 60 s keepalive → one report.
// No phases, no PHASE env var. Owns the shared statePath, the single report, and the 45 s watchdog.
import { runLoginCryptoSelfTests, runGameCryptoSelfTests } from "./crypto/selfTests.ts";
import { runLogin } from "./login/LoginClient.ts";
import { runGame } from "./game/GameClient.ts";
import { loadConfig } from "./config.ts";
import { selfTestCounts, report } from "./debug/DebugTools.ts";
import type { Artifacts, LoginResult } from "./types.ts";

const WATCHDOG_MS = 45_000;

function main(): void {
  let statePath: string[] = ["IDLE"];
  let done = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const settleDone = (): void => {
    if (done) return;
    done = true;
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const failRun = (msg: string): void => {
    settleDone();
    report(statePath, {}, msg);
    process.exit(1);
  };

  const finish = (artifacts: Artifacts): void => {
    settleDone();
    report(statePath, artifacts);
    process.exit(0);
  };

  try {
    // 1. Config.
    const cfg = loadConfig();

    // 2. Crypto self-tests, before any socket I/O. A red check stops here.
    runLoginCryptoSelfTests();
    runGameCryptoSelfTests();
    const { failed } = selfTestCounts();
    if (failed !== 0) {
      report(statePath, {});
      process.exit(1);
    }

    // 3. Whole-run watchdog: a failing run must end within 45 s.
    watchdog = setTimeout(() => {
      const last = statePath[statePath.length - 1] ?? "IDLE";
      failRun(`watchdog: ${last}`);
    }, WATCHDOG_MS);

    // 4. Login: authenticate, resolve the 4 session ids + game host/port (in memory).
    runLogin(cfg, statePath).then((login: LoginResult) => {
      const input = { ...login, username: cfg.username };
      // onInGame cancels the watchdog the moment IN_GAME is printed (keepalive then governs).
      return runGame(cfg, input, statePath, () => settleDone());
    })
      .then(finish)
      .catch((err: Error) => failRun(err.message));
  } catch (err) {
    failRun((err as Error).message);
  }
}

main();
