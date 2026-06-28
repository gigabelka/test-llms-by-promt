export class DebugTools {
  private passed = 0;
  private failed = 0;

  /** Run a named check. Returns `cond` so callers can branch on it. */
  check(name: string, cond: boolean): boolean {
    if (cond) {
      console.log(`[ok] ${name}`);
      this.passed++;
    } else {
      console.log(`[FAIL] ${name}`);
      this.failed++;
    }
    return cond;
  }

  /** Return current self-test tallies. */
  selfTestCounts(): { passed: number; failed: number } {
    return { passed: this.passed, failed: this.failed };
  }

  /** Log a finite-state-machine transition. */
  logState(from: string, to: string): void {
    console.log(`[STATE] ${from} -> ${to}`);
  }

  /** Assert that `actual === expected`; throws with a contextual message on mismatch. */
  assertState(actual: string, expected: string, ctx: string): void {
    if (actual !== expected) {
      throw new Error(
        `State assertion failed in ${ctx}: expected "${expected}", got "${actual}"`,
      );
    }
  }

  /** Print the standard per-phase report. */
  report(
    phase: number,
    statePath: string,
    artifacts: Record<string, string>,
    notes?: string,
  ): void {
    const { passed, failed } = this.selfTestCounts();
    const total = passed + failed;
    const status = failed === 0 ? "PASS" : "FAIL";

    console.log(`=== PHASE ${phase} REPORT ===`);
    console.log(`status: ${status}`);
    console.log(`self-tests: ${passed}/${total}`);
    console.log(`state-path: ${statePath}`);
    console.log(
      `artifacts: ${Object.entries(artifacts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`,
    );
    if (notes) {
      console.log(`notes: ${notes}`);
    }
  }
}
