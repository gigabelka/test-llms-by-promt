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
    buf.writeBigInt64LE(v, 0);
    this.chunks.push(buf);
    return this;
  }

  writeBytes(b: Buffer | Uint8Array): this {
    this.chunks.push(Buffer.from(b));
    return this;
  }

  writeStringNullUTF16(s: string): this {
    const strBuf = Buffer.from(s, "utf16le");
    const term = Buffer.alloc(2, 0);
    this.chunks.push(strBuf, term);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
