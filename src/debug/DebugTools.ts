import { blowfishDecrypt, blowfishEncrypt } from "../crypto/Blowfish";
import { GameCrypt } from "../game/GameCrypt";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { unscrambleModulus } from "../crypto/ScrambledRsaKey";

export interface CheckResult {
  name: string;
  passed: boolean;
}

const checks: CheckResult[] = [];

/**
 * Record a pass/fail check and print it immediately.
 * Returns the pass status so callers can chain on it.
 */
export function check(name: string, condition: boolean): boolean {
  checks.push({ name, passed: condition });
  console.log(`${condition ? "[PASS]" : "[FAIL]"} ${name}`);
  return condition;
}

export function getChecks(): readonly CheckResult[] {
  return checks;
}

export function resetChecks(): void {
  checks.length = 0;
}

export function passedCount(): number {
  return checks.filter((c) => c.passed).length;
}

export function totalCount(): number {
  return checks.length;
}

export interface ReportInput {
  phase: number | string;
  statePath: string;
  artifacts?: string;
  notes?: string;
}

/**
 * Print the standard phase report block used by every phase.
 */
export function report(input: ReportInput): void {
  const passed = passedCount();
  const total = totalCount();
  const status = passed === total && total > 0 ? "PASS" : "FAIL";
  console.log(`=== PHASE ${input.phase} REPORT ===`);
  console.log(`status: ${status}`);
  console.log(`self-tests: ${passed}/${total}`);
  console.log(`state-path: ${input.statePath}`);
  console.log(`artifacts: ${input.artifacts ?? "none"}`);
  console.log(`notes: ${input.notes ?? "-"}`);
}

export function logState(from: string, to: string): void {
  console.log(`[STATE] ${from} -> ${to}`);
}

export function assertState(actual: string, expected: string, ctx: string): void {
  if (actual !== expected) {
    throw new Error(`[ASSERT] ${ctx}: expected state ${expected}, got ${actual}`);
  }
}

export function runLoginCryptoSelfTests(): void {
  resetChecks();

  const key = Buffer.from("0123456789abcdef");
  const plain = Buffer.from("deadbeefdeadbeef");
  check(
    "blowfish round-trip",
    blowfishDecrypt(blowfishEncrypt(plain, key), key).equals(plain),
  );

  const lc = new LoginCrypt();
  lc.setSessionKey(Buffer.from("0123456789abcdef"));
  const body = Buffer.from([0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const encrypted = lc.encrypt(body);
  const decrypted = lc.decrypt(encrypted);
  check(
    "login crypt encrypt sanity",
    encrypted.length % 8 === 0 && decrypted.subarray(0, body.length).equals(body),
  );

  const testModulus = Buffer.alloc(128, 0xab);
  const unscrambled = unscrambleModulus(testModulus);
  check("modulus is 128 bytes", unscrambled.length === 128);
}

export function runGameCryptoSelfTests(): void {
  resetChecks();

  const key = Buffer.from("0123456789abcdef");
  const plain = Buffer.from("deadbeefdeadbeef");
  check(
    "blowfish round-trip",
    blowfishDecrypt(blowfishEncrypt(plain, key), key).equals(plain),
  );

  const alice = new GameCrypt();
  alice.init(Buffer.from("0011223344556677"), true);
  const bob = new GameCrypt();
  bob.init(Buffer.from("0011223344556677"), true);
  const msg = Buffer.from("HighFive game xor round-trip test");
  check("game-xor round-trip", bob.decrypt(alice.encrypt(msg)).equals(msg));

  const disabled = new GameCrypt();
  disabled.init(Buffer.from("0011223344556677"), false);
  const passthrough = Buffer.from("no encryption");
  check(
    "game-xor disabled pass-through",
    disabled.encrypt(passthrough).equals(passthrough) &&
      disabled.decrypt(passthrough).equals(passthrough),
  );

  const flagCrypt = new GameCrypt();
  let encryptionFlag = 0;
  flagCrypt.init(Buffer.from("0011223344556677"), encryptionFlag !== 0);
  check(
    "crypt flag honored",
    flagCrypt.isEnabled() === (encryptionFlag !== 0),
  );
  encryptionFlag = 1;
  flagCrypt.init(Buffer.from("0011223344556677"), encryptionFlag !== 0);
  check(
    "crypt flag honored",
    flagCrypt.isEnabled() === (encryptionFlag !== 0),
  );
}
