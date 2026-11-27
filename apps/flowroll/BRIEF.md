# Flowroll: brief

Approved by the developer: not yet. The developer asked to "see what you come up with", so this brief records the designer's choices as assumptions and the build proceeds; the developer can redirect at any time.

## Pitch

Brazilian jiu-jitsu as a game of positional chess played in real time. Two grapplers start standing, fight for grips, and the match flows through the positions real rolls go through: guard, half guard, side control, mount, back. Every position offers a few moves; every move has a timing window and a counter. Win by submission, or on points when the clock runs out. It should feel like a calm, tense, readable roll, not a button-mash brawl.

## Player verbs

- **Grip** (hold a direction to build grip strength on the opponent; grips power every move).
- **Advance**: from the current position, choose one of up to three moves shown on screen (pass, sweep, take the back, mount, submission entry). Each move is a short timing contest: press on the beat inside a shrinking ring; better timing and stronger grips beat the defender's read.
- **Defend**: the defender sees the same move coming (telegraphed by the attacker's posture) and picks the matching counter (frame, hip escape, re-guard, tuck chin). The right counter at the right time stops it; the wrong one makes it worse.
- **Breathe**: release grips to recover stamina ("gas tank"). Running out of gas weakens every grip and slows every window.
- **Submissions**: a tug-of-war between attacker pressure and defender escape, tapping into a tension meter; at full tension the defender taps.

## Positions and scoring (simplified competition rules)

Standing → takedown (2) → guard / half guard. Pass guard (3) → side control. Knee on belly (2), mount (4), back control (4). Sweep from guard (2). Submissions end the match: armbar, triangle, kimura, rear-naked choke, each from the positions where they make sense. Advantages break ties.

## Feel

Weighty, deliberate, readable. Bodies shift weight before a move starts (telegraph), a successful move lands with a short freeze, a camera ease and a soft mat thud; a submission tightens with a slow push-in, a heartbeat and a desaturating vignette until the tap. Scrambles speed up briefly. Mistakes are visible: a bad counter shows the body overcommitting.

## Look and references

A quiet late-night academy, deliberately different from the ink fighter: a blue tatami mat under warm overhead lights, dark walls with a few belt-rank racks and a wall clock, soft shadows, shallow depth of field on submissions. The two grapplers are stylised wooden artist's mannequins (smooth jointed figures) wearing cloth gis, one white, one royal blue, with coloured belts. The mannequin style is a choice: grappling poses are hand-keyed in code (no grappling motion capture exists in the free packs), and on jointed wooden figures keyed poses read as deliberate, like stop-motion, rather than stiff.

- Palette: mat `#2f5d8c`, mat edge `#d9b45a`, wall `#1e1f24`, warm light `#ffd9a0`, gi white `#f2efe8`, gi blue `#2a4fb8`, wood `#c99a66`.
- Camera: three-quarter view orbiting slowly around the pair, closer on submissions.
- 60 fps on WebGPU and on hardware WebGL on an integrated GPU.

## Controls

- Player 1: WASD to pick a move / counter (each option is mapped to a direction), J grip / press on the beat, K breathe, L stall.
- Player 2 (same keyboard): arrows, numpad 1/2/3.
- Menus: arrows / WASD and Enter; Esc pauses. A short interactive tutorial roll on first play.

## Players

- 1 player versus a CPU partner (white, blue and black belt difficulty).
- 2 players on one keyboard.
- `?demo=1`: CPU versus CPU, the whole loop.

## Scope of v1

Title → choose belt difficulty → tutorial (skippable) → match (one 3-minute round, points and advantages, or submission) → results with a position timeline of the roll → rematch. Standing, guard, half guard, side control, mount, back, four submissions. One academy. Deterministic sim; a replay of the finish.

## Out of scope

Gi grip variety beyond one grip meter, leg locks, tournaments, belt progression, online play, gamepad (nice to have).

## Assumptions

- Name "Flowroll" is a placeholder.
- Mannequin figures built from engine primitives or the CC0 Quaternius mannequin, with gis as simple cloth meshes; poses keyed per position with IK for hand and foot contacts.
- Rules simplified from common competition scoring; no claim to match any federation's rulebook.

## Feel: the moments that matter

1. **The read**: the attacker's posture shifts (a level change, a knee sliding across, hips lifting) before the move is named; a counter committed during the telegraph is the strongest defence.
2. **The beat**: a white ring closes on a gold circle; pressing J as they meet chimes, an early or late press clicks.
3. **A move landing**: a short freeze (hit-stop), a camera punch and shake scaled by the move's weight, a mat thud, chalk dust, a score toast.
4. **The squeeze**: depth of field and a desaturating vignette close in with tension; a heartbeat speeds up; escapes on the beat jolt the defender.
5. **The tap**: three pats on the partner, a longer freeze, the referee's whistle, then a replay of the finish re-simulated from the input log.

## Look reference

PBR (wood grain and cloth weave read as materials, not cartoon), studio preset with a near-black backdrop (`#1e1f24` horizon, `#0d0e12` zenith), low ambient (environment 0.22), a warm overhead point-light pool (`#ffd9a0`) and a cool back rim. Closest shipped reference: Ringout's three-colour studio mood, taken darker and warmer. Accent colours are reserved for the players (white and royal-blue gis) and the HUD's gold (beat target, selected menu item).

## Decisions made while building (by bot runs and captures)

- **Points are awarded on arrival**, not after a 3-second stabilisation. With exchanges about a second long, a stabilisation timer made scoring hard to read in captures.
- **A sweep scores 2 even when it lands in mount** (scissor sweep), and the upa bridge reversal also scores 2.
- **Submission contest is rhythm, not mashing**: the finisher holds J (burning gas, and an empty tank lets the lock slip); the defender times the escape key on a pulse every 0.7 s. Tuned over 40 seeds per belt pairing so equal belts trade escapes and taps (median submission 6 to 8 s) and about half of equal-belt rolls end by submission.
- **Gas economy loosened** (regen 0.06/s, gripping costs 0.04/s): with the first numbers both CPUs spent most of the roll near empty and submissions stalled for 25 s.
- **The defender's counter is hinted only after the move is named**, and a late read is weaker (read strength 1.0 in the telegraph, 0.7 falling to 0.3 in the window), so new players can still defend while reading posture early stays the better play.
- **Skipping the tutorial (Esc) starts a roll** with the chosen partner instead of returning to the title.
- **L is posture** (harder to grip, a little more defence) and holding it for 5 s with no attack is stalling: the opponent gets an advantage.
- Mannequins are built from primitives, not the CC0 glTF: the position-based rig places every segment between solved joints, which makes two-bone IK, grips anchored on the partner and a capsule interpenetration check straightforward, and needs no asset.
- **Depth of field is opt-in (`dof=1`)**: at the side-on submission camera the engine's DOF ramp draws concentric bands across the mat (captures 07 to 09 showed them; with `dof=0` they vanish). The squeeze keeps its push-in, desaturation and vignette.
- **The armbar is keyed as the finish** (both players on their backs, side-on, the arm straight between the finisher's thighs), so it reads the same from every entry.
- No genre playbook fits a grappling game; it is built on the arena-brawler structure (local seats, CPU bots, input-log replay) with chain-reaction-style headless tests for the rules.
