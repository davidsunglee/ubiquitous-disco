import RAPIER from "@dimforge/rapier2d-deterministic-compat";

let ready = false;

/** Must be awaited once at app boot before createSimulation(). */
export async function initSim(): Promise<void> {
  if (ready) return;
  // RAPIER.init() hands the base64-inlined WASM bytes to its wasm-bindgen
  // initializer positionally, which makes wasm-bindgen log a (harmless)
  // "deprecated parameters for the initialization function" warning. The call
  // is internal to the -compat bundle and unchanged through 0.19.x, so we
  // filter just that one message for the duration of this one-time init.
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("deprecated parameters for the initialization function")
    ) {
      return;
    }
    originalWarn(...args);
  };
  try {
    await RAPIER.init(); // base64-inlined WASM — no Vite asset plumbing needed
  } finally {
    console.warn = originalWarn;
  }
  ready = true;
}

export function getRapier(): typeof RAPIER {
  if (!ready) throw new Error("initSim() must be awaited before use");
  return RAPIER;
}
