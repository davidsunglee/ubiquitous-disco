/**
 * Shared base64 codec round-trip tests (#8).
 *
 * The Rapier world snapshot bytes are transported as base64 inside
 * WorldSnapshot.rapierBytesB64. Encode (server) and decode (client) must be
 * exact inverses for every byte value, including the full 0..255 range and
 * empty input. This is the single shared home for the codec — no per-package
 * copies.
 */

import { expect, test } from "vitest";
import { base64ToUint8Array, uint8ArrayToBase64 } from "../base64";

test("round-trips the full 0..255 byte range", () => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;

  const decoded = base64ToUint8Array(uint8ArrayToBase64(bytes));

  expect(decoded.length).toBe(bytes.length);
  expect(Array.from(decoded)).toEqual(Array.from(bytes));
});

test("round-trips an empty byte array", () => {
  const decoded = base64ToUint8Array(uint8ArrayToBase64(new Uint8Array(0)));
  expect(decoded.length).toBe(0);
});

test("round-trips a multi-KB payload of varied bytes", () => {
  const bytes = new Uint8Array(4096);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;

  const decoded = base64ToUint8Array(uint8ArrayToBase64(bytes));

  expect(Array.from(decoded)).toEqual(Array.from(bytes));
});
