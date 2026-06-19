import type RAPIER_TYPE from "@dimforge/rapier2d-deterministic-compat";
import type { ArenaDef } from "./arena";
import type { SimConfig } from "./config";
import { getRapier } from "./rapier";

type WorldInstance = InstanceType<typeof RAPIER_TYPE.World>;
type RigidBodyInstance = InstanceType<typeof RAPIER_TYPE.RigidBody>;

export class RapierWorld {
  readonly world: WorldInstance;
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
    // 2) ball dynamic body — inserted AFTER colliders, every run
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
  }

  step(): void {
    this.world.step();
  }

  ballPos(): { x: number; y: number } {
    const t = this.ball.translation();
    return { x: t.x, y: t.y };
  }

  takeSnapshot(): Uint8Array {
    return this.world.takeSnapshot();
  }
}
