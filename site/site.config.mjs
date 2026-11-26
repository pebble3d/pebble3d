// The one place the public URL lives. A custom domain later is a change here (or the env
// vars below in CI): PEBBLE3D_SITE_URL=https://pebble3d.com PEBBLE3D_SITE_BASE=/
const rawBase = process.env.PEBBLE3D_SITE_BASE ?? "/pebble3d/";

/** Origin the site is served from, without a trailing slash. */
export const SITE_URL = (
	process.env.PEBBLE3D_SITE_URL ?? "https://pebble3d.github.io"
).replace(/\/+$/, "");

/** Path prefix of every page and file, with leading and trailing slashes ("/" for none). */
export const BASE = `/${rawBase.replace(/^\/+|\/+$/g, "")}/`.replace(
	/^\/\/$/,
	"/",
);

/** The public repository. */
export const REPO_URL = "https://github.com/pebble3d/pebble3d";

/** Branch used for "View source" and doc links into the repo. */
export const REPO_BRANCH = "main";
