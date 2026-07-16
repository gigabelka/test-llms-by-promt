export class PacketWriter {
  private chunks: Buffer[] = [];

  writeUInt8(value: number): this {
    const b = Buffer.alloc(1);
    b.writeUInt8(value, 0);
    this.chunks.push(b);
    return this;
  }

  writeUInt16LE(value: number): this {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value, 0);
    this.chunks.push(b);
    return this;
  }

  writeInt32LE(value: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32LE(value, 0);
    this.chunks.push(b);
    return this;
  }

  writeInt64LE(value: number | bigint): this {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(value), 0);
    this.chunks.push(b);
    return this;
  }

  writeBytes(value: Buffer | Uint8Array): this {
    this.chunks.push(Buffer.from(value));
    return this;
  }

  writeStringNullUTF16(value: string): this {
    const b = Buffer.from(value, "utf16le");
    this.chunks.push(b);
    this.chunks.push(Buffer.alloc(2)); // null terminator
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
