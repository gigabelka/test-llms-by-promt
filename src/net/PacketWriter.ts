// Little-endian binary writer. Accumulates chunks; toBuffer() concatenates them.
// Every mutator returns `this` for chaining.
export class PacketWriter {
  private chunks: Buffer[] = [];

  writeUInt8(v: number): this {
    const b = Buffer.alloc(1);
    b.writeUInt8(v & 0xff, 0);
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

  writeInt64LE(v: bigint): this {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(v, 0);
    this.chunks.push(b);
    return this;
  }

  writeBytes(b: Buffer | Uint8Array): this {
    this.chunks.push(Buffer.from(b));
    return this;
  }

  writeStringNullUTF16(s: string): this {
    this.chunks.push(Buffer.from(s, "utf16le"));
    this.chunks.push(Buffer.from([0x00, 0x00]));
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
