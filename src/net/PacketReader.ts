export class PacketReader {
  private buf: Buffer;
  private pos: number;

  constructor(buffer: Buffer, initialPos: number = 0) {
    this.buf = buffer;
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

  readStringUTF16(): string {
    const start = this.pos;
    while (true) {
      if (this.pos + 2 > this.buf.length) {
        const raw = this.buf.subarray(start, this.pos);
        this.pos = this.buf.length;
        return raw.toString("utf16le");
      }
      if (this.buf.readUInt16LE(this.pos) === 0x0000) {
        const raw = this.buf.subarray(start, this.pos);
        this.pos += 2; // skip null terminator
        return raw.toString("utf16le");
      }
      this.pos += 2;
    }
  }

  remaining(): number {
    return this.buf.length - this.pos;
  }

  skip(n: number): this {
    this.pos += n;
    return this;
  }
}
