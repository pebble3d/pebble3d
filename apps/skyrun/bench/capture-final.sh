#!/usr/bin/env bash
# Reproduces the Skyrun captures in artifacts/games/skyrun/ (fixed tick, the demo bot in
# "steady" style racing the shipped par ghost). Every `pnpm shot` must exit 0 with an empty
# console; the script stops on the first failure.
# App ticks = 150 title ticks + sim ticks (the run's countdown is sim ticks 0-180).
# Usage: bash apps/skyrun/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/skyrun
mkdir -p "$OUT"
pnpm --filter skyrun build >/dev/null
ONLY=${1:-}
shot() {
	local name=$1
	shift
	if [ -n "$ONLY" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app skyrun --no-build --port 5286 --out "$OUT" \
		--name "$name" --timeout 420 "$@"
}
GALE=(--param course=gale-spires)
shot 01-title --ticks 120 --param title=1
shot 02-title-gale --ticks 120 --param title=1 "${GALE[@]}" --param runner=robot
shot 03-countdown --ticks 190 --param demo=1
shot 04-stairs --ticks 352 --param demo=1
shot 05-gap-jump --ticks 452 --param demo=1
shot 06-ferry --ticks 1150 --param demo=1
shot 07-lift --ticks 1730 --param demo=1
shot 08-wheel --ticks 2200 --param demo=1
shot 09-results --ticks 2540 --param demo=1
shot 10-shuttles --ticks 650 --param demo=1 "${GALE[@]}"
shot 11-turnstile --ticks 1450 --param demo=1 "${GALE[@]}"
shot 12-gondola --ticks 1950 --param demo=1 "${GALE[@]}"
shot 13-lift-ladder --ticks 2600 --param demo=1 "${GALE[@]}"
shot 14-spire --ticks 3110 --param demo=1 "${GALE[@]}"
shot 15-robot-runner --ticks 1150 --param demo=1 --param runner=robot
shot 16-ferry-ride --ticks 1100 --sequence 120:2 --scale 0.6 --no-frames --param demo=1
shot 17-turnstile-ride --ticks 1250 --sequence 150:2 --scale 0.6 --no-frames --param demo=1 "${GALE[@]}"
shot 18-lift-ladder --ticks 2290 --sequence 150:2 --scale 0.6 --no-frames --param demo=1 "${GALE[@]}"
echo "captures: $OUT"
