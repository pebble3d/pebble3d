# Sandbox

Free building and play, where the player edits the world and the physics responds. Part of [genre-playbooks](SKILL.md).

## Demo to study

[Pebble Garden](../../apps/pebble-garden/README.md), a physics sandbox and level editor that exports scene JSON.

- [doc.ts](../../apps/pebble-garden/src/garden/doc.ts): the garden as an editable scene document.
- [history.ts](../../apps/pebble-garden/src/garden/history.ts): undo and redo.
- [validate.ts](../../apps/pebble-garden/src/garden/validate.ts): readable import errors.
- [sim.ts](../../apps/pebble-garden/src/garden/sim.ts): play and exact rewind.

## Core systems

- The world as a document the player edits, separate from the running simulation.
- Place, select, move, rotate and scale with a gizmo; colour and body-type properties.
- Play and reset: reset restores the edited state exactly, and playing twice gives the same result.
- Undo and redo for every edit; a sandbox without them punishes experiments.
- Export and import of the document, with errors a person can act on (line, field, suggestion).
- Starter gardens: a few challenges plus one empty canvas, so the player has a goal if they want one.

## Feel points

- Placing must feel immediate: a ghost preview, a snap cue and a soft thud on release.
- Selection needs an obvious outline and handles that stay a constant size on screen.
- Play and rewind should be a satisfying transition, not a cut.
- Empty states teach: a short hint on the canvas, gone after the first piece.
- Keep the palette small and legible; every piece should be recognisable at a glance.

## Verification

- Round trip: for each starter garden, export then import gives an identical document and an identical state hash after the same number of ticks; an edited garden survives too ([roundtrip.test.ts](../../apps/pebble-garden/test/roundtrip.test.ts)).
- Rewind is exact: playing twice from the same edit state gives the same hash (same file).
- Every palette piece produces a schema-valid scene ([doc.test.ts](../../apps/pebble-garden/test/doc.test.ts)).
- Hostile imports report readable issues instead of throwing, and the undo history is bounded ([hardening.test.ts](../../apps/pebble-garden/test/hardening.test.ts)).
- Challenges: the unsolved garden fails and the reference solution reaches the bowl within par ([gardens.test.ts](../../apps/pebble-garden/test/gardens.test.ts)).
- Undo returning to the start after any run of edits is not tested in the demo; write that check for your own editor.
