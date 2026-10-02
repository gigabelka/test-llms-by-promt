import { blowfishEncrypt, blowfishDecrypt } from "./Blowfish.ts";
import { LoginCrypt } from "./LoginCrypt.ts";
import { GameCrypt } from "./GameCrypt.ts";
import { check } from "../debug/DebugTools.ts";

// Two kinds of assertion live here:
//   * round-trip  — decrypt(encrypt(x)) === x. Stays GREEN under any symmetric mistake.
//   * KAT         — a known-answer vector produced by the reference implementation.
// A red KAT means the module it exercises was not copied verbatim. Re-copy it from this
// prompt; never "fix" a KAT by editing the expected hex.

export function runLoginCryptoSelfTests(): void {
  const key = Buffer.from("0123456789abcdef", "ascii"); // 16 bytes
  const block = Buffer.from("deadbeefdeadbeef", "ascii"); // 16 bytes = two ECB blocks
  const bf = blowfishEncrypt(block, key);
  check("blowfish round-trip", blowfishDecrypt(bf, key).equals(block));
  check("blowfish KAT", bf.toString("hex") === "c098ec6e4364c276c098ec6e4364c276");

  const lc = new LoginCrypt();
  lc.setSessionKey(key);
  const body = Buffer.from([0x07, 0x01, 0x02, 0x03, 0x04, 0x05]);
  const enc = lc.encrypt(body);
  const restored = lc.decrypt(enc);
  check("logincrypt round-trip", restored.subarray(0, body.length).equals(body));
  check("logincrypt KAT", enc.toString("hex") === "98aaaa188a3f0106b6f859365480d8bd");

  // decryptInit over a deterministic body: raw[i] = (i * 7 + 3) & 0xff, 184 bytes.
  // Not a real Init packet — it pins static-key Blowfish + decXORPass + the 8-byte drop.
  const initBody = Buffer.alloc(184);
  for (let i = 0; i < initBody.length; i++) initBody[i] = (i * 7 + 3) & 0xff;
  const init = new LoginCrypt().decryptInit(initBody);
  check(
    "decryptinit KAT",
    init.length === 176 &&
      init.subarray(0, 16).toString("hex") === "937c56202ef327c88bd224462069e0d9",
  );
}

export function runGameCryptoSelfTests(): void {
  const xorKey = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]); // 8-byte key from CryptInit

  const a = new GameCrypt();
  const b = new GameCrypt();
  a.init(xorKey, true);
  b.init(xorKey, true);
  const m1 = Buffer.from([0x2b, 0x10, 0x20, 0x30, 0x40, 0x50]);
  const c1 = a.encrypt(Buffer.from(m1));
  check("game-xor KAT", c1.toString("hex") === "2a381b2f6a3c");
  check("game-xor round-trip", b.decrypt(c1).equals(m1));
  const m2 = Buffer.from([0x11, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
  const c2 = a.encrypt(Buffer.from(m2));
  // The key shifts by the size of every processed packet: the 2nd vector differs from the 1st.
  check("game-xor KAT (2nd packet)", c2.toString("hex") === "1013121514171619");
  check("game-xor round-trip (2nd packet)", b.decrypt(c2).equals(m2));

  // A 20-byte packet is the only vector that exercises all 16 key bytes, the static tail
  // included: for a body shorter than 9 bytes, key[8..15] is never reached.
  const d = new GameCrypt();
  const e = new GameCrypt();
  d.init(xorKey, true);
  e.init(xorKey, true);
  const m3 = Buffer.alloc(20);
  for (let i = 0; i < m3.length; i++) m3[i] = (i * 3 + 1) & 0xff;
  const c3 = d.encrypt(Buffer.from(m3));
  check(
    "game-xor KAT (static tail)",
    c3.toString("hex") === "0006020c04120618c9f27e5dd99d873e0e380c32",
  );
  check("game-xor round-trip (static tail)", e.decrypt(c3).equals(m3));

  const c = new GameCrypt();
  c.init(xorKey, false);
  const plain = Buffer.from([0xaa, 0xbb, 0xcc]);
  check("game-xor disabled passthrough", c.encrypt(Buffer.from(plain)).equals(plain));
}
