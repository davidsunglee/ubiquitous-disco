/**
 * SimulatedTransport — Phase 4: dev-only network simulator.
 *
 * Wraps NetClient send/receive with independent uplink/downlink link simulation:
 *   - delayMs: base one-way latency (ms)
 *   - jitterMs: ±uniform jitter added on top of delayMs
 *   - dropRate: probability [0, 1) that a message is dropped entirely
 *   - reorderRate: probability [0, 1) that delivery order is randomized among
 *     currently-queued messages
 *
 * The "uplink" profile applies when the client sends to the server.
 * The "downlink" profile applies when the server sends to the client.
 *
 * Dev-only: when `import.meta.env.PROD` is true the simulator is a no-op
 * (zero delay, zero drop) so the server stays clean and no extra latency is
 * introduced in production builds.
 *
 * Usage:
 *   const transport = new SimulatedTransport(netClient);
 *   transport.uplink.delayMs = 40;
 *   transport.downlink.delayMs = 40;
 *   // Then use transport.send() and transport.interceptIncoming() instead of
 *   // calling netClient directly.
 *
 * NetLoop integration: NetLoop calls transport.send() for outgoing messages and
 * registers message handlers via transport.onMessage() so that inbound messages
 * pass through the downlink simulator before reaching the handler.
 */

import type { NetClient } from "./NetClient";

// ── Link parameter type ───────────────────────────────────────────────────────

export interface LinkParams {
  /** Base one-way delay in milliseconds. Default: 0. */
  delayMs: number;
  /** Additional ±uniform jitter in milliseconds. Actual delay ∈ [delay-jitter, delay+jitter]. Default: 0. */
  jitterMs: number;
  /** Drop probability [0, 1). 0 = never drop, 0.1 = 10% drop. Default: 0. */
  dropRate: number;
  /**
   * Reorder probability [0, 1). When a message is "reordered", it is swapped
   * with a randomly selected already-pending message in the queue, changing the
   * delivery order. Default: 0.
   */
  reorderRate: number;
}

export type NetSimPatch = Partial<{
  uplinkDelayMs: number;
  uplinkJitterMs: number;
  uplinkDropRate: number;
  uplinkReorderRate: number;
  downlinkDelayMs: number;
  downlinkJitterMs: number;
  downlinkDropRate: number;
  downlinkReorderRate: number;
}>;

// ── Dev environment check ─────────────────────────────────────────────────────

// Vite injects import.meta.env at build time. Cast to avoid forcing DOM types.
type ViteEnv = { PROD?: boolean };
function isProd(): boolean {
  try {
    return !!(import.meta as unknown as { env: ViteEnv }).env.PROD;
  } catch {
    return false;
  }
}

// ── Pending delivery entry ────────────────────────────────────────────────────

interface PendingDelivery {
  at: number; // DOMHighResTimeStamp when this should be delivered
  deliver: () => void;
}

// ── SimulatedTransport ────────────────────────────────────────────────────────

export class SimulatedTransport {
  /** Outgoing (client → server) link simulation. */
  readonly uplink: LinkParams = {
    delayMs: 0,
    jitterMs: 0,
    dropRate: 0,
    reorderRate: 0,
  };

  /** Incoming (server → client) link simulation. */
  readonly downlink: LinkParams = {
    delayMs: 0,
    jitterMs: 0,
    dropRate: 0,
    reorderRate: 0,
  };

  private readonly inner: NetClient;
  private readonly prod: boolean;

  /** Pending outgoing (uplink) deliveries. */
  private uplinkQueue: PendingDelivery[] = [];

  /** Pending incoming (downlink) deliveries. */
  private downlinkQueue: PendingDelivery[] = [];

