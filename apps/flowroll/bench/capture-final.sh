#!/usr/bin/env bash
# Reproduces the Flowroll captures in artifacts/games/flowroll/ (deterministic: fixed tick,
# the ?demo=1 CPU-vs-CPU roll on seed 124, blue belt vs blue belt). Seed 124 was scouted
# headless: pull guard, stack pass (sim tick ~357), scissor sweep (~694), mount armbar
# (~924), tap (~1222). Game ticks run a few frames behind sim ticks after each landed move
# (presentation hit-stop), so the ticks below are game ticks checked against the sidecars.
# Every `pnpm shot` must exit 0 with an empty console; the script stops on the first failure.
# Usage: bash apps/flowroll/bench/capture-final.sh [only-name]
set -euo pipefail
cd "$(dirname "$0")/../../.."
OUT=artifacts/games/flowroll
mkdir -p "$OUT"
pnpm --filter flowroll build >/dev/null
ONLY=${1:-}
shot() {
	local name=$1
	shift
	if [ -n "$ONLY" ] && [ "$ONLY" != "$name" ]; then return; fi
	echo "== $name"
	node scripts/shot/shot.mjs --app flowroll --no-build --port 5391 --out "$OUT" \
		--name "$name" --size 1600x900 --timeout 900 "$@"
}
D=(--param demo=1 --param seed=124)
shot 01-title --ticks 150 --param title=1
shot 02-tutorial --ticks 420 --param tutorial=1 --param demo=1
shot 03-standing-grips "${D[@]}" --ticks 215
shot 04-closed-guard "${D[@]}" --ticks 310
shot 05-side-control "${D[@]}" --ticks 470
shot 06-mount "${D[@]}" --ticks 800
shot 07-submission-tension "${D[@]}" --ticks 1150
shot 08-tap "${D[@]}" --ticks 1262
shot 09-replay "${D[@]}" --ticks 1700
shot 10-results-timeline "${D[@]}" --ticks 2300
shot 11-two-players --ticks 400 --param versus=1 --param seed=3
# every keyed position, solved and contact-resolved as in play
for p in halfGuard kneeOnBelly back triangle kimura rnc; do
	shot "12-pose-$p" --ticks 5 --param pose=$p --param hud=0
done
shot 13-pose-gallery --ticks 5 --param pose=all --param hud=0
# the WebGL path: the same submission moment (its stateHash must equal 07's), and the fallback
# param. ANGLE on Vulkan (RADV) prints one driver performance warning four times on WebGL;
# Ringout prints it too, so it is the driver, not the game (README, known issues).
shot 30-webgl-submission "${D[@]}" --ticks 1150 --backend webgl \
	--allow-console-error "Running out of reserved outsideRenderPass queueSerial:4"
shot 31-webgl-fallback-param --ticks 600 --param webglFallback=1 --param demo=1
# motion: a guard pass, a sweep, a submission finishing in a tap
shot 20-seq-guard-pass "${D[@]}" --ticks 290 --sequence 60:2 --scale 0.6 --no-frames
shot 21-seq-sweep "${D[@]}" --ticks 640 --sequence 60:2 --scale 0.6 --no-frames
shot 22-seq-tap "${D[@]}" --ticks 1150 --sequence 70:2 --scale 0.6 --no-frames
echo "captures: $OUT"
