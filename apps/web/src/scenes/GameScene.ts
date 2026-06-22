import type { MatchLaunch } from "@bb/protocol";
import {
  CHARACTERS,
  type CharacterDef,
  createReplay,
  createSimulation,
  DEFAULT_CONFIG,
  deserializeReplay,
  FLAT_DOJO,
  type InputFrame,
  type MatchState,
  type PlayerSlotId,
  playReplay,
  type RenderState,
  type ReplayData,
  recordFrame,
  type SimConfig,
  type Simulation,
  serializeReplay,
  teamForPlayerSlot,
} from "@bb/sim";
import Phaser from "phaser";
import {
  KeyboardAdapter,
  NET_KEYMAP,
  P1_KEYMAP,
  P2_KEYMAP,
} from "../input/KeyboardAdapter";
import { mergeInputFrames, TouchAdapter } from "../input/TouchAdapter";
import {
  hasLaunchJoined,
  markLaunchJoined,
  peekLaunch,
} from "../lobby/launchHandoff";
import { NetClient } from "../net/NetClient";
import { NetLoop } from "../net/NetLoop";
import {
  type NetSimPatch,
  SimulatedTransport,
} from "../net/SimulatedTransport";
import { attemptLandscapeLock } from "../orientation";
import {
  bellSubjectFromWorld,
  GroupCamera,
  type GroupSubject,
  subjectFromWorld,
} from "../render/GroupCamera";
import {
  lerp,
  PX_PER_UNIT,
  toScreenX,
  toScreenY,
} from "../render/worldToScreen";
import { ConnectionOverlay } from "./ConnectionOverlay";
import { type HudBridge, hudBridge } from "./HudScene";
import { OrientationOverlay } from "./OrientationOverlay";
import {
  type FailClosedReason,
  shouldAttemptReconnect,
  wireFailClosed,
} from "./reconnectFlow";
import { bellFromScoreDelta } from "./scoreFeedback";

// Distinct colors per player slot (grounded / airborne variants).
// Slots 0/1 = Team 0 (blue shades, left side); Slots 2/3 = Team 1 (orange/red shades, right side).
const SLOT_COLORS = [
  { grounded: 0x2288ff, air: 0x55ccff }, // slot 0 — Team 0
  { grounded: 0x33aaff, air: 0x88ddff }, // slot 1 — Team 0
  { grounded: 0xff6644, air: 0xff9977 }, // slot 2 — Team 1
  { grounded: 0xff8855, air: 0xffbb99 }, // slot 3 — Team 1
];

export class GameScene extends Phaser.Scene {
  private sim!: Simulation;
  private gfx!: Phaser.GameObjects.Graphics;
  private kb1!: KeyboardAdapter;
  private kb2!: KeyboardAdapter;
  /** Networked local-player keyboard (Arrows + Z/X/C); used in networked mode. */
  private kbNet!: KeyboardAdapter;
  private touch!: TouchAdapter;
  private groupCamera!: GroupCamera;
  private orientationOverlay!: OrientationOverlay;
  private accumulator = 0;
  private readonly FIXED_STEP = 1000 / DEFAULT_CONFIG.tickHz;
  private prev!: RenderState;
  private cur!: RenderState;
  // Bell Ring feedback: a banner that fades out, plus a per-Bell flash timer.
  private bellText!: Phaser.GameObjects.Text;
  private bellFlash: { left: number; right: number } = { left: 0, right: 0 };
  // Phase 3: per-player hit flash (1 → 0), one entry per slot. Cosmetic only.
  private hitFlash: number[] = [];
  /**
   * Last authoritative Team scores seen by the HUD. In networked mode the
   * predicted sim's Bell Ring events are discarded, so the Bell banner is
   * driven from authoritative score increments instead (see updateMatchHud).
   */
  private prevScores: number[] = [];

  // ── Phase 2 (FLI-9): Special feedback ──────────────────────────────────────
  /** Per-slot Special press-flash intensity (1 → 0). Cosmetic only. */
  private specialFlash: number[] = [];
  /**
   * Per-slot Special cooldown approximation for the cooldown ring.
   * Driven by local input presses + elapsed ticks; cosmetic only (no sim coupling).
   */
  private localSpecialCooldown: number[] = [];
  /** Per-slot cooldown total ticks (from last known special activation). */
  private localSpecialCooldownTotal: number[] = [];

  // ── Phase 2 (FLI-9): Strike-variant text feedback ───────────────────────────
  /** Strike-variant text pop object (shared; shows SPIKE! / HEADER! / CHARGED!). */
  private strikeVariantText!: Phaser.GameObjects.Text;
  /** Alpha fade timer for the strike-variant text pop. */
  private strikeVariantAlpha = 0;
  /**
   * Per-slot strike-variant arc flash: {kind, intensity}.
   * Cosmetic only — detected from the local InputFrame at strike release.
   */
  private strikeArcFlash: Array<{
    kind: "spike" | "header" | "charged" | null;
    intensity: number;
  }> = [];

  // ── Phase 5: pause/step/replay state ────────────────────────────────────────
  private paused = false;
  /** When true, advance exactly one tick this frame then re-pause. */
  private doSingleStep = false;
  /** The live config (may be patched by HUD sliders). */
  private liveConfig: SimConfig = { ...DEFAULT_CONFIG };
  /** Replay capture accumulator. Null when not recording. */
  private captureData: ReplayData | null = null;
  /** Last captured replay JSON (for the Replay button). */
  private lastCaptureJson: string | null = null;

  // Replay playback state (null when not replaying via startReplay).
  private replayFrames: InputFrame[][] | null = null;
  private replayFrameCursor = 0;

  // ── Phase 6: static Bell screen positions ────────────────────────────────────
  private bellSubjects!: Array<{ screenX: number; screenY: number }>;

  // ── Phase 3: sim tick counter for deterministic i-frame blink ────────────────
  private simTick = 0;

  // ── Networking (Phase 1 + 2) ──────────────────────────────────────────────────
  private netClient!: NetClient;
  private connectionOverlay!: ConnectionOverlay;
  /** Phase 2: set once the room is full (both players present). */
  private netLoop: NetLoop | null = null;
  /**
   * True once we've created/joined a room but the opponent hasn't arrived yet.
   * While awaiting, the local hotseat sim is frozen so stray input can't start a
   * phantom local match behind the connection panel.
   */
  private awaitingOpponent = false;
  /**
   * Phase 5: set when the match ends fail-closed (peer disconnect / server
   * shutdown). Input is frozen and the fail-closed banner is shown.
   */
  private matchFailClosed = false;

  /**
   * Phase 6: retained launch payload for reconnect. Unlike `takeLaunch()` which
   * clears sessionStorage, we keep an in-scene copy so we can re-join with the
   * same (launchId, joinToken) if the match connection drops within grace.
   */
  private retainedLaunch: MatchLaunch | null = null;
  /**
   * Phase 6: true while a reconnect attempt is in flight. Prevents multiple
   * concurrent reconnect attempts.
   */
  private reconnecting = false;
  /** Phase 4: dev network simulator (dev-only). */
  private simTransport: SimulatedTransport | null = null;

  /** Phase 5: telemetry interval handle (clearInterval on shutdown). */
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Phase 4: the `net-sim-config` document listener added in startNetLoop.
   * Stored so shutdown() can removeEventListener it — an inline arrow can't be
   * removed and would leak across scene restarts.
   */
  private netSimConfigHandler: ((e: Event) => void) | null = null;

