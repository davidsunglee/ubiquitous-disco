// ── Shared types ──────────────────────────────────────────────────────────────

export type Slot = 0 | 1;

// ── Room lifecycle messages (Phase 1) ─────────────────────────────────────────

export interface RoomReady {
  type: "RoomReady";
  slot: Slot;
  full: boolean;
}

export interface RoomErrorMsg {
  type: "RoomError";
  code: string;
  message: string;
}

// grows in later phases
export type ServerMessage = RoomReady | RoomErrorMsg;

// ── (De)serializers ───────────────────────────────────────────────────────────

export const serializeRoomReady = (m: RoomReady): string => JSON.stringify(m);
export const deserializeRoomReady = (s: string): RoomReady =>
  JSON.parse(s) as RoomReady;
