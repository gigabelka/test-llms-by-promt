import { blowfishEncrypt, blowfishDecrypt } from "../crypto/Blowfish";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { GameCrypt } from "../game/GameCrypt";

let passed = 0;
let failed = 0;
let firstFailure: string | undefined;

// Records one self-test result. Returns cond so callers can use it inline.
export function check(name: string, cond: unknown): boolean {
  if (cond) {
    passed++;
    console.log(`[ok] ${name}`);
  } else {
    failed++;
    if (firstFailure === undefined) firstFailure = name;
    console.log(`[FAIL] ${name}`);
  }
  return !!cond;
}

export function selfTestCounts(): { passed: number; failed: number } {
  return { passed, failed };
}

export function logState(from: string, to: string): void {
  console.log(`[STATE] ${from} -> ${to}`);
}

export function assertState(actual: string, expected: string, ctx: string): void {
  if (actual !== expected) {
    throw new Error(
      `assertState failed (${ctx}): expected ${expected}, got ${actual}`,
    );
  }
}

export function report(
  statePath: string[],
  artifacts: Record<string, unknown>,
  notes?: string,
): void {
  const { passed: p, failed: f } = selfTestCounts();
  console.log("=== REPORT ===");
  console.log(`status: ${f === 0 ? "PASS" : "FAIL"}`);
  console.log(`self-tests: ${p}/${p + f}`);
  console.log(`state-path: ${statePath.join(" -> ")}`);
  console.log(
    `artifacts: ${Object.entries(artifacts)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
  console.log(`notes: ${notes ?? firstFailure ?? "none"}`);
}

// Crypto self-tests — run ONCE at startup, before any socket I/O.
export function runLoginCryptoSelfTests(): boolean {
  const k = Buffer.from("0123456789abcdef");
  const x = Buffer.from("deadbeefdeadbeef");
  check(
    "blowfish round-trip",
    blowfishDecrypt(blowfishEncrypt(x, k), k).equals(x),
  );

  const crypt = new LoginCrypt();
  crypt.setSessionKey(k);
  const body = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
  const dec = crypt.decrypt(crypt.encrypt(body));
  // encrypt() appends pad + checksum, so compare only the leading bytes.
  check(
    "logincrypt round-trip",
    dec.subarray(0, body.length).equals(body),
  );
  return selfTestCounts().failed === 0;
}

export function runGameCryptoSelfTests(): boolean {
  const key = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
  const a = new GameCrypt();
  const b = new GameCrypt();
  a.init(key, true);
  b.init(key, true);

  const msg1 = Buffer.from("hello game world");
  check("game-xor round-trip", b.decrypt(a.encrypt(msg1)).equals(msg1));

  // Second message through the same pair: the shifting key must stay in sync.
  const msg2 = Buffer.from("second packet check!");
  check(
    "game-xor round-trip (2nd packet)",
    b.decrypt(a.encrypt(msg2)).equals(msg2),
  );

  const c = new GameCrypt();
  const d = new GameCrypt();
  c.init(key, false);
  d.init(key, false);
  const plain = Buffer.from("passthrough");
  check(
    "game-xor disabled passthrough",
    d.decrypt(c.encrypt(plain)).equals(plain) &&
      c.encrypt(plain) === plain &&
      d.decrypt(plain) === plain,
  );
  return selfTestCounts().failed === 0;
}
