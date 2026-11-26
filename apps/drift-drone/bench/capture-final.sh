#!/usr/bin/env bash
# Reproduces the Drift Drone captures in artifacts/games/drift-drone/ (deterministic: fixed tick,
# the demo pilot flying assisted mode; its laps improve, so from lap 2 it races its own best-lap
# ghost). Every `pnpm shot` must exit 0 with an empty console; the script stops on the first failure.
# Usage: bash apps/drift-drone/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/drift-drone
mkdir -p "$OUT"
pnpm --filter drift-drone build >/dev/null
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app drift-drone --no-build --port 5316 --out "$OUT" \
		--name "$name" --timeout 400 "$@"
}
ONLY=${1:-}
NEEDLE=(--param track=needle-and-eaves)
# Hall Circuit demo: GO at tick 180, finish line (end of lap 3) at tick 2144, photo-finish
# replay 273 frames, results from tick ~2573 (pinned in test/capture-ticks.test.ts).
shot 01-title-hall --ticks 200 --param title=1
shot 02-title-needle --ticks 200 --param title=1 "${NEEDLE[@]}"
shot 03-countdown --ticks 140 --param demo=1
shot 04-chase-garden-hop --ticks 372 --param demo=1
shot 05-fpv-windows --ticks 660 --param demo=1 --param cam=fpv
shot 06-ghost-duel --ticks 1300 --param demo=1 --param shotCam=5.4,2.5,8.6,2.6,3.25,5.25,36
shot 07-eaves-climb --ticks 1240 --param demo=1 "${NEEDLE[@]}"
shot 08-proxy-colliders --ticks 520 --param demo=1 --param debug=colliders \
	--param shotCam=14.5,6.2,17.5,3.2,1.2,8.5,52
shot 09-photo-finish --ticks 2480 --param demo=1
shot 10-results --ticks 2640 --param demo=1
shot 11-lap-chase --ticks 840 --sequence 150:2 --scale 0.6 --no-frames --param demo=1
shot 12-fpv-needle --ticks 1330 --sequence 150:2 --scale 0.6 --no-frames --param demo=1 --param cam=fpv "${NEEDLE[@]}"
shot 13-photo-finish-replay --ticks 2148 --sequence 140:2 --scale 0.6 --no-frames --param demo=1
echo "captures: $OUT"