  constructor(inner: NetClient) {
    this.inner = inner;
    this.prod = isProd();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Apply a patch to the link params. Field names are prefixed with
   * "uplink" or "downlink".
   */
  applyPatch(patch: NetSimPatch): void {
    if (patch.uplinkDelayMs !== undefined)
      this.uplink.delayMs = patch.uplinkDelayMs;
    if (patch.uplinkJitterMs !== undefined)
      this.uplink.jitterMs = patch.uplinkJitterMs;
    if (patch.uplinkDropRate !== undefined)
      this.uplink.dropRate = patch.uplinkDropRate;
    if (patch.uplinkReorderRate !== undefined)
      this.uplink.reorderRate = patch.uplinkReorderRate;
    if (patch.downlinkDelayMs !== undefined)
      this.downlink.delayMs = patch.downlinkDelayMs;
    if (patch.downlinkJitterMs !== undefined)
      this.downlink.jitterMs = patch.downlinkJitterMs;
    if (patch.downlinkDropRate !== undefined)
      this.downlink.dropRate = patch.downlinkDropRate;
    if (patch.downlinkReorderRate !== undefined)
      this.downlink.reorderRate = patch.downlinkReorderRate;
  }

  /** Read the current params as a flat patch object (for HUD display). */
  getParams(): Required<NetSimPatch> {
    return {
      uplinkDelayMs: this.uplink.delayMs,
      uplinkJitterMs: this.uplink.jitterMs,
      uplinkDropRate: this.uplink.dropRate,
      uplinkReorderRate: this.uplink.reorderRate,
      downlinkDelayMs: this.downlink.delayMs,
      downlinkJitterMs: this.downlink.jitterMs,
      downlinkDropRate: this.downlink.dropRate,
      downlinkReorderRate: this.downlink.reorderRate,
    };
  }

  /**
   * Send a message through the uplink simulator.
   * In PROD mode, delegates directly to inner.send().
   */
  send(type: string, payload: unknown): void {
    if (this.prod) {
      this.inner.send(type, payload);
      return;
    }
    this.scheduleDelivery(this.uplink, this.uplinkQueue, () => {
      this.inner.send(type, payload);
    });
  }

  /**
   * Register a message handler. Inbound messages pass through the downlink
   * simulator before reaching the callback.
   * In PROD mode, registers directly on inner.
   */
  onMessage(type: string, cb: (m: unknown) => void): void {
    if (this.prod) {
      this.inner.onMessage(type, cb);
      return;
    }
    this.inner.onMessage(type, (msg) => {
      this.scheduleDelivery(this.downlink, this.downlinkQueue, () => cb(msg));
    });
  }

  /**
   * Intercept a raw incoming message and run it through the downlink simulator.
   * Used when NetLoop has already registered the base handler and wants to
   * wrap the delivery.
   *
   * Alternatively, call `interceptDownlink()` to deliver a message object
   * directly through the downlink queue (for testing).
   */
  interceptDownlink(deliver: () => void): void {
    if (this.prod) {
      deliver();
      return;
    }
    this.scheduleDelivery(this.downlink, this.downlinkQueue, deliver);
  }

  /**
   * Tick the simulator: fire all deliveries whose scheduled time has passed.
   * Call this each frame (e.g., from NetLoop.tick() or GameScene.update()).
   * In PROD mode, this is a no-op.
   */
  tick(): void {
    if (this.prod) return;
    const now = performance.now();
    this.flushQueue(this.uplinkQueue, now);
    this.flushQueue(this.downlinkQueue, now);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Schedule a delivery through a link. Handles drop, jitter, and reorder.
   *
   * The `link` is the LinkParams controlling this direction.
   * The `queue` is the pending-delivery array for this direction.
   * `deliver` is the callback to invoke when the message is due.
   */
  private scheduleDelivery(
    link: LinkParams,
    queue: PendingDelivery[],
    deliver: () => void,
  ): void {
    // Drop check.
    if (link.dropRate > 0 && Math.random() < link.dropRate) {
      return; // message is silently dropped
    }

    // Compute jittered delay.
    const jitter =
      link.jitterMs > 0 ? (Math.random() * 2 - 1) * link.jitterMs : 0;
    const delay = Math.max(0, link.delayMs + jitter);
    const at = performance.now() + delay;

    const entry: PendingDelivery = { at, deliver };

    // Reorder: swap this entry with a randomly chosen existing queued entry.
    if (
      link.reorderRate > 0 &&
      Math.random() < link.reorderRate &&
      queue.length > 0
    ) {
      const swapIdx = Math.floor(Math.random() * queue.length);
      const swapEntry = queue[swapIdx];
      if (swapEntry) {
        // Deliver the queued entry earlier (at the new entry's time) and
        // deliver the new entry later (at the queued entry's time).
        const swappedDeliver = swapEntry.deliver;
        const swappedAt = swapEntry.at;
        // Replace queued entry's deliver with the new entry's deliver.
        queue[swapIdx] = { at: at < swappedAt ? at : swappedAt, deliver };
        // Push the displaced entry with the later time.
        queue.push({
          at: at < swappedAt ? swappedAt : at,
          deliver: swappedDeliver,
        });
        return;
      }
    }

    queue.push(entry);
  }

  /** Fire all entries in `queue` whose `at` time has passed. */
  private flushQueue(queue: PendingDelivery[], now: number): void {
    // Partition: ready vs still-pending.
    const toFire: PendingDelivery[] = [];
    const remaining: PendingDelivery[] = [];
    for (const entry of queue) {
      if (entry.at <= now) {
        toFire.push(entry);
      } else {
        remaining.push(entry);
      }
    }
    // Replace queue in place.
    queue.splice(0, queue.length, ...remaining);
    // Fire ready deliveries in arrival-time order.
    toFire.sort((a, b) => a.at - b.at);
    for (const entry of toFire) {
      entry.deliver();
    }
  }
}
