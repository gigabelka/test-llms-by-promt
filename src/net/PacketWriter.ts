/**
 * PacketWriter class with an internal Buffer[] array for building packets.
 */
export class PacketWriter {
  private chunks: Buffer[] = [];

  writeUInt8(val: number): this {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(val, 0);
    this.chunks.push(buf);
    return this;
  }

  writeUInt16LE(val: number): this {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(val, 0);
    this.chunks.push(buf);
    return this;
  }

  writeInt16LE(val: number): this {
    const buf = Buffer.alloc(2);
    buf.writeInt16LE(val, 0);
    this.chunks.push(buf);
    return this;
  }

  writeInt32LE(val: number): this {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(val, 0);
    this.chunks.push(buf);
    return this;
  }

  writeInt64LE(val: bigint | number): this {
    let n: number;
    if (typeof val === 'bigint') {
      n = Number(val & 0xffffffffn); // Just write the low 32 bits for now, or handle properly
    } else {
      n = Math.floor(val as number);
    }
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(BigInt(n), 0);
    this.chunks.push(buf);
    return this;
  }

  writeBytes(b: Buffer | Uint8Array): this {
    this.chunks.push(Buffer.from(b));
    return this;
  }

  writeStringNullUTF16(s: string): this {
    const strBuf = Buffer.alloc(s.length * 2 + 2, 0);
    strBuf.write(s, 0, s.length * 2 + 2, 'utf16le');
    // Ensure null terminator (two 0x00 bytes) - already initialized with zeros
    this.chunks.push(strBuf);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
