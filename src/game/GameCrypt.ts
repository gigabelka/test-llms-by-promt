// HighFive game-server 16-byte shifting XOR cipher. Key = 8-byte XOR key from CryptInit +
// fixed static tail. Enabled only when the CryptInit flag is non-zero; see HARD CONSTRAINTS #7.
const STATIC_TAIL = Buffer.from([
  0xc8, 0x27, 0x93, 0x01, 0xa1, 0x6c, 0x31, 0x97,
]);

export class GameCrypt {
  private keyIn = Buffer.alloc(16); // server -> client
  private keyOut = Buffer.alloc(16); // client -> server
  private enabled = false;

  init(xorKey: Buffer, enable: boolean): void {
    const full = Buffer.alloc(16);
    xorKey.subarray(0, 8).copy(full, 0);
    STATIC_TAIL.copy(full, 8);
    this.keyIn = Buffer.from(full);
    this.keyOut = Buffer.from(full);
    this.enabled = enable;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  decrypt(data: Buffer): Buffer {
    if (!this.enabled) return data;
    const out = Buffer.from(data);
    const size = out.length;
    let xor = 0;
    for (let i = 0; i < size; i++) {
      const enc = out[i]! & 0xff;
      out[i] = (enc ^ (this.keyIn[i & 15]! & 0xff) ^ xor) & 0xff;
      xor = enc;
    }
    this.shift(this.keyIn, size);
    return out;
  }

  encrypt(data: Buffer): Buffer {
    if (!this.enabled) return data;
    const out = Buffer.from(data);
    const size = out.length;
    let enc = 0;
    for (let i = 0; i < size; i++) {
      enc = (((out[i]! & 0xff) ^ (this.keyOut[i & 15]! & 0xff) ^ enc) & 0xff);
      out[i] = enc;
    }
    this.shift(this.keyOut, size);
    return out;
  }

  // Advance bytes 8..11 of the key (little-endian uint32) by the packet size.
  private shift(key: Buffer, size: number): void {
    let v = (key[8]! & 0xff) |
      ((key[9]! & 0xff) << 8) |
      ((key[10]! & 0xff) << 16) |
      ((key[11]! & 0xff) << 24);
    v = (v + size) >>> 0;
    key[8] = v & 0xff;
    key[9] = (v >>> 8) & 0xff;
    key[10] = (v >>> 16) & 0xff;
    key[11] = (v >>> 24) & 0xff;
  }
}
