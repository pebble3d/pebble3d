#!/usr/bin/env bash
# Reproduces the Chain Reaction captures in artifacts/games/chain-reaction/ (fixed tick, so
# every frame is deterministic). Every `pnpm shot` must exit 0 with an empty console; the
# script stops on the first failure. Usage: bash apps/chain-reaction/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/chain-reaction
mkdir -p "$OUT"
pnpm --filter chain-reaction build >/dev/null
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app chain-reaction --no-build --port 5255 --out "$OUT" \
		--name "$name" --timeout 300 "$@"
}
ONLY=${1:-}
# The demo places a level's reference parts (one every 30 ticks), then runs at tick ~30n+42.
shot 01-title --ticks 335
shot 02-build-ghost --ticks 52 --param demo=1 --param level=6
shot 03-domino-knock --ticks 306 --param demo=1 --param level=4
shot 04-spring-bounce --ticks 246 --param demo=1 --param level=2
shot 05-crosswind --ticks 160 --param demo=1 --param level=3
shot 06-catapult --ticks 160 --param demo=1 --param level=5
shot 07-goal-confetti --ticks 418 --param demo=1 --param level=6
shot 08-verified-result --ticks 345 --param demo=1 --param level=1
shot 09-domino-run --ticks 250 --sequence 125:2 --scale 0.6 --no-frames --param demo=1 --param level=4
shot 10-grand-contraption --ticks 104 --sequence 170:2 --scale 0.6 --no-frames --param demo=1 --param level=6
echo "captures: $OUT"
