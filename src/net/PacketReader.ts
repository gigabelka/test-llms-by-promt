export class PacketReader {
  constructor(
    private readonly buffer: Buffer,
    private position = 0,
  ) {}

  readUInt8(): number {
    const v = this.buffer.readUInt8(this.position);
    this.position += 1;
    return v;
  }

  readUInt16LE(): number {
    const v = this.buffer.readUInt16LE(this.position);
    this.position += 2;
    return v;
  }

  readInt16LE(): number {
    const v = this.buffer.readInt16LE(this.position);
    this.position += 2;
    return v;
  }

  readInt32LE(): number {
    const v = this.buffer.readInt32LE(this.position);
    this.position += 4;
    return v;
  }

  readInt64LE(): bigint {
    const v = this.buffer.readBigInt64LE(this.position);
    this.position += 8;
    return v;
  }

  readFloatLE(): number {
    const v = this.buffer.readFloatLE(this.position);
    this.position += 4;
    return v;
  }

  readDoubleLE(): number {
    const v = this.buffer.readDoubleLE(this.position);
    this.position += 8;
    return v;
  }

  readBytes(n: number): Buffer {
    const v = Buffer.from(this.buffer.subarray(this.position, this.position + n));
    this.position += n;
    return v;
  }

  readStringUTF16(): string {
    const start = this.position;
    while (this.position + 1 < this.buffer.length) {
      if (
        this.buffer[this.position] === 0 &&
        this.buffer[this.position + 1] === 0
      ) {
        const str = this.buffer.toString("utf16le", start, this.position);
        this.position += 2;
        return str;
      }
      this.position += 2;
    }
    // No terminator found: consume the rest.
    const str = this.buffer.toString("utf16le", start, this.position);
    return str;
  }

  remaining(): number {
    return this.buffer.length - this.position;
  }

  skip(n: number): this {
    this.position += n;
    return this;
  }
}
