#!/usr/bin/env bash
# Reproduces the Pebble Garden captures in artifacts/games/pebble-garden/ (fixed tick, so
# every frame is deterministic). Every `pnpm shot` must exit 0 with an empty console; the
# script stops on the first failure. Usage: bash apps/pebble-garden/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/pebble-garden
mkdir -p "$OUT"
pnpm --filter pebble-garden build >/dev/null
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app pebble-garden --no-build --port 5292 --out "$OUT" \
		--name "$name" --timeout 300 "$@"
}
ONLY=${1:-}
# Demo timeline: title until tick 100, then one placement every 30 ticks and one inspector
# edit every 16; the guide wall's ghost shows at ~418, Play at ~502, the goal at ~885, the
# result card at ~965, Reset at ~1115 and the export sheet from ~1160.
shot 01-title --ticks 330
shot 02-challenges --ticks 120 --param panel=picker
shot 03-build-ghost --ticks 428 --param demo=1
shot 04-inspector-gizmo --ticks 60 --param garden=rock-garden --param select=boulder
shot 05-domino-run --ticks 190 --param garden=domino-terrace --param solution=1 --param play=1
shot 06-goal-bloom --ticks 392 --param garden=first-roll --param solution=1 --param play=1
shot 07-result --ticks 520 --param garden=first-roll --param solution=1 --param play=1
shot 08-export --ticks 1300 --param demo=1
shot 09-import-errors --ticks 40 --param garden=turning-rake --param panel=import --param bad=1
shot 10-turning-rake --ticks 150 --param garden=turning-rake --param solution=1 --param play=1
shot 11-demo-build --ticks 100 --sequence 110:4 --scale 0.6 --no-frames --param demo=1
shot 12-domino-terrace --ticks 30 --sequence 100:3 --scale 0.6 --no-frames --param garden=domino-terrace --param solution=1 --param play=1
shot 13-rock-garden --ticks 20 --sequence 120:3 --scale 0.6 --no-frames --param garden=rock-garden --param play=1
echo "captures: $OUT"
