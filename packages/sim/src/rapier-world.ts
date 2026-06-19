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
      R.RigidBodyDesc.dynamic().setTranslation(
        arena.ballSpawn.x,
        arena.ballSpawn.y,
      ),
    );
    this.world.createCollider(
      R.ColliderDesc.ball(config.ball.radius).setRestitution(
        config.ball.restitution,
      ),
      this.ball,
    );
    this.ball.setLinearDamping(config.ball.linearDamping);

    // Character controller (collide-and-slide). Up is +Y per the coordinate
    // invariant. A small offset keeps the controller numerically stable.
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
   */
  movePlayer(
    dx: number,
    dy: number,
  ): { movedX: number; movedY: number; grounded: boolean } {
    const R = getRapier();
    this.controller.computeColliderMovement(
      this.playerCollider,
      { x: dx, y: dy },
      R.QueryFilterFlags.EXCLUDE_DYNAMIC, // ignore the ball when walking/jumping
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
