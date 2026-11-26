#!/usr/bin/env bash
# Reproduces the Breakpoint captures in artifacts/games/breakpoint/ (deterministic: seed 7,
# fixed tick, demo autoplayer). Every `pnpm shot` must exit 0 with an empty console; the
# script stops on the first failure. `--ticks` counts rendered frames in fixed mode (slow
# motion advances the sim less than one tick per frame).
# Usage: bash apps/breakpoint/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/breakpoint
mkdir -p "$OUT"
pnpm --filter breakpoint build >/dev/null
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app breakpoint --no-build --port 5213 --out "$OUT" \
		--name "$name" --timeout 1500 "$@"
}
ONLY=${1:-}
DEMO=(--param demo=1)
# Site 1, the Old Keep (the demo fires its first shot at frame ~210).
shot 01-title --ticks 60 "${DEMO[@]}"
shot 02-aim --ticks 185 "${DEMO[@]}"
shot 03-impact --ticks 300 "${DEMO[@]}"
shot 04-collapse --ticks 520 "${DEMO[@]}"
shot 05-keep-second-shot --ticks 900 "${DEMO[@]}" --param hud=0 --param camYaw=0.75 --param camPitch=0.32 --param camDist=24
# Site 2 and 3 started directly (level=1 / level=2).
shot 06-viaduct-impact --ticks 300 "${DEMO[@]}" --param level=1
shot 07-citadel-collapse --ticks 330 "${DEMO[@]}" --param level=2
shot 08-level-card --ticks 2330 "${DEMO[@]}"
shot 09-run-report --ticks 2300 "${DEMO[@]}" --param level=2
shot 10-replay-verified --ticks 3420 "${DEMO[@]}" --param level=2
# Animated: the first impact in slow motion, and the best-shot replay (citadel run:
# the run report shows at frame ~2200, the replay plays from ~2351 and verifies by ~3300).
shot 11-impact-slowmo --ticks 226 --sequence 150:2 --scale 0.6 --no-frames "${DEMO[@]}"
shot 12-best-shot-replay --ticks 2356 --sequence 240:4 --fps 15 --scale 0.6 --no-frames "${DEMO[@]}" --param level=2
echo "captures: $OUT"
