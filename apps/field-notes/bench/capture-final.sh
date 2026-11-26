#!/usr/bin/env bash
# Reproduces the Field Notes captures in artifacts/games/field-notes/ (deterministic: seed 23,
# fixed tick, demo autoplayer). Every `pnpm shot` must exit 0 with an empty console; the
# script stops on the first failure. Stills marked "staged" use ?shotCam= (a fixed camera
# over real demo state at that tick) to show compositing from an angle the game camera
# would not take. Usage: bash apps/field-notes/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/field-notes
mkdir -p "$OUT"
pnpm --filter field-notes build >/dev/null
shot() {
	local name=$1
	shift
	if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app field-notes --no-build --port 5234 --out "$OUT" \
		--name "$name" --timeout 900 "$@"
}
ONLY=${1:-}
YARD=(--param demo=1)
FLAT=(--param demo=1 --param site=courtyard)
shot 01-title-yard --ticks 60
shot 02-explore-yard --ticks 240 "${YARD[@]}"
shot 03-viewfinder-yard --ticks 410 "${YARD[@]}"
shot 04-print-yard --ticks 1545 "${YARD[@]}"
# staged: low camera across the planters (splat) to the Lantern Moth, Hollow Door and hall
shot 05-composite-yard --ticks 1500 "${YARD[@]}" --param hud=0 \
	--param shotCam=-0.2,1.1,14.2,-2.4,0.8,10.8,38
shot 06-title-courtyard --ticks 60 --param site=courtyard
shot 07-explore-courtyard --ticks 1000 "${FLAT[@]}"
shot 08-viewfinder-courtyard --ticks 600 "${FLAT[@]}"
# staged: the splat wicker chair in front of the Hollow Door (mesh), its shadow on the floor
shot 09-composite-courtyard --ticks 600 "${FLAT[@]}" --param hud=0 \
	--param shotCam=-2.2,0.9,3.7,-3.6,0.95,5.9,45
shot 10-results-yard --ticks 2400 "${YARD[@]}"
shot 11-photo-mode-yard --ticks 330 --sequence 90:1 --fps 30 --scale 0.6 --no-frames "${YARD[@]}"
shot 12-demo-yard --ticks 100 --sequence 300:6 --fps 10 --scale 0.5 --no-frames "${YARD[@]}"
shot 13-demo-courtyard --ticks 100 --sequence 220:6 --fps 10 --scale 0.5 --no-frames "${FLAT[@]}"
echo "captures: $OUT"
