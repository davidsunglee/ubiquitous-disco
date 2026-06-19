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

export class RapierWorld {
  readonly world: WorldInstance;
  readonly player: RigidBodyInstance;
  readonly playerCollider: ColliderInstance;
  readonly controller: CharacterControllerInstance;
  readonly ball: RigidBodyInstance;

  constructor(config: SimConfig, arena: ArenaDef) {
    const R = getRapier();
    this.world = new R.World({ x: 0, y: config.gravityY });
    this.world.timestep = 1 / config.tickHz; // default is 1/60

    // 1) arena colliders — fixed order
    for (const c of arena.colliders) {
      this.world.createCollider(
        R.ColliderDesc.cuboid(c.halfW, c.halfH).setTranslation(c.x, c.y),
      );
    }

    // 2) player — kinematic-position body inserted AFTER arena colliders
    this.player = this.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(
        arena.playerSpawn.x,
        arena.playerSpawn.y,
      ),
    );
    this.playerCollider = this.world.createCollider(
      R.ColliderDesc.cuboid(config.player.halfW, config.player.halfH),
      this.player,
    );

    // 3) ball dynamic body — inserted AFTER the player, every run. CCD (swept
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
        .setMass(config.ball.mass),
      this.ball,
    );

    // Character controller (collide-and-slide). Up is +Y per the coordinate
    // invariant. A small offset keeps the controller numerically stable. The
    // controller applies impulses to dynamic bodies it slides into, which is how
    // the player makes light body-contact with the ball while walking.
    this.controller = this.world.createCharacterController(0.01);
    this.controller.setUp({ x: 0, y: 1 });
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.enableSnapToGround(0.1);
  }

  step(): void {
    this.world.step();
  }

  /**
   * Move the player by `dx, dy` (world units) this tick using collide-and-slide,
   * then commit the resulting translation to the kinematic body. Returns the
   * actually-applied movement and whether the controller reports grounded.
   *
   * By default dynamic bodies (the ball) are included, so the player body lightly
   * contacts and pushes the ball as it walks/jumps into it. On a Tele-Dash tick
   * the whole movement (walk + blink) is swept with `excludeDynamic` so the blink
   * passes the ball rather than shoving it.
   */
  movePlayer(
    dx: number,
    dy: number,
    excludeDynamic = false,
  ): { movedX: number; movedY: number; grounded: boolean } {
    const R = getRapier();
    this.controller.computeColliderMovement(
      this.playerCollider,
      { x: dx, y: dy },
      excludeDynamic ? R.QueryFilterFlags.EXCLUDE_DYNAMIC : undefined,
    );
    const corrected = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();
    const t = this.player.translation();
    this.player.setNextKinematicTranslation({
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

  playerPos(): { x: number; y: number } {
    const t = this.player.translation();
    return { x: t.x, y: t.y };
  }

  ballPos(): { x: number; y: number } {
    const t = this.ball.translation();
    return { x: t.x, y: t.y };
  }

  takeSnapshot(): Uint8Array {
    return this.world.takeSnapshot();
  }

  /**
   * Replace the current Rapier world with the state from a previously taken
   * snapshot. JS-side objects (character controller, rigid body handles etc.)
   * are re-bound from the restored world. The restored world has the same
   * body/collider insertion order as the original, so handles are stable.
   */
  restoreSnapshot(bytes: Uint8Array): void {
    const R = getRapier();
    // World.restoreSnapshot() is static and returns a brand-new World.
    const restored = R.World.restoreSnapshot(bytes);
    // Swap the world reference (type cast — the readonly is only for external callers).
    (this as { world: WorldInstance }).world = restored;
    // Re-bind rigid body handles. Insertion order: arena colliders → player → ball.
    // The player was the first dynamic/kinematic body inserted, ball was second.
    const bodies: RigidBodyInstance[] = [];
    restored.forEachRigidBody((b) => bodies.push(b));
    // Player is the first kinematic body (index 0), ball is the dynamic (index 1).
    // We rely on the fact that arena colliders are all fixed (no rigid body), so
    // the only rigid bodies are player + ball in insertion order.
    const playerBody = bodies[0];
    const ballBody = bodies[1];
    if (!playerBody || !ballBody) {
      throw new Error(
        "restoreSnapshot: expected 2 rigid bodies (player, ball)",
      );
    }
    (this as { player: RigidBodyInstance }).player = playerBody;
    (this as { ball: RigidBodyInstance }).ball = ballBody;

    // Re-bind colliders. The player collider is the first collider attached to
    // the player body; the ball collider is the first attached to the ball body.
    const playerCol = playerBody.collider(0);
    if (!playerCol) {
      throw new Error("restoreSnapshot: player collider not found");
    }
    (this as { playerCollider: ColliderInstance }).playerCollider = playerCol;

    // Re-create the character controller (not serialized by Rapier snapshot).
    restored.removeCharacterController(this.controller);
    const ctrl = restored.createCharacterController(0.01);
    ctrl.setUp({ x: 0, y: 1 });
    ctrl.setApplyImpulsesToDynamicBodies(true);
    ctrl.enableSnapToGround(0.1);
    (this as { controller: CharacterControllerInstance }).controller = ctrl;
  }
}
