#!/usr/bin/env bash
# Reproduces the Lanternfall captures in artifacts/games/lanternfall/ (deterministic: fixed tick,
# demo autoplayer, pinned keeps). Every `pnpm shot` must exit 0 with an empty console; the
# script stops on the first failure. Ticks come from the headless runs in test/sim.test.ts
# (keep 64 escapes unseen at tick 1784; keep 18 raises an alarm at 2038 and still escapes;
# keep 42 is caught at 1836). "staged" = ?shotCam= (a fixed camera over real demo state at that tick).
# Usage: bash apps/lanternfall/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/lanternfall
mkdir -p "$OUT"
pnpm --filter lanternfall build >/dev/null
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app lanternfall --no-build --port 5265 --out "$OUT" \
		--name "$name" --timeout 900 "$@"
}
ONLY=${1:-}
K64=(--param demo=1 --param seed=64)
shot 01-title --ticks 120 --param seed=64
shot 02-creep --ticks 700 "${K64[@]}"
shot 03-alarm --ticks 2060 --param demo=1 --param seed=18
shot 04-relic --ticks 1060 "${K64[@]}"
shot 05-escaped --ticks 1825 "${K64[@]}"
shot 06-caught --ticks 1870 --param demo=1 --param seed=42
# staged: the whole generated keep from above, guards' raycast cones clipped by its walls
shot 07-keep-from-above --ticks 700 "${K64[@]}" --param hud=0 \
	--param shotCam=0,46,13,0,0,0.6,44
shot 08-title-keep-7 --ticks 120 --param seed=7
shot 09-heist --ticks 300 --sequence 120:10 --fps 10 --scale 0.5 --no-frames "${K64[@]}"
shot 10-chase --ticks 2000 --sequence 100:3 --fps 20 --scale 0.5 --no-frames --param demo=1 --param seed=18
echo "captures: $OUT"
