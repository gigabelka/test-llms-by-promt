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

  writeBytes(b: Buffer | Uint8Array | number[]): this {
    this.chunks.push(Buffer.from(b));
    return this;
  }

  writeStringNullUTF16(s: string): this {
    const buf = Buffer.from(s, "utf16le");
    this.chunks.push(buf);
    this.chunks.push(Buffer.alloc(2)); // null terminator
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
