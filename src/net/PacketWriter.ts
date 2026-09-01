// Binary writer, little-endian, per PLANE.md `### src/net/PacketWriter.ts`.
export class PacketWriter {
  private chunks: Buffer[] = [];

  writeUInt8(v: number): this {
    const b = Buffer.alloc(1);
    b.writeUInt8(v & 0xff);
    this.chunks.push(b);
    return this;
  }

  writeUInt16LE(v: number): this {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v & 0xffff, 0);
    this.chunks.push(b);
    return this;
  }

  writeInt32LE(v: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v | 0, 0);
    this.chunks.push(b);
    return this;
  }

  writeInt64LE(v: number): this {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(v), 0);
    this.chunks.push(b);
    return this;
  }

  writeBytes(b: Buffer): this {
    this.chunks.push(Buffer.from(b));
    return this;
  }

  // Writes the UTF-16LE encoding of s plus the 2 zero-byte terminator.
  writeStringNullUTF16(s: string): this {
    this.chunks.push(Buffer.from(s, "utf16le"));
    this.chunks.push(Buffer.alloc(2, 0));
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
