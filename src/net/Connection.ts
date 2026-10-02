import { Socket } from "node:net";

export class Connection {
  private socket = new Socket();
  private recv = Buffer.alloc(0);
  onPacket: (packet: Buffer) => void = () => {}; // full frame INCLUDING 2-byte size
  onConnect: () => void = () => {};
  onClose: () => void = () => {};
  connect(host: string, port: number): void {
    this.socket.connect(port, host, () => this.onConnect());
    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("close", () => this.onClose());
    this.socket.on("error", (e) => console.error("TCP error", e));
  }
  /** Send a body (opcode + payload, WITHOUT size). This prepends the 2-byte LE length. */
  send(body: Buffer): void {
    const size = body.length + 2;
    const frame = Buffer.alloc(size);
    frame.writeUInt16LE(size, 0);
    body.copy(frame, 2);
    this.socket.write(frame);
  }
  private handleData(chunk: Buffer): void {
    this.recv = Buffer.concat([this.recv, chunk]);
    while (this.recv.length >= 2) {
      const len = this.recv.readUInt16LE(0);
      if (len < 2 || this.recv.length < len) break; // wait for more bytes
      const frame = this.recv.subarray(0, len);
      this.recv = this.recv.subarray(len);
      this.onPacket(Buffer.from(frame));
    }
  }
  close(): void {
    this.socket.destroy();
  }
}
