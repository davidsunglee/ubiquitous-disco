import type RAPIER_TYPE from "@dimforge/rapier2d-deterministic-compat";
import type { ArenaDef } from "./arena";
import type { SimConfig } from "./config";
import { getRapier } from "./rapier";

type WorldInstance = InstanceType<typeof RAPIER_TYPE.World>;
type RigidBodyInstance = InstanceType<typeof RAPIER_TYPE.RigidBody>;
type ColliderInstance = InstanceType<typeof RAPIER_TYPE.Collider>;
type CharacterControllerInstance = InstanceType<
  typeof RAPIER_TYPE.KinematicCharacterController
>;

// Collision-group memberships (high 16 bits) and filters (low 16 bits).
// Players pass through each other but collide with arena + ball.
const GROUP_ARENA = 0x0001;
const GROUP_PLAYER = 0x0002;
const GROUP_BALL = 0x0004;
function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

const ARENA_GROUPS = groups(
  GROUP_ARENA,
  GROUP_ARENA | GROUP_PLAYER | GROUP_BALL,
);
const PLAYER_GROUPS = groups(GROUP_PLAYER, GROUP_ARENA | GROUP_BALL); // excludes PLAYER
const BALL_GROUPS = groups(GROUP_BALL, GROUP_ARENA | GROUP_PLAYER | GROUP_BALL);

export class RapierWorld {
  readonly world: WorldInstance;
  readonly players: RigidBodyInstance[];
  readonly playerColliders: ColliderInstance[];
  readonly controllers: CharacterControllerInstance[];
  readonly ball: RigidBodyInstance;
  /** Active Player Slots, ascending. Bodies exist only at these indices. */
  private readonly activeSlots: number[];

  constructor(
    config: SimConfig,
    arena: ArenaDef,
    activeSlots: number[] = [0, 2],
  ) {
    this.activeSlots = activeSlots.slice().sort((a, b) => a - b);
    const R = getRapier();
    this.world = new R.World({ x: 0, y: config.gravityY });
    this.world.timestep = 1 / config.tickHz; // default is 1/60

    // 1) arena colliders — fixed order
    for (const c of arena.colliders) {
      this.world.createCollider(
        R.ColliderDesc.cuboid(c.halfW, c.halfH)
          .setTranslation(c.x, c.y)
          .setCollisionGroups(ARENA_GROUPS),
      );
    }

    // 2) players — kinematic bodies inserted in fixed ACTIVE slot order, AFTER
    //    arena colliders and BEFORE the ball. This order is the determinism
    //    contract. Bodies are stored at their slot index so players[slot] is
    //    always slot-keyed (sparse array).
    this.players = [];
    this.playerColliders = [];
    this.controllers = [];
    for (const s of this.activeSlots) {
      const spawn = arena.playerSpawns[s];
      if (!spawn) continue;
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(
          spawn.x,
          spawn.y,
        ),
      );
      const col = this.world.createCollider(
        R.ColliderDesc.cuboid(
          config.player.halfW,
          config.player.halfH,
        ).setCollisionGroups(PLAYER_GROUPS),
        body,
      );
      const ctrl = this.world.createCharacterController(0.01);
      ctrl.setUp({ x: 0, y: 1 });
      ctrl.setApplyImpulsesToDynamicBodies(true);
      ctrl.enableSnapToGround(0.1);
      this.players[s] = body;
      this.playerColliders[s] = col;
      this.controllers[s] = ctrl;
    }

