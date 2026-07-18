import { createPublicKey, publicEncrypt, constants } from "node:crypto";

// Plaintext is exactly 128 bytes: login at offset 0x5E (14 bytes), password at 0x6E (16 bytes).
function buildPlaintext(login: string, password: string): Buffer {
  const p = Buffer.alloc(128, 0);
  Buffer.from(login.slice(0, 14), "ascii").copy(p, 0x5e);
  Buffer.from(password.slice(0, 16), "ascii").copy(p, 0x6e);
  return p;
}

function derLen(len: number): number[] {
  if (len < 128) return [len];
  if (len < 256) return [0x81, len];
  return [0x82, (len >> 8) & 0xff, len & 0xff];
}

// Build a PKCS#1 DER public key from a raw modulus + exponent 65537.
function buildDer(modulus: Buffer): Buffer {
  const e = Buffer.from([0x01, 0x00, 0x01]); // 65537
  const m =
    modulus[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), modulus]) : modulus;
  const mInt = Buffer.concat([Buffer.from([0x02, ...derLen(m.length)]), m]);
  const eInt = Buffer.concat([Buffer.from([0x02, ...derLen(e.length)]), e]);
  const inner = Buffer.concat([mInt, eInt]);
  return Buffer.concat([Buffer.from([0x30, ...derLen(inner.length)]), inner]);
}

export function encryptCredentials(
  login: string,
  password: string,
  modulus: Buffer,
): Buffer {
  const der = buildDer(modulus);
  const key = createPublicKey({ key: der, format: "der", type: "pkcs1" });
  return Buffer.from(
    publicEncrypt(
      { key, padding: constants.RSA_NO_PADDING },
      buildPlaintext(login, password),
    ),
  );
}
