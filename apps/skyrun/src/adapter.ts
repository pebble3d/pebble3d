import type { EngineRenderer } from "@pebble3d/renderer";
import type { AdapterInfo } from "@pebble3d/sdk/game";

/** Copied from apps/rockfall/src/main.ts (the sdk does not export its probe). */
interface GpuAdapterInfoLike {
	vendor?: string;
	architecture?: string;
	device?: string;
	description?: string;
}
export async function adapterInfoOf(
	renderer: EngineRenderer,
): Promise<AdapterInfo> {
	const backend = renderer.stats().backend;
	const out: AdapterInfo = {
		backend,
		vendor: "",
		architecture: "",
		device: "",
		description: "",
	};
	const be = renderer.three.renderer.backend as {
		device?: { adapterInfo?: GpuAdapterInfoLike };
		gl?: WebGL2RenderingContext;
	};
	if (backend === "webgpu") {
		let info = be.device?.adapterInfo;
		if (!info) {
			const gpu = (
				navigator as {
					gpu?: {
						requestAdapter(
							o?: object,
						): Promise<{ info?: GpuAdapterInfoLike } | null>;
					};
				}
			).gpu;
			info = (await gpu?.requestAdapter({ featureLevel: "compatibility" }))
				?.info;
		}
		out.vendor = info?.vendor ?? "";
		out.architecture = info?.architecture ?? "";
		out.device = info?.device ?? "";
		out.description = info?.description ?? "";
		return out;
	}
	const gl = be.gl;
	if (gl) {
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		const vendor = String(
			gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
		);
		const device = String(
			gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
		);
		out.vendor = vendor;
		out.device = device;
		out.description = device;
		out.architecture = /swiftshader/i.test(device) ? "swiftshader" : "";
	}
	return out;
}
