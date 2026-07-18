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

  writeInt64LE(v: bigint): this {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(v, 0);
    this.chunks.push(b);
    return this;
  }

  writeBytes(b: Buffer): this {
    this.chunks.push(Buffer.from(b));
    return this;
  }

  // Writes the string as UTF-16LE followed by two zero bytes.
  writeStringNullUTF16(s: string): this {
    const b = Buffer.from(s, "utf16le");
    this.chunks.push(b, Buffer.alloc(2));
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
