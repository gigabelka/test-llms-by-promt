export class PacketWriter {
  private chunks: Buffer[] = [];

  writeUInt8(v: number): this {
    const b = Buffer.alloc(1);
    b.writeUInt8(v, 0);
    this.chunks.push(b);
    return this;
  }

  writeUInt16LE(v: number): this {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v, 0);
    this.chunks.push(b);
    return this;
  }

  writeInt32LE(v: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v, 0);
    this.chunks.push(b);
    return this;
  }

  writeInt64LE(v: number | bigint): this {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(v), 0);
    this.chunks.push(b);
    return this;
  }

  writeBytes(buf: Uint8Array): this {
    this.chunks.push(Buffer.from(buf));
    return this;
  }

  writeStringNullUTF16(s: string): this {
    this.chunks.push(Buffer.from(s, "utf16le"));
    this.chunks.push(Buffer.alloc(2));
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
