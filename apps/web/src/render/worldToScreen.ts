export const PX_PER_UNIT = 48;
const ORIGIN_X = 480; // canvas 960 wide → world x=0 centered
const ORIGIN_Y = 480; // world y=0 near bottom

export const toScreenX = (worldX: number) => ORIGIN_X + worldX * PX_PER_UNIT;
export const toScreenY = (worldY: number) => ORIGIN_Y - worldY * PX_PER_UNIT; // flip
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
