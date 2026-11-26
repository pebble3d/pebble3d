// Where fetch-assets caches a derived asset's (sha256-verified) source files. Shared with the
// tests so they can find the real cached sources without downloading.
import { join } from "node:path";

export const safeName = (s) =>
	typeof s === "string" && /^[\w.-]+$/.test(s) && s !== "." && s !== "..";

/** File name of a source URL (last path segment, no query); throws on an unsafe name. */
export function sourceFileName(url) {
	const name = String(url).split("/").pop().split("?")[0];
	if (!safeName(name)) throw new Error(`bad source file name "${name}"`);
	return name;
}

/**
 * Cache path of an asset's source: `<id>--<file>` for the primary `url`, and
 * `<id>--<key>--<file>` for a keyed `derive.sources` entry.
 */
export function sourceCachePath(root, id, key, url) {
	if (!safeName(id)) throw new Error(`bad asset id "${id}"`);
	if (key !== null && !safeName(key))
		throw new Error(`bad source key "${key}"`);
	const name = sourceFileName(url);
	return join(
		root,
		"node_modules/.cache/pebble3d-assets",
		key === null ? `${id}--${name}` : `${id}--${key}--${name}`,
	);
}
