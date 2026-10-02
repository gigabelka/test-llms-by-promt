// Little-endian binary reader over a Buffer. Advances an internal position as it reads.
export class PacketReader {
  private buf: Buffer;
  private pos: number;

  constructor(buf: Buffer, pos = 0) {
    this.buf = buf;
    this.pos = pos;
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

  // Returns a COPY of the next n bytes.
  readBytes(n: number): Buffer {
    const out = Buffer.from(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return out;
  }

  // UTF-16LE up to (and consuming) the two-byte 0x0000 terminator.
  readStringUTF16(): string {
    let end = this.pos;
    while (end + 1 < this.buf.length && !(this.buf[end] === 0 && this.buf[end + 1] === 0)) {
      end += 2;
    }
    const s = this.buf.toString("utf16le", this.pos, end);
    this.pos = end + 2;
    return s;
  }

  remaining(): number {
    return this.buf.length - this.pos;
  }

  skip(n: number): this {
    this.pos += n;
    return this;
  }
}
