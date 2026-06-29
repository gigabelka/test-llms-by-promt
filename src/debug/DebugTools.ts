import { blowfishEncrypt, blowfishDecrypt } from "../crypto/Blowfish";
import { GameCrypt } from "../game/GameCrypt";

let passedSelfTests = 0;
let failedSelfTests = 0;

export function check(name: string, cond: boolean): boolean {
  if (cond) {
    console.log(`[ok] ${name}`);
    passedSelfTests++;
  } else {
    console.log(`[FAIL] ${name}`);
    failedSelfTests++;
  }
  return cond;
}

export function selfTestCounts(): { passed: number; failed: number } {
  return { passed: passedSelfTests, failed: failedSelfTests };
}

export function logState(from: string, to: string): void {
  console.log(`[STATE] ${from} -> ${to}`);
}

export function assertState(actual: string, expected: string, ctx?: string): void {
  if (actual !== expected) {
    throw new Error(`State mismatch: expected ${expected}, got ${actual}${ctx ? ` (${ctx})` : ""}`);
  }
}

interface ReportArtifacts {
  [key: string]: string | number | boolean;
}

export function report(
  phase: number,
  statePath: string,
  artifacts: ReportArtifacts,
  notes?: string
): void {
  const counts = selfTestCounts();
  const status = counts.failed > 0 ? "FAIL" : "PASS";

  console.log(`=== PHASE ${phase} REPORT ===`);
  console.log(`status: ${status}`);
  console.log(`self-tests: ${counts.passed}/${counts.passed + counts.failed}`);
  console.log(`state-path: ${statePath}`);

  const artifactStr = Object.entries(artifacts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`artifacts: ${artifactStr}`);

  if (notes) {
    console.log(`notes: ${notes}`);
  }
  console.log("");
}

export function runLoginCryptoSelfTests(): void {
  passedSelfTests = 0;
  failedSelfTests = 0;

  const key = Buffer.from("0123456789abcdef");
  const block = Buffer.from("deadbeefdeadbeef");

  check(
    "blowfish round-trip",
    blowfishDecrypt(blowfishEncrypt(block, key), key).equals(block)
  );
}

export function runGameCryptoSelfTests(): void {
  // Reset counters for game crypto tests (they are separate from login crypto)
  passedSelfTests = 0;
  failedSelfTests = 0;

  const key8 = Buffer.from("testkey1");
  const msg = Buffer.from("Hello, Lineage 2!");

  const a = new GameCrypt();
  const b = new GameCrypt();
  a.init(key8, true);
  b.init(key8, true);

  check(
    "game-xor round-trip",
    b.decrypt(a.encrypt(msg)).equals(msg)
  );
}
