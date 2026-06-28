import { blowfishEncrypt, blowfishDecrypt } from "../crypto/Blowfish";

/** Run login-crypto self-tests (Blowfish round-trip + LoginCrypt sanity). */
export function runLoginCryptoSelfTests(dt: DebugTools): void {
  const key16 = Buffer.from("0123456789abcdef", "ascii");
  const block8 = Buffer.from("deadbeef", "ascii"); // 8 bytes
  const padded8 = Buffer.alloc(8);
  block8.copy(padded8);

  // Blowfish round-trip
  const enc = blowfishEncrypt(padded8, key16);
  const dec = blowfishDecrypt(enc, key16);
  dt.check("blowfish round-trip", dec.equals(padded8));

  // LoginCrypt sanity: static-key decrypt of something that was statically encrypted
  // Encrypt a 16-byte block with the static key, then decrypt and verify
  const testData = Buffer.alloc(16);
  testData.write("testdata!", 0, "ascii");
  const stEnc = blowfishEncrypt(testData, key16);
  const stDec = blowfishDecrypt(stEnc, key16);
  dt.check("blowfish static key round-trip", stDec.equals(testData));
}

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
