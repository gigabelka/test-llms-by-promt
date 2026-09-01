
// The server scrambles the modulus; unscramble in this exact order before using it for RSA.
export function unscrambleModulus(scrambled: Buffer): Buffer {
  if (scrambled.length !== 128)
    throw new Error(`RSA modulus must be 128 bytes, got ${scrambled.length}`);
  const n = Buffer.from(scrambled);
  for (let i = 0; i < 0x40; i++) n[0x40 + i] ^= n[i]; // C^-1
  for (let i = 0; i < 4; i++) n[0x0d + i] ^= n[0x34 + i]; // B^-1
  for (let i = 0; i < 0x40; i++) n[i] ^= n[0x40 + i]; // A^-1
  for (let i = 0; i < 4; i++) {
    const t = n[i];
    n[i] = n[0x4d + i];
    n[0x4d + i] = t;
  } // D^-1 swap
  return n;
}
