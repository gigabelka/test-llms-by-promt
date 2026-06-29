import { blowfishEncrypt, blowfishDecrypt } from "./Blowfish";
import { NewCrypt } from "./NewCrypt";

const STATIC_KEY = Buffer.from([
  0x6b, 0x60, 0xcb, 0x5b, 0x82, 0xce, 0x90, 0xb1, 0xcc, 0x2b, 0x6c, 0x55, 0x6c,
  0x6c, 0x6c, 0x6c,
]);

export class LoginCrypt {
  private key: Buffer = STATIC_KEY;
  private hasSession = false;
  setSessionKey(blowfishKey: Buffer): void {
    this.key = blowfishKey;
    this.hasSession = true;
  }
  // Init packet: static-key Blowfish decrypt -> reverse rolling XOR -> drop trailing 8 bytes.
  decryptInit(body: Buffer): Buffer {
    const raw = new Uint8Array(blowfishDecrypt(body, STATIC_KEY));
    const size = raw.length;
    const xor =
      raw[size - 8] |
      (raw[size - 7] << 8) |
      (raw[size - 6] << 16) |
      (raw[size - 5] << 24);
    NewCrypt.decXORPass(raw, xor);
    return Buffer.from(raw).subarray(0, size - 8);
  }
  // All packets after Init.
  decrypt(body: Buffer): Buffer {
    if (!this.hasSession) return body;
    return blowfishDecrypt(body, this.key);
  }
  // Outgoing after session key set: pad to 4, add 8 zero bytes, pad to 8, checksum, encrypt.
  encrypt(body: Buffer): Buffer {
    if (!this.hasSession) return body;
    let buf = Buffer.from(body);
    if (buf.length % 4 !== 0)
      buf = Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]);
    buf = Buffer.concat([buf, Buffer.alloc(8)]);
    if (buf.length % 8 !== 0)
      buf = Buffer.concat([buf, Buffer.alloc(8 - (buf.length % 8))]);
    const raw = new Uint8Array(buf);
    NewCrypt.appendChecksum(raw);
    return blowfishEncrypt(Buffer.from(raw), this.key);
  }
}
