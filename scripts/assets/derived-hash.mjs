// The derived-output hash policy for scripts/fetch-assets.mjs.
//
// Derived assets (splats converted by splat-transform, Rocketbox avatars built with
// assimpjs + KTX-Software) are verified against the sha256 in the manifest. The tools are
// deterministic, but their output has only been verified on one machine, so a CI runner
// may produce different bytes. The opt-in flag turns that one case into a warning that
// prints the observed hash; downloads and derive *sources* stay strict either way.
//
//   node scripts/fetch-assets.mjs --allow-derived-mismatch
//   PEBBLE3D_ALLOW_DERIVED_MISMATCH=1 pnpm fetch-assets
//
// Local default: strict (a mismatch fails and removes the file).

export const ALLOW_FLAG = "--allow-derived-mismatch";
export const ALLOW_ENV = "PEBBLE3D_ALLOW_DERIVED_MISMATCH";

/** Whether derived-output mismatches are allowed for this run. */
export function allowDerivedMismatch(argv = process.argv, env = process.env) {
	return argv.includes(ALLOW_FLAG) || env[ALLOW_ENV] === "1";
}

/**
 * Decides what to do with a derived output whose sha256 is `got`.
 * Returns `{ ok: true }` on a match, `{ ok: true, warning }` on an allowed mismatch, and
 * `{ ok: false, error }` on a mismatch in strict mode.
 */
export function checkDerivedHash({ id, expected, got, allow }) {
	if (got === expected) return { ok: true };
	const detail = `${id}: derived sha256 mismatch (expected ${expected}, got ${got})`;
	if (allow)
		return {
			ok: true,
			warning: `${detail}; kept because ${ALLOW_FLAG} / ${ALLOW_ENV}=1 is set. The derive tools produced different bytes on this machine.`,
		};
	return { ok: false, error: detail };
}
