#!/usr/bin/env bash
# Reproduces the Swarm Siege captures in artifacts/games/swarm-siege/ (deterministic: seed 7,
# fixed tick, inline sim; the same frame every run). Ticks were scouted headlessly and are
# pinned in test/capture-ticks.test.ts (victory 5652, defeat 3254; the wave-12 swarm peaks
# near 6,000 live agents around tick 2100).
# Every `pnpm shot` must exit 0 with an empty console; the script stops on the first failure.
# Usage: bash apps/swarm-siege/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/swarm-siege
mkdir -p "$OUT"
pnpm --filter swarm-siege build >/dev/null
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app swarm-siege --no-build --port 5304 --out "$OUT" \
		--name "$name" --timeout 900 "$@"
}
ONLY=${1:-}
DEMO=(--param demo=1 --param seed=7)
FINAL=("${DEMO[@]}" --param wave=12 --param gold=3000)
shot 01-title --ticks 90 --param drift=0.05
shot 02-build-and-pick --ticks 500 "${DEMO[@]}" --param ghost=3@-5,-1 --param select=2
shot 03-the-swarm --ticks 2100 "${FINAL[@]}"
shot 04-junction-close --ticks 2160 "${FINAL[@]}" --param camDist=34 --param camX=-4 \
	--param camZ=-8 --param camPitch=0.72 --param camYaw=0.35
shot 05-firefight --ticks 2420 "${FINAL[@]}" --param camDist=30 --param camX=-9 \
	--param camZ=6 --param camPitch=0.62 --param camYaw=-0.5
shot 06-top-down --ticks 2100 "${FINAL[@]}" --cam top
shot 07-defeat --ticks 3290 --param start=1 --param wave=6 --param seed=7
shot 08-victory --ticks 5700 "${FINAL[@]}"
shot 09-stress-25k --ticks 1500 --param stress=1 --param rate=1000 --param seed=7
shot 10-swarm-flow --ticks 1900 "${FINAL[@]}" --sequence 90:2 --scale 0.6 --no-frames
shot 11-firefight-loop --ticks 2300 "${FINAL[@]}" --param camDist=30 --param camX=-9 \
	--param camZ=6 --param camPitch=0.62 --param camYaw=-0.5 --sequence 90:2 --scale 0.6 --no-frames
shot 12-stress-ramp --ticks 120 --param stress=1 --param rate=1000 --param seed=7 --cam top \
	--sequence 60:24 --scale 0.5 --no-frames
