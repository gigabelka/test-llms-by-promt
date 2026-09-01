// Binary reader over a Buffer, little-endian, per PLANE.md `### src/net/PacketReader.ts`.
export class PacketReader {
  private buf: Buffer;
  private pos: number;

  constructor(buffer: Buffer, initialPos = 0) {
    this.buf = buffer;
    this.pos = initialPos;
  }

  private ensure(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new Error(
        `PacketReader: need ${n} bytes at offset ${this.pos}, only ${this.buf.length - this.pos} left`,
      );
    }
  }

  readUInt8(): number {
    this.ensure(1);
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readUInt16LE(): number {
    this.ensure(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readInt16LE(): number {
    this.ensure(2);
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  readInt32LE(): number {
    this.ensure(4);
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readInt64LE(): number {
    this.ensure(8);
    const v = this.buf.readBigInt64LE(this.pos);
    this.pos += 8;
    return Number(v);
  }

  readFloatLE(): number {
    this.ensure(4);
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  readDoubleLE(): number {
    this.ensure(8);
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }

  // Returns a COPY of the next n bytes and advances the position.
  readBytes(n: number): Buffer {
    this.ensure(n);
    const out = Buffer.from(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return out;
  }

  // Reads a UTF-16LE string up to (and including) the two zero-byte terminator.
  readStringUTF16(): string {
    let end = this.pos;
    while (end + 1 < this.buf.length) {
      if (this.buf[end] === 0x00 && this.buf[end + 1] === 0x00) break;
      end += 2;
    }
    if (end + 2 > this.buf.length) {
      throw new Error("PacketReader: unterminated UTF-16 string");
    }
    const s = this.buf.toString("utf16le", this.pos, end);
    this.pos = end + 2; // advance past the terminator
    return s;
  }

  remaining(): number {
    return this.buf.length - this.pos;
  }

  skip(n: number): this {
    this.ensure(n);
    this.pos += n;
    return this;
  }
}
