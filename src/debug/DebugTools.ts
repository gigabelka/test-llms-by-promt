import { blowfishDecrypt, blowfishEncrypt } from "../crypto/Blowfish";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { GameCrypt } from "../game/GameCrypt";

let passed = 0;
let failed = 0;

export function check(name: string, cond: unknown): boolean {
  if (cond) {
    console.log(`[ok] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}`);
    failed++;
  }
  return Boolean(cond);
}

export function selfTestCounts(): { passed: number; failed: number } {
  return { passed, failed };
}

export function logState(from: string, to: string): void {
  console.log(`[STATE] ${from} -> ${to}`);
}

export function assertState(
  actual: string,
  expected: string,
  ctx?: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `State mismatch: expected ${expected}, got ${actual}${ctx ? ` (${ctx})` : ""}`,
    );
  }
}

export function report(
  statePath: string[],
  artifacts: Record<string, unknown>,
  notes?: string,
): void {
  const counts = selfTestCounts();
  const total = counts.passed + counts.failed;
  const status = counts.failed === 0 ? "PASS" : "FAIL";
  console.log("=== REPORT ===");
  console.log(`status: ${status}`);
  console.log(`self-tests: ${counts.passed}/${total}`);
  console.log(`state-path: ${statePath.join(" -> ")}`);
  console.log(
    `artifacts: ${Object.entries(artifacts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
  );
  console.log(`notes: ${notes ?? ""}`);
}

export function runLoginCryptoSelfTests(): void {
  const k = Buffer.from("0123456789abcdef");
  const x = Buffer.from("deadbeefdeadbeef");
  check("blowfish round-trip", blowfishDecrypt(blowfishEncrypt(x, k), k).equals(x));

  const lc = new LoginCrypt();
  const sessionKey = Buffer.from("blowfishSessKey12", "ascii").subarray(0, 16);
  lc.setSessionKey(sessionKey);
  const body = Buffer.from([0x00, 0x05, 0x01, 0x02, 0x03]);
  const enc = lc.encrypt(body);
  const dec = lc.decrypt(enc);
  check(
    "logincrypt round-trip",
    dec.subarray(0, body.length).equals(body),
  );
}

export function runGameCryptoSelfTests(): void {
  const key = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
  const a = new GameCrypt();
  const b = new GameCrypt();
  a.init(key, true);
  b.init(key, true);

  const msg1 = Buffer.from("Hello Lineage 2!");
  check("game-xor round-trip", b.decrypt(a.encrypt(msg1)).equals(msg1));

  const msg2 = Buffer.from("second packet!!");
  check("game-xor round-trip (2nd packet)", b.decrypt(a.encrypt(msg2)).equals(msg2));

  const c = new GameCrypt();
  c.init(key, false);
  const plain = Buffer.from("passthrough data");
  check(
    "game-xor disabled passthrough",
    c.encrypt(plain).equals(plain) && c.decrypt(plain).equals(plain),
  );
}
