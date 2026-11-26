#!/usr/bin/env bash
# Builds engine-core twice and runs wasm-bindgen:
#   det  : --features deterministic           -> packages/sdk/wasm/det/engine_core_det*
#   fast : --no-default-features --features fast (+simd128 RUSTFLAGS) -> packages/sdk/wasm/fast/engine_core_fast*
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WANT_BINDGEN="0.2.130"
if ! command -v wasm-bindgen >/dev/null 2>&1; then
	echo "build-wasm: wasm-bindgen not found; run: cargo install wasm-bindgen-cli --version $WANT_BINDGEN" >&2
	exit 1
fi
HAVE_BINDGEN="$(wasm-bindgen --version | awk '{print $2}')"
if [[ "$HAVE_BINDGEN" != "$WANT_BINDGEN" ]]; then
	echo "build-wasm: wasm-bindgen-cli $HAVE_BINDGEN found, need $WANT_BINDGEN" >&2
	exit 1
fi

build() {
	local kind="$1" rustflags="$2"
	shift 2
	local target_dir="target/$kind"
	echo "build-wasm: $kind ($*)" >&2
	CARGO_TARGET_DIR="$target_dir" RUSTFLAGS="$rustflags" \
		cargo build -p engine-core --lib --target wasm32-unknown-unknown --release "$@"
	wasm-bindgen --target web \
		--out-dir "packages/sdk/wasm/$kind" \
		--out-name "engine_core_$kind" \
		"$target_dir/wasm32-unknown-unknown/release/engine_core.wasm"
}

build det "" --features deterministic
build fast "-C target-feature=+simd128" --no-default-features --features fast

echo "build-wasm: done" >&2
