# Bell Brawl

Bell Brawl is an original browser-first 2D fighting-sports game where one or two players per team try to ring the opposing team's elevated Bell with a shared ball.

## Language

**Bell Brawl**:
The original game being built in this repository.
_Avoid_: Kung Fu Kickball as the project name, BellBrawl as the canonical spelling

**Reference Game**:
Kung Fu Kickball, used as a reference for genre lessons and mechanical inspiration only.
_Avoid_: Treating the reference game as a source of copied assets, code, names, or layouts

**Match**:
A single Bell Brawl contest played in one Match Mode, from pre-round through completion.
_Avoid_: Room, lobby, game session

**Match Mode**:
The official team shape for a match, either 1v1 or 2v2.
_Avoid_: Uneven mode, free-for-all

**Roster**:
The selectable set of Characters available for a Match.
_Avoid_: Team, faction

**Character**:
A playable rules profile selected for a Player Slot, with stat multipliers, capabilities, and one cooldown Special.
_Avoid_: Class, fighter, final character identity

**Team**:
A side in a match that defends one Bell and scores by ringing the opposing Bell.
_Avoid_: Faction, class, roster

**Player Slot**:
A playable position in a Match Mode that can be occupied by a human or a Practice Bot.
_Avoid_: Uneven team, empty player

**Practice Bot**:
A simple bot-controlled Player Slot used for private matches and testing.
_Avoid_: Ranked bot, AI teammate, tactical AI

**Private Lobby**:
A host-controlled pre-match room where humans join slots, fill bot slots, choose allowed settings, and start a match.
_Avoid_: Ranked queue, public matchmaking

**Host Player**:
The human in a Private Lobby who controls match settings and starts the match.
_Avoid_: Admin, moderator

**Join Code**:
A short shareable code used to enter a Private Lobby.
_Avoid_: Colyseus room id

**Local Profile**:
An anonymous browser-local identity used for display name, lobby presence, and short-window Player Slot reclaim.
_Avoid_: Account, login, persistent profile

**Arena**:
The playable space for a Match, containing spawn points, terrain, Bells, and Bell Hit-Zones.
_Avoid_: Map, level, stage

**Bell**:
The physical elevated scoring target defended by a Team.
_Avoid_: Gong, goal when referring to the target

**Bell Hit-Zone**:
The scoring area associated with a Bell, separate from visible Bell art and able to grow during the Overtime Pressure Ramp.
_Avoid_: Bell art, physics collider, Rapier sensor

**Bell Ring**:
The scoring event that occurs when the ball contacts a defended Bell Hit-Zone.
_Avoid_: Goal, point when referring to the event

**Golden Goal**:
The tied-post-regulation match phase where the next Bell Ring ends the Match.
_Avoid_: Overtime, sudden death when referring to the phase

**Mirrored Scoring Puzzle**:
A left-right mirrored arena layout that creates a distinct path or obstacle problem for ringing the opposing Bell.
_Avoid_: Symmetric arena when it could imply every arena plays the same

**Overtime Pressure Ramp**:
The Golden Goal rule where Bell Hit-Zones visibly grow over time to force match resolution.
_Avoid_: Overtime hazard, sudden death when referring to the ramp

**Strike**:
The core intentional action that applies meaningful impulse to the ball or Stagger/Knockback to players.
_Avoid_: Attack, damage, kick when referring to the general action

**Header**:
An airborne Strike variant that redirects the ball upward or horizontally.
_Avoid_: Air redirect as the canonical term

**Spike**:
An airborne downward Strike variant that drives the ball downward.
_Avoid_: Downward attack, dunk

**Jump**:
The core action for variable-height vertical movement.
_Avoid_: Hop as the canonical action name

**Tele-Dash**:
The core action for a short fixed-distance blink in the facing or stick direction.
_Avoid_: Sprint, roll, velocity dash

**Special**:
A character-specific cooldown action triggered by the dedicated Special input.
_Avoid_: Chord, super unless a future design creates that term

**Stagger**:
A temporary accumulated pressure value from Strikes that can lead to Knockdown.
_Avoid_: HP, health, damage as player state

**Knockdown**:
The temporary out-of-play state reached when Stagger crosses its threshold.
_Avoid_: Death, elimination, stun when referring to the canonical state

**Recovery Invulnerability**:
A brief protection window after a player exits Knockdown.
_Avoid_: Spawn shield unless it applies only after scoring resets

**Friendly Fire**:
The rule that allied Strikes can apply full-strength Stagger and Knockback to teammates.
_Avoid_: Team damage reduction

**Readable Prototype Art Pass**:
A cohesive placeholder visual/audio polish pass that improves readability without committing to final art direction or production assets.
_Avoid_: Programmer art when referring to the Phase 6 visual target, production art

**Match Summary**:
A structured post-match record of outcome, picks, Bell Rings, combat events, bot slots, and network/balance signals.
_Avoid_: Leaderboard, persistent stats, analytics profile

## Relationships

- A **Match Mode** defines the number of **Player Slots** per **Team**.
- A **Player Slot** can be occupied by a human or a **Practice Bot**.
- A **Team** defends one **Bell**.
- A **Bell Ring** scores one point for the Team opposing the defended **Bell** that was hit.
- An **Arena** contains two **Bells**, each with a **Bell Hit-Zone** defended by one **Team**.
- **Golden Goal** starts when regulation ends tied, and the **Overtime Pressure Ramp** modifies **Bell Hit-Zones** during **Golden Goal**.
- A **Roster** contains **Characters**, and each active **Player Slot** selects one **Character** before the **Match** starts.
- A **Join Code** grants access to a **Private Lobby**, not directly to a **Match**.
- A **Strike** can affect the ball, opponents, and teammates under **Friendly Fire**.
- **Stagger** can produce **Knockdown**, and **Knockdown** ends with **Recovery Invulnerability**.
- A **Private Lobby** is controlled by a **Host Player** until host ownership transfers.
- A **Mirrored Scoring Puzzle** must give both Teams equivalent access and obstacles within the same arena.

## Example Dialogue

> **Dev:** "A three-human 2v2 has one uneven Team, right?"
> **Domain expert:** "No. The **Match Mode** is still 2v2. One **Player Slot** is occupied by a **Practice Bot**."
>
> **Dev:** "When a player hits their own **Bell**, who gets the point?"
> **Domain expert:** "That is still a **Bell Ring** on the defended **Bell**, so the opposing **Team** scores. Ringing your own Bell is possible."
>
> **Dev:** "Should I call the main button Attack in code?"
> **Domain expert:** "Use **Strike**. Bell Brawl has **Stagger** and **Knockdown**, not HP or elimination combat."

## Flagged Ambiguities

- "Kung Fu Kickball" was used both as a project description and a reference title. Resolved: **Bell Brawl** is the project; Kung Fu Kickball is the **Reference Game**.
- "Attack" was used for the main action. Resolved: **Strike** is canonical because the action targets both ball control and combat pressure.
- "Bell", "gong", and "goal" were overloaded. Resolved: **Bell** is the target and **Bell Ring** is the scoring event; avoid **Goal** as a Bell Brawl term.
- "Uneven teams" was used for three humans in 2v2. Resolved: official **Match Modes** remain 1v1 and 2v2; unfilled **Player Slots** can use **Practice Bots**.
- "Symmetric arenas" could imply every arena plays identically. Resolved: default arenas are **Mirrored Scoring Puzzles** with varied layouts across arenas.
- "Special" previously meant a derived action without a fourth button. Resolved: the latest design uses a dedicated **Special** input with cooldown.
