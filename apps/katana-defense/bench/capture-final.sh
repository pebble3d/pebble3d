#!/usr/bin/env bash
# Reproduces the Phase B captures in artifacts/game/final/ (deterministic: seed 7, fixed
# tick). Every `pnpm shot` must exit 0 with an empty console; the script stops on the first
# failure. Usage: [OUT=<dir>] [PORT=<n>] [BUILD=0] bash apps/katana-defense/bench/capture-final.sh [name|regex]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=${OUT:-artifacts/game/final}
PORT=${PORT:-5193}
BUILD=${BUILD:-1}
mkdir -p "$OUT"
if [ "$BUILD" = 1 ]; then pnpm --filter katana-defense build >/dev/null; fi
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && ! [[ "$name" =~ ^($ONLY)$ ]]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app katana-defense --no-build --port "$PORT" --out "$OUT" \
		--name "$name" --timeout 240 "$@"
}
ONLY=${1:-}
LAB=(--param lab=1 --param hud=0 --param camYaw=0.5 --param camDist=3.2 --param camPitch=-0.12)
shot 01-title --ticks 200
shot 02-swordsman-closeup --ticks 1000 --param demo=1 --param wave=5 --param demoWaves=8 --param camDist=6 --param camPitch=-0.55
shot 03-light-combo-slash --ticks 37 "${LAB[@]}"
shot 04-launcher --ticks 160 "${LAB[@]}"
shot 05-spin-storm --ticks 800 --param demo=1 --param wave=5 --param demoWaves=8 --param camDist=9 --param camPitch=-0.8
shot 06-brute-slam-telegraph --ticks 1185 --param demo=1 --param wave=5 --param demoWaves=8 --param camDist=7.5 --param camPitch=-0.75
shot 07-upgrade-picker --ticks 2700 --param demo=1
shot 08-dusk-wave8 --ticks 960 --param demo=1 --param wave=8 --param demoWaves=8
shot 09-game-over --ticks 1460 --param demo=1 --param wave=4 --param demoWaves=3
shot 10-combo-string --ticks 33 --sequence 170:1 --fps 30 --scale 0.6 --no-frames "${LAB[@]}"
shot 11-spin-storm --ticks 790 --sequence 90:2 --scale 0.6 --no-frames --param demo=1 --param wave=5 --param demoWaves=8 --param camDist=9 --param camPitch=-0.8
shot 12-demo-gameplay --ticks 700 --sequence 400:4 --fps 15 --scale 0.5 --no-frames --param demo=1
echo "captures: $OUT"
