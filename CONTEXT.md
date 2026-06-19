# Bell Brawl

Bell Brawl is an original browser-first 2D fighting-sports game where one or two players per team try to ring the opposing team's elevated Bell with a shared ball.

## Language

**Bell Brawl**:
The original game being built in this repository.
_Avoid_: Kung Fu Kickball as the project name, BellBrawl as the canonical spelling

**Reference Game**:
Kung Fu Kickball, used as a reference for genre lessons and mechanical inspiration only.
_Avoid_: Treating the reference game as a source of copied assets, code, names, or layouts

**Match Mode**:
The official team shape for a match, either 1v1 or 2v2.
_Avoid_: Uneven mode, free-for-all

**Team**:
A side in a match that owns one Goal, defends one Bell, and scores by ringing the opposing Bell.
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

**Bell**:
The physical elevated scoring target defended by a Team.
_Avoid_: Gong, goal when referring to the target

**Goal**:
The defended end of the arena containing a Team's Bell.
_Avoid_: Bell when referring to the whole defended side

**Bell Ring**:
The scoring event that occurs when the ball contacts a defended Bell hit-zone.
_Avoid_: Goal, point when referring to the event

**Mirrored Scoring Puzzle**:
A left-right mirrored arena layout that creates a distinct path or obstacle problem for ringing the opposing Bell.
_Avoid_: Symmetric arena when it could imply every arena plays the same

**Overtime Pressure Ramp**:
The Golden Goal rule where Bell hit-zones visibly grow over time to force match resolution.
_Avoid_: Overtime hazard, sudden death when referring to the ramp

**Strike**:
The core intentional action that applies meaningful impulse to the ball or Stagger/Knockback to players.
_Avoid_: Attack, damage, kick when referring to the general action

**Jump**:
The core action for variable-height vertical movement.
_Avoid_: Hop as the canonical action name

**Tele-Dash**:
The core action for a short fixed-distance blink in the facing or stick direction.
_Avoid_: Sprint, roll, velocity dash

**Special**:
A character-specific derived action triggered through context, charge, direction, or button combinations without adding a fourth action button.
_Avoid_: Fourth button, super unless a future design creates that term

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

## Relationships

- A **Match Mode** defines the number of **Player Slots** per **Team**.
- A **Player Slot** can be occupied by a human or a **Practice Bot**.
- A **Team** defends one **Goal** and one **Bell**.
- A **Bell Ring** scores one point for the Team opposing the defended **Bell** that was hit.
- A **Strike** can affect the ball, opponents, and teammates under **Friendly Fire**.
- **Stagger** can produce **Knockdown**, and **Knockdown** ends with **Recovery Invulnerability**.
- A **Private Lobby** is controlled by a **Host Player** until host ownership transfers.
- A **Mirrored Scoring Puzzle** must give both Teams equivalent access and obstacles within the same arena.

## Example Dialogue

> **Dev:** "A three-human 2v2 has one uneven Team, right?"
> **Domain expert:** "No. The **Match Mode** is still 2v2. One **Player Slot** is occupied by a **Practice Bot**."
>
> **Dev:** "When a player hits their own **Bell**, who gets the point?"
> **Domain expert:** "That is still a **Bell Ring** on the defended **Bell**, so the opposing **Team** scores. Own-goals are possible."
>
> **Dev:** "Should I call the main button Attack in code?"
> **Domain expert:** "Use **Strike**. Bell Brawl has **Stagger** and **Knockdown**, not HP or elimination combat."

## Flagged Ambiguities

- "Kung Fu Kickball" was used both as a project description and a reference title. Resolved: **Bell Brawl** is the project; Kung Fu Kickball is the **Reference Game**.
- "Attack" was used for the main action. Resolved: **Strike** is canonical because the action targets both ball control and combat pressure.
- "Bell", "gong", and "goal" were overloaded. Resolved: **Bell** is the target, **Goal** is the defended side, and **Bell Ring** is the scoring event.
- "Uneven teams" was used for three humans in 2v2. Resolved: official **Match Modes** remain 1v1 and 2v2; unfilled **Player Slots** can use **Practice Bots**.
- "Symmetric arenas" could imply every arena plays identically. Resolved: default arenas are **Mirrored Scoring Puzzles** with varied layouts across arenas.
