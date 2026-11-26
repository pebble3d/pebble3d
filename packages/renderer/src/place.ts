import type { Object3D } from "three";
import type { RenderEntity } from "./types.ts";

/** Places a slot-less (body-less decor) object at the entity's carried transform. */
export function placeStatic(
	obj: Object3D,
	e: Pick<RenderEntity, "position" | "rotation">,
): void {
	if (e.position) obj.position.set(e.position[0], e.position[1], e.position[2]);
	if (e.rotation)
		obj.quaternion.set(
			e.rotation[0],
			e.rotation[1],
			e.rotation[2],
			e.rotation[3],
		);
}
