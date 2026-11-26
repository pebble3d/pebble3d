import type { Object3D } from "three";

/**
 * Runs `render` with the scene's world matrices updated once up front and the per-render
 * auto-update suspended, restoring `matrixWorldAutoUpdate` afterwards (also on a throw).
 *
 * The pipeline renders the scene in several passes (AO prepass, scene pass), and each
 * renderer.render() would otherwise walk the whole scene graph again to update world
 * matrices (skinned crowds carry ~90 bones each).
 *
 * Caveat: objects must not be moved inside pass callbacks (`onBeforeRender` and the like).
 * Their world matrices are not recomputed until the next frame, so such moves lag a frame.
 * Move objects before `render` is called.
 */
export function renderWithFrozenMatrices(
	scene: Object3D,
	render: () => void,
): void {
	const auto = scene.matrixWorldAutoUpdate;
	if (auto) {
		scene.updateMatrixWorld();
		scene.matrixWorldAutoUpdate = false;
	}
	try {
		render();
	} finally {
		scene.matrixWorldAutoUpdate = auto;
	}
}
