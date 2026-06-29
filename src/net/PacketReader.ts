/**
 * PacketReader class that takes a Buffer and an initial position.
 */
export class PacketReader {
  private pos: number;

  constructor(private readonly buffer: Buffer) {
    this.pos = 0;
  }

  readUInt8(): number {
    const val = this.buffer.readUInt8(this.pos);
    this.pos += 1;
    return val;
  }

  readUInt16LE(): number {
    const val = this.buffer.readUInt16LE(this.pos);
    this.pos += 2;
    return val;
  }

  readInt16LE(): number {
    const val = this.buffer.readInt16LE(this.pos);
    this.pos += 2;
    return val;
  }

  readInt32LE(): number {
    const val = this.buffer.readInt32LE(this.pos);
    this.pos += 4;
    return val;
  }

  readInt64LE(): bigint {
    // Read as two 32-bit integers and combine
    const high = this.buffer.readInt32LE(this.pos);
    const low = this.buffer.readUInt32LE(this.pos + 4);
    this.pos += 8;
    return BigInt(high) << 32n | BigInt(low >>> 0);
  }

  readFloatLE(): number {
    const val = this.buffer.readFloatLE(this.pos);
    this.pos += 4;
    return val;
  }

  readDoubleLE(): number {
    const val = this.buffer.readDoubleLE(this.pos);
    this.pos += 8;
    return val;
  }

  readBytes(n: number): Buffer {
    const bytes = Buffer.from(this.buffer.subarray(this.pos, this.pos + n));
    this.pos += n;
    return bytes;
  }

  readStringUTF16(): string {
    // Read UTF-16LE until two zero bytes (4 zeros in bytes)
    let endPos = this.pos;
    while (endPos + 1 < this.buffer.length) {
      if (this.buffer[endPos] === 0 && this.buffer[endPos + 1] === 0) {
        break;
      }
      endPos += 2;
    }
    // Include the terminator in the read length for position advancement
    const str = this.buffer.toString('utf16le', this.pos, endPos + 2);
    this.pos = endPos + 2;
    return str;
  }

  remaining(): number {
    return this.buffer.length - this.pos;
  }

  skip(n: number): PacketReader {
    this.pos += n;
    return this;
  }
}
