import { blowfishEncrypt, blowfishDecrypt } from "../crypto/Blowfish";
import { LoginCrypt } from "../crypto/LoginCrypt";
import { GameCrypt } from "../game/GameCrypt";

let passed = 0;
let failed = 0;

export function check(name: string, cond: boolean): boolean {
  if (cond) {
    passed++;
    console.log(`[ok] ${name}`);
  } else {
    failed++;
    console.log(`[FAIL] ${name}`);
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
    throw new Error(`assertState: expected "${expected}", got "${actual}" (${ctx})`);
  }
}

export function report(
  statePath: string[],
  artifacts: Record<string, string>,
  notes?: string,
): void {
  const counts = selfTestCounts();
  const total = counts.passed + counts.failed;
  const status = counts.failed === 0 && !notes ? "PASS" : "FAIL";
  const art = Object.entries(artifacts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log("");
  console.log("=== REPORT ===");
  console.log(`status: ${status}`);
  console.log(`self-tests: ${counts.passed}/${total}`);
  console.log(`state-path: ${statePath.join(" -> ")}`);
  console.log(`artifacts: ${art}`);
  console.log(`notes: ${notes ?? ""}`);
}

export function runLoginCryptoSelfTests(): void {
  const key = Buffer.from("0123456789abcdef", "ascii"); // 16 bytes
  const block = Buffer.from("deadbeefdeadbeef", "hex"); // 8 bytes
  check("blowfish round-trip", blowfishDecrypt(blowfishEncrypt(block, key), key).equals(block));

  const lc = new LoginCrypt();
  lc.setSessionKey(key);
  const body = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
  const round = lc.decrypt(lc.encrypt(body));
  check(
    "logincrypt round-trip",
    round.length >= body.length && round.subarray(0, body.length).equals(body),
  );
}

export function runGameCryptoSelfTests(): void {
  const xorKey = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]); // 8 bytes
  const a = new GameCrypt();
  const b = new GameCrypt();
  a.init(xorKey, true);
  b.init(xorKey, true);

  const msg1 = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde]);
  check("game-xor round-trip", b.decrypt(a.encrypt(msg1)).equals(msg1));

  const msg2 = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]);
  check("game-xor round-trip (2nd packet)", b.decrypt(a.encrypt(msg2)).equals(msg2));

  const offA = new GameCrypt();
  const offB = new GameCrypt();
  offA.init(xorKey, false);
  offB.init(xorKey, false);
  const plain = Buffer.from([0xff, 0x00, 0x55, 0xaa]);
  check("game-xor disabled passthrough", offB.decrypt(offA.encrypt(plain)).equals(plain));
}
