import {
  createReplay,
  createSimulation,
  DEFAULT_CONFIG,
  deserializeReplay,
  FLAT_DOJO,
  type InputFrame,
  type MatchState,
  playReplay,
  type RenderState,
  type ReplayData,
  recordFrame,
  type SimConfig,
  type Simulation,
  serializeReplay,
} from "@bb/sim";
import Phaser from "phaser";
import {
  KeyboardAdapter,
  NET_KEYMAP,
  P1_KEYMAP,
  P2_KEYMAP,
} from "../input/KeyboardAdapter";
import { mergeInputFrames, TouchAdapter } from "../input/TouchAdapter";
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

// Distinct colors for slot 0 and slot 1 (grounded / airborne variants).
const SLOT_COLORS = [
  { grounded: 0x33aaff, air: 0x55ccff }, // P1: blue
  { grounded: 0xff7755, air: 0xff9977 }, // P2: orange
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
  /** Phase 4: dev network simulator (dev-only). */
  private simTransport: SimulatedTransport | null = null;

  /** Phase 5: telemetry interval handle (clearInterval on shutdown). */
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;

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

    const s = this.sim.getRenderState();
    this.prev = structuredClone(s);
    this.cur = structuredClone(s);

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

    // Wire up the HUD bridge so HudScene can control us.
    this.wireHudBridge();

    // Phase 2: inject match HUD DOM nodes so Playwright can locate them.
    this.createMatchHudNodes();

    // Phase 1: mount the connection/room overlay and wire it to a NetClient.
    this.netClient = new NetClient();
    this.connectionOverlay = new ConnectionOverlay();
    this.connectionOverlay.mount();
    this.connectionOverlay.wire(
      this.netClient,
      this.game.canvas,
      (slot) => {
        // Phase 2: room is full — switch to networked mode.
        this.startNetLoop(slot);
      },
      () => {
        // Created/joined a room; freeze the local sim until the match begins so
        // stray input can't kick off a phantom local match behind the panel.
        this.awaitingOpponent = true;
        this.startPromptEl.style.display = "none";
      },
    );

    // Launch the HUD in parallel (it renders on top without replacing GameScene).
    this.scene.launch("HudScene");
  }

  // ── Phase 2: match HUD DOM nodes ─────────────────────────────────────────────

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
    this.startPromptEl.style.display =
      m.phase === "preRound" ? "block" : "none";
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
        // Networked: each screen shows its own outcome (one player per client).
        winnerText = m.winner === this.netClient.slot ? "YOU WIN" : "YOU LOSE";
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

  private startNetLoop(slot: import("@bb/protocol").Slot): void {
    // The match is starting — leave the awaiting-opponent freeze state.
    this.awaitingOpponent = false;

    // Phase 4: create a dev-only SimulatedTransport and register it on the
    // hudBridge so HUD sliders can tune it live.
    this.simTransport = new SimulatedTransport(this.netClient);

    // Dev/e2e hook: let tests tune the simulator without driving Phaser-canvas
    // sliders. `net-latency.spec.ts` dispatches this CustomEvent to apply
    // latency in each tab; the HUD sliders are the manual equivalent.
    document.addEventListener("net-sim-config", (e) => {
      const detail = (e as CustomEvent<NetSimPatch>).detail;
      if (detail) this.simTransport?.applyPatch(detail);
    });

    this.netLoop = new NetLoop(
      this.netClient,
      slot,
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
      },
      this.simTransport,
    );
    this.netLoop.start();
    console.info(`[net] NetLoop started (slot ${slot})`);

    // Phase 5: fail-closed — stop the net loop and show the banner on any
    // peer disconnect, server shutdown, or WebSocket error.
    this.netClient.onFailClosed((reason) => {
      console.info(`[net] fail-closed: ${reason}`);
      // Stop the net loop so no more predicted ticks or sends happen.
      this.netLoop = null;
      // Freeze the scene so stray input can't interact with the frozen state.
      this.matchFailClosed = true;
      // Show the fail-closed banner and update the status badge.
      this.connectionOverlay.showFailClosed(reason);
    });

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
    return createSimulation({ config, arena: FLAT_DOJO, seed: 1234 });
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
    const s = this.sim.getRenderState();
    this.prev = structuredClone(s);
    this.cur = structuredClone(s);
    this.bellFlash = { left: 0, right: 0 };
    this.bellText.setAlpha(0).setText("");
  }

  private startReplay(json: string): void {
    this.captureData = null;
    this.accumulator = 0;
    this.simTick = 0;
    this.liveConfig = { ...DEFAULT_CONFIG };
    this.sim = this.buildSim(this.liveConfig);
    const s = this.sim.getRenderState();
    this.prev = structuredClone(s);
    this.cur = structuredClone(s);
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
    return [p1, p2];
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

      // Override the remote player's render position from the interpolation
      // buffer so it moves smoothly independent of the prediction sim.
      // We do this by patching prev/cur just before drawing.
      const remoteSample = this.netLoop.sampleRemoteRender();
      if (remoteSample !== null) {
        const remoteSlot = localSlot === 0 ? 1 : 0;
        // Patch the current render state for the remote slot.
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

      this.sim.step(inputFrames);
      this.simTick += 1;
      this.cur = structuredClone(this.sim.getRenderState());
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

    const subjects = [
      // Both players as camera subjects (interpolated).
      ...s.players.map((cp, i) => {
        const pp = p.players[i] ?? cp;
        return subjectFromWorld(
          lerp(pp.x, cp.x, alpha),
          lerp(pp.y, cp.y, alpha),
        );
      }),
      subjectFromWorld(ballX, ballY),
      ...this.bellSubjects,
    ];

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
  }
}
