#!/usr/bin/env bash
# Reproduces the Ghostline captures in artifacts/games/ghostline/ (deterministic: fixed tick,
# par ghosts on seed 1, the demo bot driving). Every `pnpm shot` must exit 0 with an empty
# console; the script stops on the first failure.
# Usage: bash apps/ghostline/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/ghostline
mkdir -p "$OUT"
pnpm --filter ghostline build >/dev/null
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app ghostline --no-build --port 5224 --out "$OUT" \
		--name "$name" --timeout 300 "$@"
}
ONLY=${1:-}
GLAM=(--param camAngle=2.8 --param camDist=2.4)
shot 01-title-sunfold --ticks 240 --param title=1
shot 02-title-undertow --ticks 240 --param title=1 --param course=undertow
shot 03-countdown --ticks 95 --param demo=1
shot 04-race-the-ghost --ticks 900 --param demo=1 --param bot=slow
shot 05-jump --ticks 1075 --param demo=1
shot 06-lacquer-chase --ticks 1000 --param demo=1 --param course=lacquer --param skin=chrome
shot 07-chrome-glamour --ticks 640 --param demo=1 --param course=lacquer --param skin=chrome "${GLAM[@]}"
shot 08-ember-glamour --ticks 560 --param demo=1 --param course=undertow --param skin=ember "${GLAM[@]}"
shot 09-undertow-sweeper --ticks 1060 --param demo=1 --param course=undertow
shot 10-results --ticks 2140 --param demo=1 --param course=lacquer
shot 11-sunfold-run --ticks 560 --sequence 150:2 --scale 0.6 --no-frames --param demo=1
shot 12-undertow-ghost-duel --ticks 400 --sequence 150:2 --scale 0.6 --no-frames --param demo=1 --param course=undertow --param bot=slow
shot 13-lacquer-sweeper --ticks 820 --sequence 120:2 --scale 0.6 --no-frames --param demo=1 --param course=lacquer
echo "captures: $OUT"
