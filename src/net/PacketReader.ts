export class PacketReader {
  constructor(
    private buf: Buffer,
    private pos: number = 0,
  ) {}

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
    const v = this.buf.readBigInt64LE(this.pos);
    this.pos += 8;
    return v;
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

  readBytes(n: number): Buffer {
    const v = Buffer.from(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return v;
  }

  // Reads a UTF-16LE string until two zero bytes; advances past the terminator.
  readStringUTF16(): string {
    const bytes: number[] = [];
    while (this.pos + 1 < this.buf.length) {
      const lo = this.buf[this.pos]!;
      const hi = this.buf[this.pos + 1]!;
      this.pos += 2;
      if (lo === 0 && hi === 0) break;
      bytes.push(lo, hi);
    }
    return Buffer.from(bytes).toString("utf16le");
  }

  remaining(): number {
    return this.buf.length - this.pos;
  }

  skip(n: number): this {
    this.pos += n;
    return this;
  }
}