  // ── Phase 2: match HUD DOM nodes ─────────────────────────────────────────────
  // hudOverlay is sized/positioned to exactly overlay the (scaled, centered)
  // canvas each frame, so the %/px-positioned HUD children stay aligned with the
  // game at any window size under Phaser.Scale.FIT.
  private hudOverlay!: HTMLElement;
  private scoreEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private startPromptEl!: HTMLElement;
  private goldenGoalEl!: HTMLElement;
  private matchSummaryEl!: HTMLElement;
  /** Default-route "Play Online →" link (hotseat only); hidden once a match starts. */
  private playOnlineEl: HTMLElement | null = null;

  constructor() {
    super("GameScene");
  }

  create(): void {
    this.sim = this.buildSim(this.liveConfig);
    this.gfx = this.add.graphics();
    if (!this.input.keyboard) {
      throw new Error("Keyboard input plugin unavailable");
    }
    this.kb1 = new KeyboardAdapter(this.input.keyboard, P1_KEYMAP);
    this.kb2 = new KeyboardAdapter(this.input.keyboard, P2_KEYMAP);
    this.kbNet = new KeyboardAdapter(this.input.keyboard, NET_KEYMAP);

    // Stop arrow keys (P2 movement) from scrolling the page/canvas.
    this.input.keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
    ]);

    // Phase 6: touch adapter.
    this.touch = new TouchAdapter(this);
    this.touch.create();

    // Phase 6: group-framing camera using the main camera.
    this.groupCamera = new GroupCamera(this.cameras.main);

    // Pre-compute static Bell screen positions (Bells don't move).
    this.bellSubjects = FLAT_DOJO.bells.map((b) =>
      bellSubjectFromWorld(b.hitZone.x, b.hitZone.y),
    );

    // Phase 6: orientation overlay — attempt landscape lock then show prompt
    // in portrait.
    attemptLandscapeLock();
    this.orientationOverlay = new OrientationOverlay({
      onPortrait: () => {
        this.paused = true;
      },
      onLandscape: () => {
        this.paused = false;
      },
    });
    this.orientationOverlay.mount();

    // getRenderState() returns a fresh, independent snapshot each call, so two
    // calls give independent prev/cur without structuredClone.
    this.prev = this.sim.getRenderState();
    this.cur = this.sim.getRenderState();

    // Bell Ring banner (hidden until a Bell rings). Drawn above the canvas-center.
    this.bellText = this.add
      .text(480, 60, "", {
        fontFamily: "monospace",
        fontSize: "40px",
        color: "#ffe066",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0)
      // Pin the banner to the viewport so zoom/scroll don't affect it.
      .setScrollFactor(0);

    // Phase 2 (FLI-9): strike-variant text pop (SPIKE! / HEADER! / CHARGED!).
    this.strikeVariantText = this.add
      .text(480, 120, "", {
        fontFamily: "monospace",
        fontSize: "28px",
        color: "#ff8844",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setScrollFactor(0);

    // Wire up the HUD bridge so HudScene can control us.
    this.wireHudBridge();

    // Phase 2: inject match HUD DOM nodes so Playwright can locate them.
    this.createMatchHudNodes();

    // Phase 1: mount the connection/room overlay and wire it to a NetClient.
    this.netClient = new NetClient();
    this.connectionOverlay = new ConnectionOverlay();
    this.connectionOverlay.mount();

    // Phase 5: if the lobby handed off a launch payload, join the match via the
    // launch manifest (launchId + joinToken) and skip the create/join overlay.
    //
    // Phase 6: use peekLaunch() (not takeLaunch()) so the payload stays in
    // sessionStorage for potential reconnect after a page refresh. We keep an
    // in-scene copy in retainedLaunch for mid-match reconnect without a reload.
    const launch = peekLaunch();
    const urlParams = new URLSearchParams(window.location.search);
    // Dev/test direct-connect overlay is opt-in via ?direct (used by net-*.spec.ts
    // and manual dev). The default root route is a clean local hotseat with a
    // one-click "Play Online" path to the lobby.
    const directConnect = urlParams.get("direct") !== null;
    if (launch) {
      this.startLaunchedMatch(launch);
    } else if (directConnect) {
      // Dev/test direct-connect shortcut: the create/join overlay path from
      // Plan 1. ?botSlot=N fills a slot with a Practice Bot on the legacy path.
      // Freeze the local hotseat sim and hide its start prompt so only the clean
      // connection panel shows (no "Press Jump to Start" bleeding through).
      this.awaitingOpponent = true;
      this.startPromptEl.style.display = "none";
      const botSlotParam = urlParams.get("botSlot");
      const createOptions =
        botSlotParam !== null
          ? { botSlots: [Number(botSlotParam)] }
          : undefined;

      this.connectionOverlay.wire(
        this.netClient,
        this.game.canvas,
        (slot, slots) => {
          // Phase 2: room is full — switch to networked mode.
          this.startNetLoop(
            slot as PlayerSlotId,
            (slots ?? [0, 2]) as PlayerSlotId[],
          );
        },
        () => {
          // Created/joined a room; freeze the local sim until the match begins
          // so stray input can't kick off a phantom local match.
          this.awaitingOpponent = true;
          this.startPromptEl.style.display = "none";
        },
        createOptions,
      );
    } else {
      // Default route: clean local hotseat. Hide the dev direct-connect panel
      // and offer a one-click path to the online lobby (#lobby route).
      this.connectionOverlay.hideRoomPanel();
      this.addPlayOnlineLink();
    }

    // Launch the HUD in parallel (it renders on top without replacing GameScene).
    this.scene.launch("HudScene");
  }

  // ── Phase 2: match HUD DOM nodes ─────────────────────────────────────────────

  /**
   * Default-route affordance: a one-click link from the local hotseat game to the
   * online lobby (#lobby). The LobbyRouter (main.ts) handles the hash change and
   * disables the Phaser keyboard while the lobby is shown.
   */
  private addPlayOnlineLink(): void {
    const link = document.createElement("a");
    link.dataset.testid = "play-online";
    link.textContent = "Play Online →";
    link.href = "#lobby";
    link.style.cssText =
      "position:absolute;left:50%;top:62%;transform:translate(-50%,0);" +
      "pointer-events:auto;font-family:monospace;font-size:14px;" +
      "color:#7fd1ff;text-decoration:none;padding:6px 14px;" +
      "border:1px solid #355;border-radius:4px;background:rgba(0,0,0,0.55);";
    this.hudOverlay.appendChild(link);
    this.playOnlineEl = link;
  }

  /** Create a DOM node (data-testid anchor + visible HUD element) in the overlay. */
  private makeTestNode(testid: string, css: string): HTMLElement {
    const el = document.createElement("div");
    el.dataset.testid = testid;
    el.style.cssText = `position:absolute;pointer-events:none;font-family:monospace;color:#fff;text-shadow:0 1px 3px #000,0 0 6px #000;${css}`;
    this.hudOverlay.appendChild(el);
    return el;
  }

  private createMatchHudNodes(): void {
    // An overlay that is resized each frame to exactly cover the (scaled,
    // centered) canvas, so the %/px-positioned HUD children line up with the
    // game area at any window size — not the whole viewport.
    const parent = document.getElementById("game-container");
    if (parent) parent.style.position = "relative";
    this.hudOverlay = document.createElement("div");
    this.hudOverlay.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;";
    (parent ?? document.body).appendChild(this.hudOverlay);

    // Score: large, top-centre.
    this.scoreEl = this.makeTestNode(
      "score",
      "top:8px;left:50%;transform:translateX(-50%);font-size:30px;font-weight:bold;letter-spacing:2px;",
    );
    // Timer: just below the score.
    this.timerEl = this.makeTestNode(
      "timer",
      "top:46px;left:50%;transform:translateX(-50%);font-size:18px;color:#ffe;",
    );
    // Golden Goal banner: below the timer, only while in sudden death.
    this.goldenGoalEl = this.makeTestNode(
      "golden-goal",
      "top:72px;left:50%;transform:translateX(-50%);font-size:18px;font-weight:bold;color:#ffcc00;",
    );
    // Start prompt: centred overlay during preRound.
    this.startPromptEl = this.makeTestNode(
      "start-prompt",
      "top:50%;left:50%;transform:translate(-50%,-50%);font-size:22px;text-align:center;background:rgba(0,0,0,0.55);padding:14px 22px;border-radius:8px;",
    );
    // Match summary: centred overlay when complete.
    this.matchSummaryEl = this.makeTestNode(
      "match-summary",
      "top:50%;left:50%;transform:translate(-50%,-50%);font-size:22px;text-align:center;background:rgba(0,0,0,0.7);padding:18px 26px;border-radius:8px;",
    );

    // Set initial values immediately so nodes are populated before first update.
    this.scoreEl.textContent = "0 - 0";
    this.timerEl.textContent = "3:00";
    this.startPromptEl.textContent = "Press Jump to Start";
    this.startPromptEl.style.display = "block";
    this.goldenGoalEl.style.display = "none";
    this.matchSummaryEl.style.display = "none";
  }

  private updateMatchHud(m: MatchState): void {
    // Keep the HUD overlay aligned with the scaled/centered canvas (Scale.FIT
    // letterboxes and re-centers on resize, so the canvas rect moves).
    const canvas = this.game.canvas;
    if (canvas && this.hudOverlay) {
      this.hudOverlay.style.left = `${canvas.offsetLeft}px`;
      this.hudOverlay.style.top = `${canvas.offsetTop}px`;
      this.hudOverlay.style.width = `${canvas.clientWidth}px`;
      this.hudOverlay.style.height = `${canvas.clientHeight}px`;
    }

    const ticks = m.timer;
    const hz = DEFAULT_CONFIG.tickHz;
    const totalSec = Math.max(0, Math.ceil(ticks / hz));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    this.timerEl.textContent = `${min}:${String(sec).padStart(2, "0")}`;
    this.scoreEl.textContent = `${m.scores[0] ?? 0} - ${m.scores[1] ?? 0}`;
    // Networked play discards the predicted sim's Bell Ring events, so surface
    // the Bell banner from authoritative score increments instead. (The local
    // hotseat fires onBellRing directly from sim events, so guard to avoid a
    // double trigger there.)
    if (this.netLoop !== null) {
      const bell = bellFromScoreDelta(this.prevScores, m.scores);
      if (bell) this.onBellRing(bell);
    }
    this.prevScores = [...m.scores];
    this.startPromptEl.style.display =
      m.phase === "preRound" ? "block" : "none";
    // Once the hotseat match starts (leaves preRound), the player has elected
    // local play — retire the "Play Online" link for good.
    if (m.phase !== "preRound" && this.playOnlineEl) {
      this.playOnlineEl.style.display = "none";
    }
    this.goldenGoalEl.style.display =
      m.phase === "goldenGoal" ? "block" : "none";
    if (m.phase === "goldenGoal") {
      this.goldenGoalEl.textContent = "GOLDEN GOAL!";
    }
    if (m.phase === "complete") {
      this.matchSummaryEl.style.display = "block";
      let winnerText: string;
      if (m.winner === -1) {
        winnerText = "DRAW";
      } else if (this.netLoop !== null) {
        // Networked: compare winner (Team index) against this client's team.
        const myTeam = teamForPlayerSlot(this.netClient.slot as PlayerSlotId);
        winnerText = m.winner === myTeam ? "YOU WIN" : "YOU LOSE";
      } else {
        winnerText = `P${m.winner + 1} WINS`;
      }
      this.matchSummaryEl.textContent = `${winnerText} — Press Jump to Rematch`;
    } else {
      this.matchSummaryEl.style.display = "none";
    }
  }

  // ── HUD bridge wiring ────────────────────────────────────────────────────────

  private wireHudBridge(): void {
    const bridge: HudBridge = {
      isPaused: () => this.paused,
      pause: () => {
        this.paused = true;
      },
      resume: () => {
        this.paused = false;
      },
      step: () => {
        if (this.paused) this.doSingleStep = true;
      },
      reset: () => {
        this.resetSim();
      },
      getConfig: () => this.liveConfig,
      updateConfig: (patch) => {
        this.liveConfig = { ...this.liveConfig, ...patch };
        this.sim.updateConfig(this.liveConfig);
      },
      getDebugColliders: () => this.sim.getDebugColliders(),
      startCapture: () => {
        this.captureData = createReplay(1234, FLAT_DOJO.id, "default");
      },
      stopCapture: () => {
        if (!this.captureData) return null;
        const json = serializeReplay(this.captureData);
        this.lastCaptureJson = json;
        this.captureData = null;
        return json;
      },
      replayCapture: () => {
        if (!this.lastCaptureJson) return;
        this.startReplay(this.lastCaptureJson);
      },
      isCapturing: () => this.captureData !== null,
      getMatchState: () => this.sim.getMatchState(),
      // Phase 4: live closures over SimulatedTransport (null when no transport).
      getNetSim: () => this.simTransport?.getParams() ?? null,
      updateNetSim: (patch) => this.simTransport?.applyPatch(patch),
    };
    // Overwrite all fields of the shared singleton bridge.
    Object.assign(hudBridge, bridge);
  }

  // ── Phase 2: networked game loop ─────────────────────────────────────────────

  /**
   * Phase 5: join the match for a launch handoff. Freezes the local sim, joins
   * Colyseus via the launch (launchId + joinToken), and starts the NetLoop once
   * the room reports its claimed slot + active slots. On a rejected claim the
   * connection simply closes (fail-closed banner).
   *
   * Phase 6: retains the launch payload for reconnect. On any disconnect, if
   * a retained launch is available, attempts to reclaim the slot by re-joining
   * with the same (launchId, joinToken). Only shows the fail-closed banner if
   * the reclaim fails or the grace window has expired.
   */
  private startLaunchedMatch(launch: MatchLaunch): void {
    // Retain the launch payload for reconnect (Phase 6).
    this.retainedLaunch = launch;

    // The match is entered via the lobby handoff — the direct-connect create/join
    // panel must never show (it would linger in the corner).
    this.connectionOverlay.hideConnectPanel();

    // Freeze the local background sim until the networked match begins.
    this.awaitingOpponent = true;
    this.startPromptEl.style.display = "none";

    const net = this.netClient;
    net.slot = launch.playerSlotId;

    const create = !hasLaunchJoined(launch.launchId);

    void net
      .joinLaunch(launch.launchId, launch.joinToken, { create })
      .then(() => {
        markLaunchJoined(launch.launchId);
        net.onMessage("RoomReady", (msg) => {
          const m = msg as {
            slot: number;
            full: boolean;
            slots?: PlayerSlotId[];
            characters?: import("@bb/sim").CharacterId[];
          };
          net.slot = m.slot as PlayerSlotId;
          if (m.full) {
            this.startNetLoop(
              m.slot as PlayerSlotId,
              (m.slots ?? [0, 1, 2, 3]) as PlayerSlotId[],
              m.characters,
            );
          }
        });
        // Fail-closed before the loop starts (e.g. rejected/duplicate claim).
        // Wired exactly once per NetClient instance (see wireFailClosed).
        this.wireFailClosed(net);
      })
      .catch((err) => {
        console.error("[net] joinLaunch failed", err);
        this.connectionOverlay.showFailClosed("ws-error");
      });
  }

  /**
   * Phase 6: attempt to reconnect using the retained launch payload.
   *
   * Re-joins Colyseus with the same (launchId, joinToken). The MatchLaunch DO
   * treats the re-claim as idempotent within the grace window. If successful,
   * the NetLoop resumes at the same Player Slot. If the reclaim fails (e.g.
   * grace expired or the room was disposed), shows the fail-closed banner.
   */
  private async attemptReconnect(): Promise<void> {
    const launch = this.retainedLaunch;
    if (!launch || this.reconnecting) return;

    this.reconnecting = true;
    console.info("[net] attempting reconnect…", launch.launchId);

    // Build a fresh NetClient for the new room connection.
    this.netClient = new NetClient();
    const net = this.netClient;
    net.slot = launch.playerSlotId;

    try {
      await net.joinLaunch(launch.launchId, launch.joinToken, {
        create: false,
      });

      // Reconnect succeeded — wire up the message handlers.
      net.onMessage("RoomReady", (msg) => {
        const m = msg as {
          slot: number;
          full: boolean;
          slots?: PlayerSlotId[];
          characters?: import("@bb/sim").CharacterId[];
        };
        net.slot = m.slot as PlayerSlotId;
        this.reconnecting = false;
        // Reconnect resumed: clear any terminal/fail-closed state so a stale
        // banner can't persist over the resumed game (FLI-8 BUG #1).
        this.clearFailClosed();
        if (m.full) {
          // Resume the net loop with the same slot.
          this.startNetLoop(
            m.slot as PlayerSlotId,
            (m.slots ?? [0, 1, 2, 3]) as PlayerSlotId[],
            m.characters,
          );
        }
      });

      // Fresh NetClient instance — wired once. shouldAttemptReconnect() guards
      // against re-entrancy if the reconnect itself fails closed.
      this.wireFailClosed(net);

      console.info("[net] reconnect join sent — awaiting RoomReady");
    } catch (err) {
      console.error("[net] reconnect failed", err);
      this.reconnecting = false;
      this.matchFailClosed = true;
      this.connectionOverlay.showFailClosed("ws-error");
    }
  }

  /**
   * Wire fail-closed handling onto a NetClient EXACTLY ONCE per instance
   * (FLI-8 BUG #1). The launch path, the reconnect path, and the net-loop path
   * all funnel through here; wireFailClosed() (reconnectFlow) de-dupes per
   * instance so the SDK's stacking handlers can't register two fire-once chains
   * on the same room and fight each other on a disconnect.
   */
  private wireFailClosed(net: NetClient): void {
    wireFailClosed(net, (reason: FailClosedReason) => {
      console.info(`[net] fail-closed: ${reason}`);
      // Stop the net loop so no more predicted ticks or sends happen.
      this.netLoop = null;

      // Phase 6: if we can recover (retained launch, not already reconnecting,
      // non-terminal reason), attempt to reclaim the slot before showing the
      // banner.
      if (
        shouldAttemptReconnect(reason, {
          hasRetainedLaunch: this.retainedLaunch !== null,
          reconnecting: this.reconnecting,
        })
      ) {
        void this.attemptReconnect();
        return;
      }

      // Freeze the scene so stray input can't interact with the frozen state,
      // and show the fail-closed banner + status badge.
      this.reconnecting = false;
      this.matchFailClosed = true;
      this.connectionOverlay.showFailClosed(reason);
    });
  }

  /**
   * Clear terminal/fail-closed state on a successful reconnect resume so a
   * stale "Match Over" banner can't persist over the resumed game (FLI-8).
   */
  private clearFailClosed(): void {
    this.matchFailClosed = false;
    this.connectionOverlay.hideFailClosed();
  }

  private startNetLoop(
    slot: PlayerSlotId,
    activeSlots: PlayerSlotId[] = [0, 2],
    characterIds?: import("@bb/sim").CharacterId[],
  ): void {
    // Idempotency guard (FLI-8 BUG #2): the server re-broadcasts
    // RoomReady{full:true} to ALL present clients whenever any peer reconnects,
    // so the persistent RoomReady handler can re-invoke this on every other
    // client. RoomReady{full:true} means "ensure the loop is running", not
    // "start a second one". A second start would orphan the first NetLoop +
    // SimulatedTransport, leak a duplicate net-sim-config listener, and stack
    // another onFailClosed. If a loop is already running, do nothing.
    if (this.netLoop !== null) return;

    // The match is starting — leave the awaiting-opponent freeze state.
    this.awaitingOpponent = false;

    // Phase 4: create a dev-only SimulatedTransport and register it on the
    // hudBridge so HUD sliders can tune it live.
    this.simTransport = new SimulatedTransport(this.netClient);

    // Dev/e2e hook: let tests tune the simulator without driving Phaser-canvas
    // sliders. `net-latency.spec.ts` dispatches this CustomEvent to apply
    // latency in each tab; the HUD sliders are the manual equivalent. Store the
    // handler so shutdown() can remove it (avoids a listener leak on restart).
    this.netSimConfigHandler = (e: Event) => {
      const detail = (e as CustomEvent<NetSimPatch>).detail;
      if (detail) this.simTransport?.applyPatch(detail);
    };
    document.addEventListener("net-sim-config", this.netSimConfigHandler);

    this.netLoop = new NetLoop(
      this.netClient,
      slot,
      activeSlots,
      {
        onRenderState: (prev, cur) => {
          this.prev = prev;
          this.cur = cur;
        },
        onMatchState: (m) => {
          // Networked HUD is driven by authoritative MatchState from snapshots.
          this.updateMatchHud(m);
        },
        onDisconnect: () => {
          console.info("[net] disconnected");
        },
        // Phase 2 (FLI-9): local strike-variant + special feedback, driven off
        // the predicted local input before each prediction step (matching the
        // hotseat detect-before-step timing). Only the local slot gets feedback.
        onLocalTick: (localInput, preStepRender) => {
          const localSlot = this.netClient.slot;
          this.detectStrikeVariantForSlot(localInput, localSlot, preStepRender);
          this.detectSpecialForSlot(localInput, localSlot);
        },
      },
      this.simTransport,
      characterIds,
    );
    this.netLoop.start();
    console.info(`[net] NetLoop started (slot ${slot})`);

    // Phase 5/6: fail-closed — wired exactly once per NetClient instance. The
    // launch path may already have wired this same instance (in
    // startLaunchedMatch); wireFailClosed() de-dupes so both fire-once chains
    // can't fight each other (FLI-8 BUG #1).
    this.wireFailClosed(this.netClient);

    // Phase 5: periodic RTT telemetry (every 2 seconds).
    this.startTelemetry();
  }

  // ── Phase 5: telemetry ───────────────────────────────────────────────────────

  /**
   * Start a periodic RTT telemetry sample. Fires every 2 seconds while the
   * match is live (netLoop not null). Stops automatically on fail-closed
   * (netLoop becomes null). Shows the telemetry readout in the overlay.
   */
  private startTelemetry(): void {
    if (this.telemetryTimer !== null) return; // already running
    this.connectionOverlay.updateTelemetry(0); // show the element with initial value
    this.telemetryTimer = setInterval(() => {
      if (this.netLoop === null) {
        // Match ended — hide telemetry and stop sampling.
        this.connectionOverlay.updateTelemetry(null);
        if (this.telemetryTimer !== null) {
          clearInterval(this.telemetryTimer);
          this.telemetryTimer = null;
        }
        return;
      }
      // Sample RTT from the Colyseus room. ping() is fire-and-forget;
      // the callback updates the overlay with the measured value.
      this.netClient
        .ping()
        .then((rtt) => {
          this.connectionOverlay.updateTelemetry(rtt);
        })
        .catch(() => {
          // Ignore ping errors (room may have closed between the call and reply).
        });
    }, 2000);
  }

  // ── Sim lifecycle ────────────────────────────────────────────────────────────

  private buildSim(config: SimConfig): Simulation {
    // Phase 2 (FLI-9) dev default: hotseat has no character picker yet, so spawn
    // Panda for both active slots — Panda's Ground Pound is the only Special
    // implemented this phase, making it the only one observable in hotseat. The
    // remaining characters' Specials land in Phase 4. Characters are not hashed,
    // so this does not affect the cross-engine determinism contract.
    const characters: CharacterDef[] = [];
    characters[0] = CHARACTERS.panda;
    characters[2] = CHARACTERS.panda;
    return createSimulation({
      config,
      arena: FLAT_DOJO,
      seed: 1234,
      characters,
    });
  }

  private resetSim(): void {
    this.paused = false;
    this.doSingleStep = false;
    this.captureData = null;
    this.replayFrames = null;
    this.replayFrameCursor = 0;
    this.accumulator = 0;
    this.simTick = 0;
    this.liveConfig = { ...DEFAULT_CONFIG };
    this.sim = this.buildSim(this.liveConfig);
    // getRenderState() returns a fresh, independent snapshot each call, so two
    // calls give independent prev/cur without structuredClone.
    this.prev = this.sim.getRenderState();
    this.cur = this.sim.getRenderState();
    this.bellFlash = { left: 0, right: 0 };
    this.bellText.setAlpha(0).setText("");
  }

  private startReplay(json: string): void {
    this.captureData = null;
    this.accumulator = 0;
    this.simTick = 0;
    this.liveConfig = { ...DEFAULT_CONFIG };
    this.sim = this.buildSim(this.liveConfig);
    // getRenderState() returns a fresh, independent snapshot each call, so two
    // calls give independent prev/cur without structuredClone.
    this.prev = this.sim.getRenderState();
    this.cur = this.sim.getRenderState();
    this.bellFlash = { left: 0, right: 0 };

    const replayData = deserializeReplay(json);
    // Log the replay hash vs live hash to confirm determinism in the console.
    const replayHash = playReplay(replayData);
    console.info(`[replay] determinism hash: ${replayHash}`);

    // Schedule replay frames to be fed into the sim on each fixed tick.
    this.replayFrames = replayData.inputFrames;
    this.replayFrameCursor = 0;
  }

  private collectInputFrames(): InputFrame[] {
    if (this.replayFrames !== null) {
      const row = this.replayFrames[this.replayFrameCursor];
      if (row !== undefined) {
        this.replayFrameCursor++;
        return row;
      }
      // Replay finished.
      this.replayFrames = null;
      this.replayFrameCursor = 0;
      console.info("[replay] playback complete");
    }
    // P1: merge keyboard + touch; P2: standalone keyboard.
    const p1 = mergeInputFrames(this.kb1.collect(), this.touch.collect());
    const p2 = this.kb2.collect();
    // The hotseat sim uses active slots [0, 2] (Team 0 left vs Team 1 right), and
    // sim.step()/getRenderState() are slot-indexed. Return a slot-indexed row so
    // P2 actually drives slot 2 (a dense [p1, p2] left slot 2 with no input).
    const row: InputFrame[] = [];
    row[0] = p1;
    row[2] = p2;
    return row;
  }

  update(_time: number, delta: number): void {
    // ── Phase 3: networked mode — predicted loop + reconciliation ─────────────
    if (this.netLoop !== null) {
      // Collect local player input. Unlike hotseat (two keymaps on one
      // keyboard), each networked client controls only its own player on its
      // own machine, so BOTH slots use the same networked scheme (Arrows +
      // Z/X/C, via kbNet) plus touch, regardless of which slot the server
      // assigned.
      const localSlot = this.netClient.slot;
      const collectLocal = () => {
        if (this.replayFrames !== null) {
          const row = this.replayFrames[this.replayFrameCursor];
          if (row !== undefined) {
            this.replayFrameCursor++;
            return row[localSlot] ?? this.kbNet.collect();
          }
          this.replayFrames = null;
          this.replayFrameCursor = 0;
        }
        return mergeInputFrames(this.kbNet.collect(), this.touch.collect());
      };

      // Advance the predicted loop (prediction + sends). NetLoop updates
      // this.prev/this.cur via onRenderState callback.
      this.netLoop.tick(delta, collectLocal);

      // Phase 3: use predicted render state with smooth interpolation.
      const alpha = this.netLoop.renderAlpha;

      // Override each remote player's render position from its own interpolation
      // buffer so all remotes move smoothly independent of the prediction sim.
      // Each remote slot has its own buffer (Phase 2+ multi-remote support).
      for (const remoteSlot of this.netLoop.getRemoteSlots()) {
        const remoteSample = this.netLoop.sampleRemoteRender(remoteSlot);
        if (remoteSample !== null) {
          // Patch cur for this remote slot.
          if (this.cur.players[remoteSlot]) {
            this.cur = {
              ...this.cur,
              players: this.cur.players.map((p, s) =>
                s === remoteSlot && p
                  ? {
                      ...p,
                      x: remoteSample.x,
                      y: remoteSample.y,
                      facing: remoteSample.facing,
                    }
                  : p,
              ),
            };
          }
          // Also patch prev so lerp doesn't jump from wrong prev position.
          if (this.prev.players[remoteSlot]) {
            this.prev = {
              ...this.prev,
              players: this.prev.players.map((p, s) =>
                s === remoteSlot && p
                  ? {
                      ...p,
                      x: remoteSample.x,
                      y: remoteSample.y,
                      facing: remoteSample.facing,
                    }
                  : p,
              ),
            };
          }
        }
      }

      this.gfx.clear();
      this.drawArena();
      this.drawBells();
      this.drawBall(alpha);
      this.drawPlayers(alpha);
      this.tickBellFeedback(delta);
      this.touch.drawUI();
      this.updateGroupCamera(alpha);

      // Match HUD is updated by NetLoop's onMatchState callback, but keep
      // canvas aligned every frame.
      if (this.netLoop.latestMatchState) {
        this.updateMatchHud(this.netLoop.latestMatchState);
      }
      return;
    }

    // ── Awaiting opponent: freeze the scene as a static background ─────────────
    // We've created/joined a room but the match hasn't started. Render the
    // current frame but don't step the sim or collect input, so the connection
    // panel's "waiting for opponent" message is the only thing in play.
    if (this.awaitingOpponent) {
      this.gfx.clear();
      this.drawArena();
      this.drawBells();
      this.drawBall(1);
      this.drawPlayers(1);
      this.touch.drawUI();
      this.updateGroupCamera(1);
      return;
    }

    // ── Fail-closed: freeze the scene as a static background ─────────────────
    // The match ended via peer disconnect or server shutdown. Render the last
    // known frame but accept no input — the fail-closed banner covers the scene.
    if (this.matchFailClosed) {
      this.gfx.clear();
      this.drawArena();
      this.drawBells();
      this.drawBall(1);
      this.drawPlayers(1);
      this.touch.drawUI();
      this.updateGroupCamera(1);
      return;
    }

    // ── Local hotseat mode (Phase 1 and earlier) ──────────────────────────────
    // Honor pause flag — don't advance the accumulator while paused (unless a
    // single-step was requested by the HUD).
    const shouldStep = !this.paused || this.doSingleStep;
    if (this.doSingleStep) this.doSingleStep = false;

    if (shouldStep) {
      this.accumulator += delta;
    }

    while (this.accumulator >= this.FIXED_STEP) {
      this.prev = this.cur;
      const inputFrames = this.collectInputFrames();

      // Record frames into capture data if capture is active.
      if (this.captureData) {
        recordFrame(this.captureData, inputFrames);
      }

      // Phase 2 (FLI-9): detect strike-variant + special presses before stepping.
      this.detectStrikeVariantFeedback(inputFrames);
      this.detectSpecialFeedback(inputFrames);

      this.sim.step(inputFrames);
      this.simTick += 1;
      // getRenderState() already returns a fresh object — no clone needed.
      this.cur = this.sim.getRenderState();
      // Drain sim events each tick and surface Bell Ring feedback.
      for (const event of this.sim.drainEvents()) {
        if (event.type === "bellRing") this.onBellRing(event.bell);
        else if (event.type === "matchPhase") this.onMatchPhase(event.phase);
        else if (event.type === "matchEnd")
          this.onMatchEnd(event.winner, event.scores);
        else if (event.type === "playerHit")
          this.onPlayerHit(event.slot, event.knockdown);
        else if (event.type === "knockdown") this.onKnockdown(event.slot);
      }
      this.accumulator -= this.FIXED_STEP;

      // When paused+stepping, only advance exactly one tick.
      if (!shouldStep) break;
    }

    const alpha = this.accumulator / this.FIXED_STEP; // [0,1)

    this.gfx.clear();
    this.drawArena();
    this.drawBells();
    this.drawBall(alpha);
    this.drawPlayers(alpha);
    this.tickBellFeedback(delta);

    // Phase 6: draw touch UI on top of game graphics (pinned layer).
    this.touch.drawUI();

    // Phase 6: update group camera after rendering to frame all subjects.
    this.updateGroupCamera(alpha);

    // Phase 2: update match HUD DOM nodes every render frame.
    this.updateMatchHud(this.sim.getMatchState());
  }

  // ── Phase 6: group camera ────────────────────────────────────────────────────

  private updateGroupCamera(alpha: number): void {
    const s = this.cur;
    const p = this.prev;

    // Interpolated ball position for smoother camera tracking.
    const ballX = lerp(p.ball.x, s.ball.x, alpha);
    const ballY = lerp(p.ball.y, s.ball.y, alpha);

    // Every active player as a camera subject (interpolated). players[] is
    // slot-indexed and SPARSE (e.g. 1v1 template [0, 2] leaves a hole at slot
    // 1); skip holes so we never pass an undefined subject to GroupCamera.
    const subjects: GroupSubject[] = [];
    s.players.forEach((cp, i) => {
      if (!cp) return;
      const pp = p.players[i] ?? cp;
      subjects.push(
        subjectFromWorld(lerp(pp.x, cp.x, alpha), lerp(pp.y, cp.y, alpha)),
      );
    });
    subjects.push(subjectFromWorld(ballX, ballY));
    subjects.push(...this.bellSubjects);

    this.groupCamera.update(subjects);
  }

  /**
   * Bell Ring feedback (obvious, tagged with the side): flash the rung Bell and
   * show a banner. A sound stub is logged so audio can hang off this hook later.
   */
  private onBellRing(bell: "left" | "right"): void {
    this.bellFlash[bell] = 1; // full intensity, decays in tickBellFeedback
    const label = bell === "left" ? "LEFT BELL!" : "RIGHT BELL!";
    this.bellText
      .setText(label)
      .setColor(bell === "left" ? "#66d9ff" : "#ff9966")
      .setAlpha(1);
    // Sound stub — wire real SFX here in a later art/audio pass.
    console.info(`[bellRing] ${bell}`);
  }

  private onMatchPhase(phase: import("@bb/sim").MatchPhase): void {
    console.info(`[match] phase → ${phase}`);
  }

  private onMatchEnd(winner: number | "tie", scores: number[]): void {
    const label = winner === "tie" ? "TIE" : `P${(winner as number) + 1} WINS`;
    console.info(`[match] END — ${label}  ${scores.join("-")}`);
  }

  private onKnockdown(slot: number): void {
    console.info(`[combat] P${slot + 1} knocked down`);
  }

  /** Per-hit feedback: flash the struck player so every connecting strike reads. */
  private onPlayerHit(slot: number, knockdown: boolean): void {
    this.hitFlash[slot] = 1; // full intensity, decays in tickBellFeedback
    console.info(`[combat] P${slot + 1} hit${knockdown ? " (KNOCKDOWN)" : ""}`);
  }

  /** Decay the banner alpha and per-Bell flash intensity over real time. */
  private tickBellFeedback(delta: number): void {
    const decay = delta / 1000; // ~1s fade
    this.bellFlash.left = Math.max(0, this.bellFlash.left - decay);
    this.bellFlash.right = Math.max(0, this.bellFlash.right - decay);
    // Hit flashes fade faster (~0.25s) so rapid exchanges stay readable.
    for (let s = 0; s < this.hitFlash.length; s++) {
      this.hitFlash[s] = Math.max(0, (this.hitFlash[s] ?? 0) - decay * 4);
    }
    if (this.bellText.alpha > 0) {
      this.bellText.setAlpha(Math.max(0, this.bellText.alpha - decay * 0.8));
    }

    // Phase 2 (FLI-9): decay special flash + strike arc flash + variant text.
    for (let s = 0; s < this.specialFlash.length; s++) {
      this.specialFlash[s] = Math.max(
        0,
        (this.specialFlash[s] ?? 0) - decay * 3,
      );
    }
    for (let s = 0; s < this.strikeArcFlash.length; s++) {
      const e = this.strikeArcFlash[s];
      if (e) e.intensity = Math.max(0, e.intensity - decay * 3);
    }
    // Tick down the local special cooldown approximation.
    const ticksPerSec = DEFAULT_CONFIG.tickHz;
    const ticksElapsed = (delta / 1000) * ticksPerSec;
    for (let s = 0; s < this.localSpecialCooldown.length; s++) {
      this.localSpecialCooldown[s] = Math.max(
        0,
        (this.localSpecialCooldown[s] ?? 0) - ticksElapsed,
      );
    }
    // Fade the strike-variant text pop.
    if (this.strikeVariantAlpha > 0) {
      this.strikeVariantAlpha = Math.max(
        0,
        this.strikeVariantAlpha - decay * 1.2,
      );
      this.strikeVariantText.setAlpha(this.strikeVariantAlpha);
    }
  }

  private drawArena(): void {
    this.gfx.fillStyle(0x444444, 1);
    for (const c of FLAT_DOJO.colliders) {
      this.gfx.fillRect(
        toScreenX(c.x - c.halfW),
        toScreenY(c.y + c.halfH),
        c.halfW * 2 * PX_PER_UNIT,
        c.halfH * 2 * PX_PER_UNIT,
      );
    }
  }

  /**
   * Render the two Bells (art shapes only — the hit-zone is intentionally
   * invisible here; the Phase 5 debug overlay draws it). A rung Bell flashes
   * brighter for a moment via bellFlash.
   */
  private drawBells(): void {
    for (const bell of FLAT_DOJO.bells) {
      const art = bell.art;
      const flash = this.bellFlash[bell.id];
      const base = bell.id === "left" ? 0x3aa0c0 : 0xc06a3a;
      const color = flash > 0 ? 0xffffff : base;
      this.gfx
        .fillStyle(color, 1)
        .fillRect(
          toScreenX(art.x - art.halfW),
          toScreenY(art.y + art.halfH),
          art.halfW * 2 * PX_PER_UNIT,
          art.halfH * 2 * PX_PER_UNIT,
        );
      if (flash > 0) {
        this.gfx
          .lineStyle(3, 0xffe066, flash)
          .strokeCircle(
            toScreenX(art.x),
            toScreenY(art.y),
            (art.halfW + 0.4) * PX_PER_UNIT,
          );
      }
    }
  }

  private drawBall(alpha: number): void {
    const x = lerp(this.prev.ball.x, this.cur.ball.x, alpha);
    const y = lerp(this.prev.ball.y, this.cur.ball.y, alpha);
    this.gfx
      .fillStyle(0xffcc00, 1)
      .fillCircle(
        toScreenX(x),
        toScreenY(y),
        this.cur.ball.radius * PX_PER_UNIT,
      );
  }

  /** Render all player slots with distinct colors. */
  private drawPlayers(alpha: number): void {
    for (let s = 0; s < this.cur.players.length; s++) {
      const cp = this.cur.players[s];
      if (!cp) continue;
      const pp = this.prev.players[s] ?? cp;
      const x = lerp(pp.x, cp.x, alpha);
      const y = lerp(pp.y, cp.y, alpha);
      const halfW = DEFAULT_CONFIG.player.halfW;
      const halfH = DEFAULT_CONFIG.player.halfH;
      const colorsEntry = SLOT_COLORS[s] ?? SLOT_COLORS[0];
      const colors = colorsEntry ?? { grounded: 0x33aaff, air: 0x55ccff };

      // Phase 3: combat state overrides base color and alpha.
      let color = cp.grounded ? colors.grounded : colors.air;
      let fillAlpha = 1;
      if (cp.knockedDown) {
        color = 0x888888; // greyed out while knocked down
      }
      if (cp.invulnerable) {
        // Deterministic blink tied to sim tick (not wall clock) — 3 on / 3 off pattern.
        fillAlpha = this.simTick % 6 < 3 ? 0.35 : 1;
      }
      // Per-hit flash: blend toward white so every connecting strike is obvious.
      const flash = this.hitFlash[s] ?? 0;
      if (flash > 0) color = flash > 0.5 ? 0xffffff : 0xffdddd;

      this.gfx
        .fillStyle(color, fillAlpha)
        .fillRect(
          toScreenX(x - halfW),
          toScreenY(y + halfH),
          halfW * 2 * PX_PER_UNIT,
          halfH * 2 * PX_PER_UNIT,
        );
      // Expanding ring on hit for an extra pop of feedback.
      if (flash > 0) {
        this.gfx
          .lineStyle(3, 0xffffff, flash)
          .strokeCircle(
            toScreenX(x),
            toScreenY(y + halfH * 0.25),
            (Math.max(halfW, halfH) + 0.2 + (1 - flash) * 0.6) * PX_PER_UNIT,
          );
      }
      // Facing indicator: a notch on the leading edge (hidden while invisible in blink).
      if (fillAlpha > 0.5) {
        const noseX = toScreenX(x + cp.facing * halfW);
        this.gfx
          .fillStyle(0xffffff, 1)
          .fillCircle(noseX, toScreenY(y + halfH * 0.4), 4);
      }

      this.drawChargeFeedback(x, y, halfW, halfH, cp.charge);

      // Phase 2 (FLI-9): Special press-flash + cooldown ring.
      const sFlash = this.specialFlash[s] ?? 0;
      const sCooldown = this.localSpecialCooldown[s] ?? 0;
      const sCooldownTotal = this.localSpecialCooldownTotal[s] ?? 1;
      this.drawSpecialFeedback(
        x,
        y,
        halfW,
        halfH,
        sFlash,
        sCooldown,
        sCooldownTotal,
      );

      // Phase 2 (FLI-9): strike-variant arc flash.
      const arcEntry = this.strikeArcFlash[s];
      if (arcEntry?.kind && arcEntry.intensity > 0) {
        this.drawStrikeArcFlash(
          x,
          y,
          halfW,
          halfH,
          arcEntry.kind,
          arcEntry.intensity,
        );
      }
    }
  }

  /**
   * Strike charge feedback: a ring around the player whose radius and color
   * intensity grow with the player's charge (ticks). charge is 0 when not
   * charging, so the ring only appears while holding Strike.
   */
  private drawChargeFeedback(
    x: number,
    y: number,
    halfW: number,
    halfH: number,
    charge: number,
  ): void {
    if (charge <= 0) return;
    const max = DEFAULT_CONFIG.strike.maxChargeTicks;
    const t = Math.min(1, charge / max);
    const cx = toScreenX(x);
    const cy = toScreenY(y + halfH * 0.25);
    const baseR = Math.max(halfW, halfH) * PX_PER_UNIT;
    const ringR = baseR + 6 + t * 18;
    // Warmer/brighter as the charge nears full.
    const color = t >= 0.999 ? 0xff5522 : 0xffaa33;
    this.gfx
      .lineStyle(2 + t * 3, color, 0.35 + t * 0.5)
      .strokeCircle(cx, cy, ringR);
  }

  /**
   * Phase 2 (FLI-9): Special press-flash + cooldown ring.
   * flash:       1→0 intensity driven by `specialFlash[]`
   * cooldown:    ticks remaining (approximated locally from press + elapsed)
   * cooldownTotal: ticks at activation (for the fraction calculation)
   *
   * Cooldown ring: a partial arc drawn counter-clockwise, fraction =
   * 1 - cooldown/cooldownTotal (full circle when ready, shrinks on activation).
   */
  private drawSpecialFeedback(
    x: number,
    y: number,
    halfW: number,
    halfH: number,
    flash: number,
    cooldown: number,
    cooldownTotal: number,
  ): void {
    const cx = toScreenX(x);
    const cy = toScreenY(y + halfH * 0.25);
    const baseR = Math.max(halfW, halfH) * PX_PER_UNIT;
    const ringR = baseR + 12;

    // Press flash: gold burst ring.
    if (flash > 0) {
      this.gfx
        .lineStyle(4, 0xffdd44, flash * 0.9)
        .strokeCircle(cx, cy, ringR + (1 - flash) * 10);
    }

    // Cooldown ring: partial arc (full = ready; depleting = cooling down).
    const fraction = cooldownTotal > 0 ? 1 - cooldown / cooldownTotal : 1;
    if (fraction < 0.999) {
      // Draw the "remaining" arc in dim gold; ready portion in bright gold.
      const startAngle = -Math.PI / 2; // top
      const endAngle = startAngle + fraction * Math.PI * 2;
      // Draw ready arc (bright gold).
      if (fraction > 0) {
        this.gfx.lineStyle(2, 0xffdd44, 0.7);
        this.gfx.beginPath();
        this.gfx.arc(cx, cy, ringR, startAngle, endAngle, false);
        this.gfx.strokePath();
      }
      // Draw remaining (cooldown) arc in dim grey.
      if (fraction < 1) {
        this.gfx.lineStyle(2, 0x555533, 0.5);
        this.gfx.beginPath();
        this.gfx.arc(cx, cy, ringR, endAngle, startAngle + Math.PI * 2, false);
        this.gfx.strokePath();
      }
    } else {
      // Fully ready: show a dim gold ring so the player knows it's available.
      this.gfx.lineStyle(1, 0xffdd44, 0.3).strokeCircle(cx, cy, ringR);
    }
  }

  /**
   * Phase 2 (FLI-9): Strike-variant arc flash.
   * spike = downward red arc, header = upward arc, charged = brighter/larger.
   */
  private drawStrikeArcFlash(
    x: number,
    y: number,
    halfW: number,
    halfH: number,
    kind: "spike" | "header" | "charged",
    intensity: number,
  ): void {
    const cx = toScreenX(x);
    const cy = toScreenY(y + halfH * 0.25);
    const baseR = Math.max(halfW, halfH) * PX_PER_UNIT;
    const r = baseR + 8 + (1 - intensity) * 14;

    if (kind === "spike") {
      // Downward red arc (lower half).
      this.gfx.lineStyle(3, 0xff3322, intensity * 0.9);
      this.gfx.beginPath();
      this.gfx.arc(cx, cy, r, 0, Math.PI, false); // bottom semicircle
      this.gfx.strokePath();
    } else if (kind === "header") {
      // Upward cyan arc (upper half).
      this.gfx.lineStyle(3, 0x44ddff, intensity * 0.9);
      this.gfx.beginPath();
      this.gfx.arc(cx, cy, r, Math.PI, Math.PI * 2, false); // top semicircle
      this.gfx.strokePath();
    } else {
      // Charged: full bright orange circle, larger.
      this.gfx
        .lineStyle(4, 0xff8800, intensity * 0.9)
        .strokeCircle(cx, cy, r + 6);
    }
  }

  /**
   * Phase 2 (FLI-9): Detect strike-variant feedback for a single slot from its
   * input frame + the pre-step render state. Cosmetic only. Shared by the hotseat
   * loop (per active slot) and the networked path (local slot only).
   *
   * `render` MUST be the state BEFORE the slot's step this tick, so the charge
   * accumulated while holding is still present on the release tick.
   */
  private detectStrikeVariantForSlot(
    inp: InputFrame,
    slot: number,
    render: RenderState,
  ): void {
    if (!inp.strikeReleased) return;
    const player = render.players[slot];
    if (!player) return;

    // Detect variant from the state at release (charge is in the sim render state).
    // charge > maxChargeTicks*0.85 → CHARGED!
    // airborne + moveY < 0 → SPIKE!
    // airborne + moveY >= 0 → HEADER!
    const charge = player.charge;
    const maxCharge = DEFAULT_CONFIG.strike.maxChargeTicks;
    const isAirborne = !player.grounded;
    let kind: "spike" | "header" | "charged" | null = null;
    let label = "";
    let color = "#ff8844";

    if (charge >= maxCharge * 0.85) {
      kind = "charged";
      label = "CHARGED!";
      color = "#ff8800";
    } else if (isAirborne && inp.moveY < 0) {
      kind = "spike";
      label = "SPIKE!";
      color = "#ff3322";
    } else if (isAirborne) {
      kind = "header";
      label = "HEADER!";
      color = "#44ddff";
    }

    if (kind !== null) {
      this.strikeArcFlash[slot] = { kind, intensity: 1 };
      // Show the text pop (shared; last writer wins if two players strike simultaneously).
      this.strikeVariantText.setText(label).setColor(color).setAlpha(1);
      this.strikeVariantAlpha = 1;
      console.info(`[strike] P${slot + 1}: ${label}`);
    }
  }

  /**
   * Phase 2 (FLI-9): Detect a Special press for a single slot and update the
   * local cooldown approximation. Cosmetic only — no sim coupling. Shared by the
   * hotseat loop and the networked path.
   */
  private detectSpecialForSlot(inp: InputFrame, slot: number): void {
    if (!inp.specialPressed) return;
    // Only activate if our local cooldown approximation says it's ready.
    if ((this.localSpecialCooldown[slot] ?? 0) > 0) return;
    // We don't have per-slot cooldownTicks here (no character access in render).
    // Use a default approximation based on Panda (130 ticks). This is cosmetic.
    const approxCooldown = 130;
    this.specialFlash[slot] = 1;
    this.localSpecialCooldown[slot] = approxCooldown;
    this.localSpecialCooldownTotal[slot] = approxCooldown;
  }

  /**
   * Hotseat: run strike-variant detection for every collected slot. `inputFrames`
   * is indexed the same way the sim consumes it; `this.cur` is the pre-step state.
   */
  private detectStrikeVariantFeedback(inputFrames: InputFrame[]): void {
    for (let s = 0; s < inputFrames.length; s++) {
      const inp = inputFrames[s];
      if (inp) this.detectStrikeVariantForSlot(inp, s, this.cur);
    }
  }

  /** Hotseat: run Special detection for every collected slot. */
  private detectSpecialFeedback(inputFrames: InputFrame[]): void {
    for (let s = 0; s < inputFrames.length; s++) {
      const inp = inputFrames[s];
      if (inp) this.detectSpecialForSlot(inp, s);
    }
  }

  shutdown(): void {
    this.orientationOverlay?.destroy();
    this.connectionOverlay?.destroy();
    // Removing the overlay removes all match HUD nodes (its children) with it.
    this.hudOverlay?.remove();
    // Phase 5: stop telemetry timer if running.
    if (this.telemetryTimer !== null) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    // Phase 4: remove the net-sim-config listener if one was registered.
    if (this.netSimConfigHandler !== null) {
      document.removeEventListener("net-sim-config", this.netSimConfigHandler);
      this.netSimConfigHandler = null;
    }
  }
}
