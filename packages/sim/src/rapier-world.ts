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

    // 3) ball dynamic body — inserted AFTER the player, every run
    this.ball = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(arena.ballSpawn.x, arena.ballSpawn.y)
        .setGravityScale(config.ball.gravityScale)
        .setLinearDamping(config.ball.linearDamping),
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
   * Dynamic bodies (the ball) are no longer excluded, so the player body lightly
   * contacts and pushes the ball as it walks/jumps into it.
   */
  movePlayer(
    dx: number,
    dy: number,
  ): { movedX: number; movedY: number; grounded: boolean } {
    this.controller.computeColliderMovement(this.playerCollider, {
      x: dx,
      y: dy,
    });
    const corrected = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();
    const t = this.player.translation();
    this.player.setNextKinematicTranslation({
      x: t.x + corrected.x,
      y: t.y + corrected.y,
    });
    return { movedX: corrected.x, movedY: corrected.y, grounded };
  }

  /**
   * Teleport the player instantly by (dx, dy) world units (Tele-Dash blink). The
   * kinematic body is moved through both its current and next translation so the
   * jump is honored on the very next step without a collide-and-slide sweep.
   */
  teleportPlayer(dx: number, dy: number): void {
    const t = this.player.translation();
    const next = { x: t.x + dx, y: t.y + dy };
    this.player.setTranslation(next, true);
    this.player.setNextKinematicTranslation(next);
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
}
