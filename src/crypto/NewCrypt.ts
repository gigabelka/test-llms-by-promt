
export const NewCrypt = {
  // XOR of every 4-byte LE word; written into the last 4 bytes before the trailing pad.
  appendChecksum(raw: Uint8Array): void {
    const size = raw.length;
    let chk = 0,
      i = 0;
    for (i = 0; i < size - 4; i += 4) {
      const w =
        raw[i] | (raw[i + 1] << 8) | (raw[i + 2] << 16) | (raw[i + 3] << 24);
      chk ^= w;
    }
    raw[i] = chk & 0xff;
    raw[i + 1] = (chk >>> 8) & 0xff;
    raw[i + 2] = (chk >>> 16) & 0xff;
    raw[i + 3] = (chk >>> 24) & 0xff;
  },

  // Reverse rolling-XOR pass used only when decrypting the Init packet.
  decXORPass(raw: Uint8Array, key: number): void {
    const size = raw.length;
    let pos = size - 12;
    let ecx = key;
    while (4 <= pos) {
      let edx =
        raw[pos] |
        (raw[pos + 1] << 8) |
        (raw[pos + 2] << 16) |
        (raw[pos + 3] << 24);
      edx ^= ecx;
      ecx -= edx;
      ecx = ecx & 0xffffffff;
      raw[pos] = edx & 0xff;
      raw[pos + 1] = (edx >>> 8) & 0xff;
      raw[pos + 2] = (edx >>> 16) & 0xff;
      raw[pos + 3] = (edx >>> 24) & 0xff;
      pos -= 4;
    }
  },
};
