import { blowfishEncrypt, blowfishDecrypt } from "../crypto/Blowfish";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { GameCrypt } from "../game/GameCrypt";

let passed = 0;
let failed = 0;

export function check(name: string, cond: boolean): boolean {
  if (cond) {
    console.log(`[ok] ${name}`);
    passed++;
  } else {
    console.log(`[FAIL] ${name}`);
    failed++;
  }
  return cond;
}

export function selfTestCounts(): { passed: number; failed: number } {
  return { passed, failed };
}

export function logState(from: string, to: string): void {
  console.log(`[STATE] ${from} -> ${to}`);
}

export function assertState(actual: string, expected: string, ctx: string): void {
  if (actual !== expected) {
    throw new Error(`State assertion failed in ${ctx}: expected ${expected}, got ${actual}`);
  }
}

export function report(
  statePath: string[],
  artifacts: Record<string, string | number>,
  notes?: string,
): void {
  const total = passed + failed;
  const status = failed === 0 ? "PASS" : "FAIL";
  console.log("=== REPORT ===");
  console.log(`status: ${status}`);
  console.log(`self-tests: ${passed}/${total}`);
  console.log(`state-path: ${statePath.join(" -> ")}`);
  const artifactStr = Object.entries(artifacts)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  console.log(`artifacts: ${artifactStr}`);
  console.log(`notes: ${notes || ""}`);
}

export function runLoginCryptoSelfTests(): void {
  // Blowfish round-trip: 16-byte key, 8-byte block
  const key = Buffer.from("0123456789abcdef", "ascii");
  const block = Buffer.from("deadbeefdeadbeef", "ascii");
  check(
    "blowfish round-trip",
    blowfishDecrypt(blowfishEncrypt(block, key), key).equals(block),
  );

  // LoginCrypt round-trip: set session key, encrypt then decrypt, compare prefix
  const sessionKey = Buffer.from("0123456789abcdef", "ascii");
  const lc = new LoginCrypt();
  lc.setSessionKey(sessionKey);
  const body = Buffer.from("Hello, LoginCrypt!", "ascii");
  const encrypted = lc.encrypt(body);
  const decrypted = lc.decrypt(encrypted);
  check(
    "logincrypt round-trip",
    body.equals(decrypted.subarray(0, body.length)),
  );
}

export function runGameCryptoSelfTests(): void {
  // Two GameCrypt instances with the same 8-byte key, enabled=true
  const xorKey = Buffer.from("01234567", "ascii");
  const msg1 = Buffer.from("First packet payload data!", "ascii");
  const msg2 = Buffer.from("Second packet to test key shifting.", "ascii");

  const a = new GameCrypt();
  const b = new GameCrypt();
  a.init(xorKey, true);
  b.init(xorKey, true);

  // First packet
  const enc1 = a.encrypt(msg1);
  check("game-xor round-trip", b.decrypt(enc1).equals(msg1));

  // Second packet through the same instances
  const enc2 = a.encrypt(msg2);
  check("game-xor round-trip (2nd packet)", b.decrypt(enc2).equals(msg2));

  // Disabled passthrough
  const disabled = new GameCrypt();
  disabled.init(xorKey, false);
  const plainMsg = Buffer.from("plaintext", "ascii");
  check(
    "game-xor disabled passthrough",
    disabled.decrypt(plainMsg).equals(plainMsg) &&
      disabled.encrypt(plainMsg).equals(plainMsg),
  );
}
