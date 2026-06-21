// ── Shared base64 codec for WorldSnapshot.rapierBytesB64 ──────────────────────
//
// Single home for the Rapier-snapshot byte <-> base64 conversion used by the
// server (encode) and client (decode). On the server (Bun/Node) the native
// Buffer path is a single call instead of a per-byte String.fromCharCode loop;
// the browser falls back to atob/btoa from the DOM lib. This package targets
// DOM libs only (no @types/node), so Buffer is reached via a typed globalThis
// probe rather than a hard dependency.

type BufferLike = {
  from(data: Uint8Array): { toString(encoding: "base64"): string };
  from(data: string, encoding: "base64"): Uint8Array;
};

const nodeBuffer: BufferLike | undefined = (
  globalThis as { Buffer?: BufferLike }
).Buffer;

/** Encode a Uint8Array to a base64 string. */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (nodeBuffer) return nodeBuffer.from(bytes).toString("base64");
  // Browser fallback: build a binary string then btoa.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/** Decode a base64 string back to a Uint8Array. */
export function base64ToUint8Array(b64: string): Uint8Array {
  if (nodeBuffer) {
    // Copy into a plain Uint8Array so callers don't hold a view into Node's
    // shared internal pool.
    return new Uint8Array(nodeBuffer.from(b64, "base64"));
  }
  // Browser fallback: atob then char codes.
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
