---
name: game-interview
description: Use when a game request leaves open what the player does, how it should feel or look, the controls, the players or the scope, and you need a short design brief the developer approves before any code is written.
---

# Game interview

Turn a request ("a game where you bounce enemies off the edge") into `apps/<name>/BRIEF.md`, a one-page brief the developer says yes to. The goal is to learn what they picture, not to fill a form. Next: `start-a-game`.

## Rules

- **At most six questions, one per message.** Wait for the answer before the next.
- **Ask only what the request leaves open.** If they said "racing game with a drone", do not ask what the player does.
- **Propose, do not interrogate.** Once you know _why_ they want the game, offer a concrete default and let them correct it: "I'd make it one screen, top-down camera, three lives. Sound right?" beats "How many lives?".
- **Biggest unknown first.** Usually the look or what the player does. A good opener restates the request in one sentence, then asks one open question about the vaguest word in it: "When you say very stylized, what do you picture?"
- **Show, when the look is their call.** Words fail for visuals; see "Mockups" below.
- Never name or suggest imitating an existing commercial game. If the developer names one, ask what they like about it (the feel, the camera, the pace) and write that down instead of the title.
- Keep a running list of what you have decided. That list becomes the brief.

## The six topics

In rough priority order. Skip any the request or an earlier answer already settles.

| Topic                | What you need                                                                | Default to propose if they shrug                                                 |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| What the player does | The core verbs (roll, dash, jump, place, shoot) and the goal of a round      | One verb plus one special move, a round that ends in a win or a loss             |
| The feel             | Pace and weight: floaty or heavy, frantic or calm, forgiving or punishing    | Responsive and weighty, short rounds, quick restart                              |
| The look             | Style, palette, mood, camera; what it should remind them of (in their words) | One committed style suggested by the theme (for example toon with bold outlines) |
| Controls, platform   | Keyboard, mouse, gamepad, touch; desktop or phone browser                    | Keyboard on a desktop browser                                                    |
| Players              | Single player, local multiplayer on one keyboard, or online                  | Single player against bots                                                       |
| Scope of v1          | What the first playable version contains, and what waits                     | One arena or level, the full loop (title, play, results, restart)                |

**Players:** the engine has no online netcode. If they want online play, say so plainly and offer local multiplayer on one keyboard, bot opponents, or both, as `apps/ringout` does ([its README](../../apps/ringout/README.md)). Put online play under out of scope.

## Mockups

When the look (or a visual effect) is the developer's call and they cannot describe it, offer to show options instead of asking:

1. Write a throwaway HTML page outside the app (a temp folder is fine) with a few small animated variants side by side: for example four hit-effect styles, three palettes, or two camera angles. Label each with a letter.
2. Open it in their browser and ask which one is closest, or what to mix.
3. If they pick one and want more detail, make a second, more detailed page of that one.
4. When the choice depends on how it looks in the real renderer, do a quick in-engine test: a scene file in `apps/playground/scenes/` captured with `pnpm shot --scene <name>` (the file name without `.json`; see [docs/getting-started.md](../../docs/getting-started.md)). Delete the test scene afterwards.

Keep mockups cheap: minutes, not hours. They decide a direction; they are not the game.

## Non-interactive or "just build it"

If you cannot hold a back-and-forth (a headless run, a tool without replies) or the developer says "just build it":

1. If you can send one message and get one reply, ask all your open questions in that single message, each with the default you will use, so they can answer only the ones they care about.
2. If there is no reply, or they said "just build it", use the defaults from the table above (adjusted to whatever the request did say).
3. Write `BRIEF.md` anyway, with every default listed under **Assumptions**, and continue without waiting for approval. Mention the assumptions in your first progress message so the developer can correct them.

## Writing the brief

1. Pick the app name: short, lowercase, hyphenated, original (not a commercial title), and not already a folder in `apps/`. It is also the package name and the `--filter` name.
2. Copy [brief-template.md](brief-template.md) to `apps/<name>/BRIEF.md` (create the folder; `start-a-game` fills in the rest). Fill every section in the developer's words where you can. Keep it to one page.
3. Show it to the developer: "Here is the brief. Yes, or what should change?" Edit until they say yes.
4. Exit check: `BRIEF.md` exists, has no empty sections, and is approved (or its assumptions are marked, in the non-interactive case).
