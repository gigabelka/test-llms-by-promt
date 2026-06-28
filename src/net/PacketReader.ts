export class PacketReader {
  constructor(
    private buffer: Buffer,
    private pos = 0,
  ) {}

  readUInt8(): number {
    return this.buffer[this.pos++]!;
  }

  readUInt16LE(): number {
    const v = this.buffer.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readInt16LE(): number {
    const v = this.buffer.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readInt32LE(): number {
    const v = this.buffer.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readInt64LE(): bigint {
    const v = this.buffer.readBigInt64LE(this.pos);
    this.pos += 8;
    return v;
  }

  readFloatLE(): number {
    const v = this.buffer.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  readDoubleLE(): number {
    const v = this.buffer.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }

  readBytes(n: number): Buffer {
    const slice = this.buffer.subarray(this.pos, this.pos + n);
    this.pos += n;
    return Buffer.from(slice);
  }

  readStringUTF16(): string {
    let end = this.pos;
    while (
      end + 1 < this.buffer.length &&
      !(this.buffer[end] === 0 && this.buffer[end + 1] === 0)
    ) {
      end += 2;
    }
    const bytes = this.buffer.subarray(this.pos, end);
    const str = bytes.toString("utf16le");
    this.pos = end + 2; // skip null terminator
    return str;
  }

  remaining(): number {
    return this.buffer.length - this.pos;
  }

  skip(n: number): this {
    this.pos += n;
    return this;
  }
}
