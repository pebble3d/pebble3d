// Serves site/dist the way GitHub Pages will: under the base path (default /pebble3d/),
// directories resolve to index.html, unknown paths get dist/404.html with status 404.
//   node site/scripts/serve.mjs [port]      (default 5320)
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE } from "../site.config.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.argv[2] ?? process.env.PORT ?? 5320);

const TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".jpg": "image/jpeg",
	".png": "image/png",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".wasm": "application/wasm",
	".glb": "model/gltf-binary",
	".hdr": "application/octet-stream",
	".spz": "application/octet-stream",
	".pf_meta": "application/octet-stream",
	".pf_index": "application/octet-stream",
	".pf_fragment": "application/octet-stream",
	".pagefind": "application/octet-stream",
};

function resolve(urlPath) {
	if (!urlPath.startsWith(BASE)) return null;
	const rel = normalize(decodeURIComponent(urlPath.slice(BASE.length)));
	if (rel.startsWith("..")) return null;
	let file = join(DIST, rel);
	if (existsSync(file) && statSync(file).isDirectory()) {
		if (!urlPath.endsWith("/")) return { redirect: `${urlPath}/` };
		file = join(file, "index.html");
	}
	return existsSync(file) && statSync(file).isFile() ? { file } : null;
}

const server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://x");
	if (url.pathname === "/" || url.pathname === BASE.slice(0, -1)) {
		res.writeHead(302, { Location: BASE }).end();
		return;
	}
	const hit = resolve(url.pathname);
	if (hit?.redirect) {
		res.writeHead(301, { Location: hit.redirect + url.search }).end();
		return;
	}
	const file = hit?.file ?? join(DIST, "404.html");
	res.writeHead(hit ? 200 : 404, {
		"Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
		"Cache-Control": "no-cache",
	});
	if (req.method === "HEAD") res.end();
	else createReadStream(file).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
	console.log(`serving ${DIST} at http://127.0.0.1:${port}${BASE}`);
});
