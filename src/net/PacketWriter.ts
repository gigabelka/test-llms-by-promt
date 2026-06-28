// Binary packet writer — all integers little-endian. Chaining API.
export class PacketWriter {
  private chunks: Buffer[] = [];

  writeUInt8(v: number): this {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(v, 0);
    this.chunks.push(buf);
    return this;
  }

  writeUInt16LE(v: number): this {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(v, 0);
    this.chunks.push(buf);
    return this;
  }

  writeInt32LE(v: number): this {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(v, 0);
    this.chunks.push(buf);
    return this;
  }

  writeInt64LE(v: bigint): this {
    const buf = Buffer.alloc(8);
    const lo = Number(v & 0xffffffffn);
    const hi = Number((v >> 32n) & 0xffffffffn);
    buf.writeUInt32LE(lo, 0);
    buf.writeUInt32LE(hi, 4);
    this.chunks.push(buf);
    return this;
  }

  /** Push raw bytes (makes a copy). */
  writeBytes(b: Buffer): this {
    this.chunks.push(Buffer.from(b));
    return this;
  }

  /** Write a UTF-16LE string + 2 zero bytes terminator. */
  writeStringNullUTF16(s: string): this {
    const strBuf = Buffer.from(s, "utf16le");
    const term = Buffer.alloc(2, 0);
    this.chunks.push(strBuf);
    this.chunks.push(term);
    return this;
  }

  /** Concatenate and return the full buffer. */
  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