    // 3) ball dynamic body — inserted AFTER both players, every run. CCD (swept
    // collision) is enabled: a hard Strike can drive the ball faster than a wall
    // is thick per tick, which a discrete solver would tunnel straight through.
    this.ball = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(arena.ballSpawn.x, arena.ballSpawn.y)
        .setGravityScale(config.ball.gravityScale)
        .setLinearDamping(config.ball.linearDamping)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      R.ColliderDesc.ball(config.ball.radius)
        .setRestitution(config.ball.restitution)
        .setMass(config.ball.mass)
        .setCollisionGroups(BALL_GROUPS),
      this.ball,
    );
  }

  step(): void {
    this.world.step();
  }

  /**
   * Move a player by `dx, dy` (world units) this tick using collide-and-slide,
   * then commit the resulting translation to the kinematic body. Returns the
   * actually-applied movement and whether the controller reports grounded.
   *
   * By default dynamic bodies (the ball) are included, so the player body lightly
   * contacts and pushes the ball as it walks/jumps into it. On a Tele-Dash tick
   * the whole movement (walk + blink) is swept with `excludeDynamic` so the blink
   * passes the ball rather than shoving it.
   *
   * Players also pass through each other (PLAYER_GROUPS excludes PLAYER from its
   * filter), so the excludeDynamic flag on dash is only needed for ball pass-through.
   */
  movePlayer(
    slot: number,
    dx: number,
    dy: number,
    excludeDynamic = false,
  ): { movedX: number; movedY: number; grounded: boolean } {
    const R = getRapier();
    const ctrl = this.controllers[slot];
    const col = this.playerColliders[slot];
    const body = this.players[slot];
    if (!ctrl || !col || !body) {
      throw new Error(`movePlayer: invalid slot ${slot}`);
    }
    // Pass the PLAYER_GROUPS filter so the character controller sweep respects
    // the same collision group settings as the collider itself — in particular,
    // players (GROUP_PLAYER) are excluded from each other's filter.
    ctrl.computeColliderMovement(
      col,
      { x: dx, y: dy },
      excludeDynamic ? R.QueryFilterFlags.EXCLUDE_DYNAMIC : undefined,
      PLAYER_GROUPS,
    );
    const corrected = ctrl.computedMovement();
    const grounded = ctrl.computedGrounded();
    const t = body.translation();
    body.setNextKinematicTranslation({
      x: t.x + corrected.x,
      y: t.y + corrected.y,
    });
    return { movedX: corrected.x, movedY: corrected.y, grounded };
  }

  /** Apply an impulse (world units) to the ball, waking it. */
  applyBallImpulse(ix: number, iy: number): void {
    this.ball.applyImpulse({ x: ix, y: iy }, true);
  }

  ballVel(): { x: number; y: number } {
    const v = this.ball.linvel();
    return { x: v.x, y: v.y };
  }

  setBallVel(vx: number, vy: number): void {
    this.ball.setLinvel({ x: vx, y: vy }, true);
  }

  /**
   * Teleport the ball to (x, y) and optionally zero its velocity.
   * Used by the lightweight authoritative-state apply path (Phase 2+).
   */
  setBallPosition(x: number, y: number): void {
    this.ball.setTranslation({ x, y }, true);
  }

  /**
   * Teleport a kinematic player body to (x, y).
   * Used by the lightweight authoritative-state apply path (Phase 2+).
   * Both setTranslation (committed) and setNextKinematicTranslation (next-step
   * target) are written so the controller and physics both agree on the new pose.
   */
  setPlayerPosition(slot: number, x: number, y: number): void {
    const body = this.players[slot];
    if (!body) throw new Error(`setPlayerPosition: invalid slot ${slot}`);
    body.setTranslation({ x, y }, true);
    body.setNextKinematicTranslation({ x, y });
  }

  playerPos(slot: number): { x: number; y: number } {
    const body = this.players[slot];
    if (!body) throw new Error(`playerPos: invalid slot ${slot}`);
    const t = body.translation();
    return { x: t.x, y: t.y };
  }

  ballPos(): { x: number; y: number } {
    const t = this.ball.translation();
    return { x: t.x, y: t.y };
  }

  /**
   * Teleport both players to their spawns and the ball to its spawn (zeroed vel).
   * Called at the start of each round reset (Phase 2+).
   */
  resetPositions(arena: ArenaDef): void {
    for (const s of this.activeSlots) {
      const spawn = arena.playerSpawns[s];
      if (!spawn) continue;
      this.players[s]?.setNextKinematicTranslation({ x: spawn.x, y: spawn.y });
      this.players[s]?.setTranslation({ x: spawn.x, y: spawn.y }, true);
    }
    this.ball.setTranslation(
      { x: arena.ballSpawn.x, y: arena.ballSpawn.y },
      true,
    );
    this.ball.setLinvel({ x: 0, y: 0 }, true);
    this.ball.setAngvel(0, true);
  }

  takeSnapshot(): Uint8Array {
    return this.world.takeSnapshot();
  }

  /**
   * Replace the current Rapier world with the state from a previously taken
   * snapshot. JS-side objects (character controllers, rigid body handles etc.)
   * are re-bound from the restored world. The restored world has the same
   * body/collider insertion order as the original, so handles are stable.
   *
   * Insertion order: arena colliders (no body) → player0 → player1 → ball.
   * restoreSnapshot rebinds N+1 rigid bodies and re-creates all N controllers.
   */
  restoreSnapshot(bytes: Uint8Array): void {
    const R = getRapier();
    // World.restoreSnapshot() is static and returns a brand-new World.
    const restored = R.World.restoreSnapshot(bytes);
    // Swap the world reference (type cast — the readonly is only for external callers).
    (this as { world: WorldInstance }).world = restored;
    // Re-bind rigid body handles. Insertion order: arena colliders → active
    // player bodies (ascending slot order) → ball. This is the determinism contract.
    const bodies: RigidBodyInstance[] = [];
    restored.forEachRigidBody((b) => bodies.push(b));

    const n = this.activeSlots.length; // number of active player bodies
    if (bodies.length !== n + 1) {
      throw new Error(
        `restoreSnapshot: expected ${n + 1} rigid bodies (players + ball), got ${bodies.length}`,
      );
    }

    // bodies[] is in insertion order == ascending active-slot order.
    const newPlayers: RigidBodyInstance[] = [];
    const newCols: ColliderInstance[] = [];
    this.activeSlots.forEach((slot, i) => {
      const body = bodies[i];
      if (!body)
        throw new Error(`restoreSnapshot: body for slot ${slot} not found`);
      const col = body.collider(0);
      if (!col)
        throw new Error(`restoreSnapshot: player ${slot} collider not found`);
      newPlayers[slot] = body;
      newCols[slot] = col;
    });
    const ballBody = bodies[n];
    if (!ballBody) throw new Error("restoreSnapshot: ball body not found");

    (this as { players: RigidBodyInstance[] }).players = newPlayers;
    (this as { playerColliders: ColliderInstance[] }).playerColliders = newCols;
    (this as { ball: RigidBodyInstance }).ball = ballBody;

    // Re-create all character controllers (not serialized by Rapier snapshot).
    // Remove old controllers first, then create one per active slot.
    for (const c of this.controllers) {
      if (c) restored.removeCharacterController(c);
    }
    const newControllers: CharacterControllerInstance[] = [];
    for (const slot of this.activeSlots) {
      const ctrl = restored.createCharacterController(0.01);
      ctrl.setUp({ x: 0, y: 1 });
      ctrl.setApplyImpulsesToDynamicBodies(true);
      ctrl.enableSnapToGround(0.1);
      newControllers[slot] = ctrl;
    }
    (this as { controllers: CharacterControllerInstance[] }).controllers =
      newControllers;
  }
}
