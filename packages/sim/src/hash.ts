export function hashBytes(...buffers: Uint8Array[]): string {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (const buf of buffers) {
    for (const byte of buf) {
      h ^= byte;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}
