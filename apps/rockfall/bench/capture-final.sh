#!/usr/bin/env bash
# Reproduces the Rockfall captures in artifacts/games/rockfall/ (deterministic: seed 7, fixed
# tick, so every capture shows exactly the same moment on every run). The capture ticks were
# scouted headlessly: the same sim and wasm run in Node, so events land on the same ticks.
# Every `pnpm shot` must exit 0 with an empty console; the script stops on the first failure.
# Usage: bash apps/rockfall/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/rockfall
mkdir -p "$OUT"
pnpm --filter rockfall build >/dev/null
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app rockfall --no-build --port 5243 --out "$OUT" \
		--name "$name" --timeout 900 "$@"
}
ONLY=${1:-}
DEMO=(--param demo=1 --param seed=7)
shot 01-title --ticks 480
shot 02-targeted-wave1 --ticks 1050 "${DEMO[@]}"
shot 03-encircled --ticks 4088 "${DEMO[@]}"
shot 04-close-calls --ticks 4106 "${DEMO[@]}"
shot 05-meteor-shower --ticks 5880 "${DEMO[@]}"
shot 06-rockslide --ticks 6130 "${DEMO[@]}"
shot 07-full-pit-deterministic --ticks 1500 "${DEMO[@]}" --param start=1 --param wave=7 \
	--param rubble=1400 --param god=1 --param camDist=27 --param camPitch=-1.0
shot 08-full-pit-fast --ticks 1500 "${DEMO[@]}" --param start=1 --param wave=7 \
	--param rubble=1800 --param god=1 --param build=fast --param camDist=27 --param camPitch=-1.0
shot 09-buried --ticks 1800 "${DEMO[@]}" --param wave=6 --param rubble=900 --param demoWaves=5
shot 10-encircled --ticks 3990 --sequence 70:2 --scale 0.6 --no-frames "${DEMO[@]}"
shot 11-rockslide --ticks 6000 --sequence 90:3 --scale 0.6 --no-frames "${DEMO[@]}"
shot 12-demo-gameplay --ticks 5700 --sequence 150:4 --fps 15 --scale 0.5 --no-frames "${DEMO[@]}"
echo "captures: $OUT"
