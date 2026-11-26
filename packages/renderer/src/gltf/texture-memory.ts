import {
	type Material,
	type Mesh,
	type Object3D,
	RGBAFormat,
	type Texture,
} from "three/webgpu";

/** Mip chain overhead: a full chain adds about one third. */
const MIP_FACTOR = 1.33;
/** ETC1S/UASTC transcode to BC7/ASTC/ETC2: about 1 byte per pixel. */
const COMPRESSED_BPP = 1;
const UNCOMPRESSED_BPP = 4;

function textureBytes(tex: Texture): number {
	const img = tex.image as
		| { width?: number; height?: number; depth?: number }
		| null
		| undefined;
	const w = img?.width ?? 0;
	const h = img?.height ?? 0;
	const d = img?.depth ?? 1;
	const compressed =
		(tex as { isCompressedTexture?: boolean }).isCompressedTexture === true;
	// Compressed (KTX2) textures ship their own mip chain; uncompressed ones are
	// mipped when the renderer generates mips or the source supplies a chain.
	const mipped =
		compressed || tex.generateMipmaps || (tex.mipmaps?.length ?? 0) > 1;
	// Bytes per pixel follow the GPU format, not the class: with no compressed format on
	// the device, KTX2Loader transcodes to RGBA32 but still returns a CompressedTexture.
	const block = compressed && tex.format !== RGBAFormat;
	const bpp = block ? COMPRESSED_BPP : UNCOMPRESSED_BPP;
	return w * h * d * bpp * (mipped ? MIP_FACTOR : 1);
}

function collect(mat: Material, seen: Set<Texture>): void {
	const rec = mat as unknown as Record<string, unknown>;
	for (const key in rec) {
		const v = rec[key] as { isTexture?: boolean } | null | undefined;
		if (v?.isTexture === true) seen.add(v as Texture);
	}
}

/**
 * Estimated GPU memory (bytes) of the unique textures on every mesh material under
 * `root`. Block-compressed: 1 B/px; RGBA (incl. a KTX2 RGBA fallback): 4 B/px;
 * mipmapped x1.33. Load-time only.
 */
export function estimateTextureBytes(root: Object3D): number {
	const seen = new Set<Texture>();
	root.traverse((o) => {
		const m = o as Mesh;
		if (!m.isMesh) return;
		const mats = Array.isArray(m.material) ? m.material : [m.material];
		for (const mat of mats) if (mat) collect(mat, seen);
	});
	let bytes = 0;
	for (const t of seen) bytes += textureBytes(t);
	return bytes;
}
