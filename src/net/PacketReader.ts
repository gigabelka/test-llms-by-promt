export class PacketReader {
  private buf: Buffer;
  private pos: number;

  constructor(buf: Buffer, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  readUInt8(): number {
    return this.buf.readUInt8(this.pos++);
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
    const end = this.pos + n;
    const copy = Buffer.from(this.buf.subarray(this.pos, end));
    this.pos = end;
    return copy;
  }

  readStringUTF16(): string {
    const start = this.pos;
    while (
      this.pos + 1 < this.buf.length &&
      !(this.buf[this.pos] === 0 && this.buf[this.pos + 1] === 0)
    ) {
      this.pos += 2;
    }
    const str = this.buf.toString("utf16le", start, this.pos);
    // Skip the two-byte null terminator if it exists.
    if (this.pos + 1 < this.buf.length) {
      this.pos += 2;
    } else {
      this.pos = this.buf.length;
    }
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
