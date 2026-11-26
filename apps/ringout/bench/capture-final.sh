#!/usr/bin/env bash
# Reproduces the Ringout captures in artifacts/games/ringout/ (deterministic: fixed tick, the
# ?demo=1 bot match on seed 1, best of 3). Tick numbers come from the demo timeline
# (EXPLORE=1 npx vitest run --project ringout timeline). Every `pnpm shot` must exit 0 with an
# empty console; the script stops on the first failure.
# Usage: bash apps/ringout/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/ringout
mkdir -p "$OUT"
pnpm --filter ringout build >/dev/null
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app ringout --no-build --port 5271 --out "$OUT" \
		--name "$name" --timeout 900 "$@"
}
ONLY=${1:-}
shot 01-title --ticks 300 --param title=1
shot 02-countdown --ticks 120 --param demo=1
shot 03-opening-clash --ticks 216 --param demo=1
shot 04-ring-warning --ticks 570 --param demo=1
shot 05-ring-drop --ticks 625 --param demo=1
shot 06-ringout --ticks 1030 --param demo=1
shot 07-round-won --ticks 1262 --param demo=1
shot 08-replay-slowmo --ticks 1661 --param demo=1
shot 09-replay-verified --ticks 2250 --param demo=1
shot 10-local-versus --ticks 400 --param demo=1 --param seats=p1,p2,bot,off
shot 11-results --ticks 7700 --param demo=1
shot 12-fight --ticks 960 --sequence 90:2 --scale 0.6 --no-frames --param demo=1
shot 13-replay-slowmo --ticks 1600 --sequence 70:2 --scale 0.6 --no-frames --param demo=1
echo "captures: $OUT"
