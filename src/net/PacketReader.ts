// Binary packet reader — all integers little-endian.
export class PacketReader {
  private buf: Buffer;
  private pos: number;

  constructor(buf: Buffer, initialPos = 0) {
    this.buf = buf;
    this.pos = initialPos;
  }

  readUInt8(): number {
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readUInt16LE(): number {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readInt16LE(): number {
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readInt32LE(): number {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readInt64LE(): bigint {
    // Read as two 32-bit LE halves, then combine.
    const lo = this.buf.readUInt32LE(this.pos);
    const hi = this.buf.readUInt32LE(this.pos + 4);
    this.pos += 8;
    return (BigInt(hi) << 32n) | BigInt(lo);
  }

  readFloatLE(): number {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  readDoubleLE(): number {
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }

  /** Returns a copy of the subarray. */
  readBytes(n: number): Buffer {
    const out = Buffer.from(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return out;
  }

  /** Read UTF-16LE string until two zero bytes (null terminator). Advances past terminator. */
  readStringUTF16(): string {
    const start = this.pos;
    while (true) {
      if (this.pos + 2 > this.buf.length) break;
      if (this.buf.readUInt16LE(this.pos) === 0) break;
      this.pos += 2;
    }
    const str = this.buf.toString("utf16le", start, this.pos);
    this.pos += 2; // skip the two zero bytes
    return str;
  }

  remaining(): number {
    return this.buf.length - this.pos;
  }

  skip(n: number): this {
    this.pos += n;
    return this;
  }
}
