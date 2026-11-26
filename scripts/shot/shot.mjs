#!/usr/bin/env node
// pnpm shot --scene <name> [--cam <preset>|controller] [--backend webgpu|webgl]
//           [--size 1280x720] [--resize WxH] [--ticks 120] [--script <name>] [--overlay]
//           [--splat <url>] [--debug splatOnly] [--allow-console-error "<substring>[:count]"]...
//           [--sequence <n>[:<every>]] [--fps <n>] [--scale <f>] [--no-frames]
//           [--app <dir>] [--param key=value]... [--out <dir>] [--name <basename>]
//           [--timeout <seconds>] [--port <n>] [--no-build] [--headed]
//
// --app picks another app under apps/ (default playground; --scene is then optional and
// app-specific query params go through --param). --out (inside artifacts/) and --name
// override the output directory and file basename. --timeout sets the per-wait timeout.
// --port serves the preview on that port (strict) instead of a free ephemeral one.
//
// Builds the app once (`pnpm --filter <app> build`, skipped with --no-build),
// serves it with `vite preview` on a free port, opens it in Chromium in fixed-tick mode and
// waits for `window.__pebble3d.done` (the frame at tick === --ticks has rendered). Then it
// writes artifacts/shots/<scene>-<cam>-<backend>-<w>x<h>.png and a .json sidecar
// {adapterInfo, stats, stateHash, tick, console: []}.
//
// --sequence <n>[:<every>] captures n fixed-mode frames, one every <every> sim ticks (default
// 1), starting at the frame for tick --ticks: <base>-f000.png ... plus <base>.webp, an
// animated WebP. Its frame rate is --fps, default 30 for every=1 (a 60 Hz sim plays at half
// speed) and 60/<every> otherwise (real time). The page's rAF is gated so each held frame is
// screenshotted before the next tick runs. --scale resizes the WebP frames (e.g. 0.75) and
// --no-frames deletes the frame PNGs after encoding. The .json sidecar describes the last
// frame (plus `game`, the app's __pebble3d.game snapshot, when the app exposes one).
//
// Exits 1 when: the requested backend is not the one that ran; the adapter is SwiftShader or
// a fallback adapter (after one headed retry); a console warning/error matches neither
// scripts/shot/console-allowlist.json nor an --allow-console-error; an --allow-console-error
// count is not met exactly; any uncaught page error; or a wait (e.g. for __pebble3d.done) exceeds --timeout
// (default 60 s).
//
// Process hygiene: it only ever kills the processes it spawned itself (the vite preview
// process group it started detached). Never pkill/killall.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUT_DIR = join(ROOT, "artifacts/shots");
const ALLOWLIST_PATH = join(ROOT, "scripts/shot/console-allowlist.json");
const DEFAULT_TIMEOUT_S = 60;
const SERVER_TIMEOUT_MS = 30_000;
const RESIZE_SETTLE_FRAMES = 10;
const CONSOLE_TAIL = 30;
const SEQUENCE_FPS_PER_TICK = 30;
// Spike decision (c): headless reaches the real GPU only with --use-angle=vulkan.
const CHROMIUM_ARGS = [
	"--enable-unsafe-webgpu",
	"--enable-features=Vulkan",
	"--ignore-gpu-blocklist",
	"--use-angle=vulkan",
];

class ShotError extends Error {}

// --- args -------------------------------------------------------------------------------

function parseSize(s, flag) {
	const m = /^(\d+)x(\d+)$/.exec(s ?? "");
	if (!m) throw new ShotError(`${flag} expects WxH, got "${s}"`);
	return { width: Number(m[1]), height: Number(m[2]) };
}

function parseArgs(argv) {
	const a = {
		scene: undefined,
		cam: undefined,
		backend: "webgpu",
		size: { width: 1280, height: 720 },
		resize: undefined,
		ticks: 120,
		script: undefined,
		overlay: false,
		splat: undefined,
		debug: undefined,
		allow: [],
		build: true,
		headed: false,
		sequence: undefined,
		fps: undefined,
		scale: undefined,
		keepFrames: true,
		app: "playground",
		params: [],
		out: undefined,
		name: undefined,
		timeout: DEFAULT_TIMEOUT_S,
		port: undefined,
	};
	const args = argv.filter((x) => x !== "--");
	for (let i = 0; i < args.length; i++) {
		const flag = args[i];
		const val = () => {
			const v = args[++i];
			if (v === undefined || v.startsWith("--"))
				throw new ShotError(`${flag} needs a value`);
			return v;
		};
		switch (flag) {
			case "--scene":
				a.scene = val();
				break;
			case "--cam":
				a.cam = val();
				break;
			case "--backend":
				a.backend = val();
				if (a.backend !== "webgpu" && a.backend !== "webgl")
					throw new ShotError(
						`--backend must be webgpu|webgl, got "${a.backend}"`,
					);
				break;
			case "--size":
				a.size = parseSize(val(), flag);
				break;
			case "--resize":
				a.resize = parseSize(val(), flag);
				break;
			case "--ticks":
				a.ticks = Number(val());
				if (!Number.isInteger(a.ticks) || a.ticks < 0)
					throw new ShotError("--ticks must be a non-negative integer");
				break;
			case "--script":
				a.script = val();
				break;
			case "--overlay":
				a.overlay = true;
				break;
			case "--splat":
				a.splat = val();
				break;
			case "--debug":
				a.debug = val();
				break;
			case "--allow-console-error": {
				const raw = val();
				const m = /^(.*):(\d+)$/.exec(raw);
				a.allow.push(
					m
						? { substring: m[1], count: Number(m[2]), seen: 0 }
						: { substring: raw, count: undefined, seen: 0 },
				);
				break;
			}
			case "--sequence": {
				const m = /^(\d+)(?::(\d+))?$/.exec(val());
				a.sequence = Number(m?.[1]);
				a.every = m?.[2] === undefined ? 1 : Number(m[2]);
				if (!m || a.sequence < 1 || a.every < 1)
					throw new ShotError(
						"--sequence expects <n> or <n>:<every>, both positive integers",
					);
				break;
			}
			case "--fps":
				a.fps = Number(val());
				if (!(a.fps > 0)) throw new ShotError("--fps must be > 0");
				break;
			case "--scale":
				a.scale = Number(val());
				if (!(a.scale > 0 && a.scale <= 1))
					throw new ShotError("--scale must be in (0, 1]");
				break;
			case "--no-frames":
				a.keepFrames = false;
				break;
			case "--app":
				a.app = val();
				break;
			case "--param": {
				const raw = val();
				const eq = raw.indexOf("=");
				if (eq <= 0)
					throw new ShotError(`--param expects key=value, got "${raw}"`);
				a.params.push([raw.slice(0, eq), raw.slice(eq + 1)]);
				break;
			}
			case "--out":
				a.out = resolve(ROOT, val());
				break;
			case "--name":
				a.name = val();
				break;
			case "--port":
				a.port = Number(val());
				if (!Number.isInteger(a.port) || a.port < 1024 || a.port > 65535)
					throw new ShotError("--port must be an integer in 1024..65535");
				break;
			case "--timeout":
				a.timeout = Number(val());
				if (!(a.timeout > 0))
					throw new ShotError("--timeout must be > 0 seconds");
				break;
			case "--no-build":
				a.build = false;
				break;
			case "--headed":
				a.headed = true;
				break;
			default:
				throw new ShotError(`unknown argument "${flag}"`);
		}
	}
	if (!a.scene && a.app === "playground")
		throw new ShotError("--scene <name> is required");
	if (!/^[\w-]+$/.test(a.app))
		throw new ShotError("--app must match /^[\\w-]+$/");
	const artifacts = join(ROOT, "artifacts");
	if (a.out !== undefined && !`${a.out}/`.startsWith(`${artifacts}/`))
		throw new ShotError("--out must be inside artifacts/");
	if (a.sequence !== undefined && a.ticks === 0)
		throw new ShotError(
			"--sequence cannot be combined with --ticks 0 (the sequence starts at tick --ticks and needs at least tick 1)",
		);
	if (a.sequence !== undefined && a.resize)
		throw new ShotError("--sequence cannot be combined with --resize");
	// These values land in the output filename; keep it inside the output directory.
	for (const [flag, v] of [
		["--scene", a.scene],
		["--cam", a.cam],
		["--debug", a.debug],
		["--name", a.name],
	]) {
		if (v !== undefined && (!/^[\w.-]+$/.test(v) || v === "." || v === ".."))
			throw new ShotError(`${flag} must match /^[\\w.-]+$/ (got "${v}")`);
	}
	return a;
}

// --- allowlist ---------------------------------------------------------------------------

/** Entry matches when `pattern` regex-matches the text AND (`type` absent OR equal). */
function loadAllowlist() {
	const json = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
	return (json.allow ?? []).map((e) => ({
		re: new RegExp(e.pattern),
		type: e.type,
	}));
}

// --- child processes (only ever ours) -----------------------------------------------------

const children = new Set();

function killChildren() {
	for (const child of children) {
		if (child.exitCode !== null || child.signalCode !== null) continue;
		try {
			// detached => the child leads its own process group; this signals only that group.
			process.kill(-child.pid, "SIGTERM");
		} catch {
			try {
				child.kill("SIGTERM");
			} catch {}
		}
	}
	children.clear();
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(sig, () => {
		killChildren();
		process.exit(1);
	});
}
process.on("exit", killChildren);

function freePort() {
	return new Promise((res, rej) => {
		const srv = createServer();
		srv.unref();
		srv.on("error", rej);
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => res(port));
		});
	});
}

function build(app) {
	const r = spawnSync("pnpm", ["--filter", app, "build"], {
		cwd: ROOT,
		stdio: ["ignore", "inherit", "inherit"],
	});
	if (r.status !== 0)
		throw new ShotError(`${app} build failed (exit ${r.status})`);
}

async function startPreview(appDir, fixedPort) {
	const port = fixedPort ?? (await freePort());
	const viteBin = join(appDir, "node_modules/vite/bin/vite.js");
	const child = spawn(
		process.execPath,
		[
			viteBin,
			"preview",
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--strictPort",
		],
		{ cwd: appDir, detached: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	children.add(child);
	let log = "";
	child.stdout.on("data", (d) => (log += d));
	child.stderr.on("data", (d) => (log += d));
	const url = `http://127.0.0.1:${port}/`;
	const t0 = Date.now();
	while (Date.now() - t0 < SERVER_TIMEOUT_MS) {
		if (child.exitCode !== null)
			throw new ShotError(`vite preview exited early:\n${log}`);
		try {
			const r = await fetch(url);
			if (r.ok) return url;
		} catch {}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new ShotError(`vite preview did not come up on ${url}:\n${log}`);
}

// --- capture -------------------------------------------------------------------------------

function isSoftwareAdapter(info, fallback) {
	return (
		fallback === true ||
		/swiftshader/i.test(info?.architecture ?? "") ||
		/swiftshader/i.test(info?.device ?? "") ||
		/swiftshader/i.test(info?.description ?? "")
	);
}

async function capture(baseUrl, a, headless, allowlist) {
	const browser = await chromium.launch({
		channel: "chromium",
		headless,
		args: CHROMIUM_ARGS,
	});
	const lines = []; // every console line, for the timeout tail
	const flagged = []; // warning/error lines -> sidecar `console`
	const failures = [];
	try {
		const page = await browser.newPage({
			viewport: a.size,
			deviceScaleFactor: 1,
		});
		page.on("console", (msg) => {
			const type = msg.type();
			const text = msg.text();
			lines.push(`[${type}] ${text}`);
			if (type !== "error" && type !== "warning") return;
			if (
				allowlist.some((e) => e.re.test(text) && (!e.type || e.type === type))
			)
				return;
			const flag = a.allow.find((x) => text.includes(x.substring));
			if (flag) flag.seen++;
			flagged.push({
				type,
				text,
				...(flag ? { allowedBy: flag.substring } : {}),
			});
			if (!flag) failures.push(`console ${type} not allowlisted: ${text}`);
		});
		page.on("pageerror", (err) => {
			const text = `${err.name}: ${err.message}`;
			lines.push(`[pageerror] ${text}`);
			flagged.push({ type: "pageerror", text });
			failures.push(`page error: ${text}`);
		});

		if (a.sequence !== undefined)
			await page.addInitScript(gateAnimationFrames, a.ticks);
		const lastTick = a.ticks + ((a.sequence ?? 1) - 1) * (a.every ?? 1);
		const q = new URLSearchParams({
			mode: "fixed",
			ticks: String(lastTick),
			backend: a.backend,
		});
		if (a.scene !== undefined) q.set("scene", a.scene);
		if (a.cam !== undefined) q.set("cam", a.cam);
		if (a.script) q.set("script", a.script);
		if (a.overlay) q.set("overlay", "1");
		if (a.splat) q.set("splat", a.splat);
		if (a.debug) q.set("debug", a.debug);
		for (const [k, v] of a.params) q.set(k, v);
		await page.goto(`${baseUrl}?${q}`);

		const tail = () =>
			lines.slice(-CONSOLE_TAIL).join("\n") || "(no console output)";
		const waitHook = async (expr, what, timeout = a.timeout * 1000) => {
			try {
				await page.waitForFunction(
					`(() => { const v = window.__pebble3d; if (v && v.error) return true; return ${expr}; })()`,
					null,
					{ timeout, polling: 50 },
				);
			} catch {
				throw new ShotError(
					`timed out after ${timeout / 1000}s waiting for ${what}\nlast console lines:\n${tail()}`,
				);
			}
			const err = await page.evaluate(() => window.__pebble3d?.error);
			if (err)
				throw new ShotError(
					`${a.app} failed: ${err}\nlast console lines:\n${tail()}`,
				);
		};

		await waitHook("v !== undefined && v.ready === true", "__pebble3d.ready");

		const adapterInfo = await page.evaluate(
			() => window.__pebble3d.adapterInfo,
		);
		const fallback =
			a.backend === "webgpu"
				? await page.evaluate(async () => {
						const ad = await navigator.gpu?.requestAdapter();
						return ad?.isFallbackAdapter ?? ad?.info?.isFallbackAdapter;
					})
				: undefined;
		if (isSoftwareAdapter(adapterInfo, fallback))
			return { software: true, adapterInfo };
		if (adapterInfo.backend !== a.backend)
			throw new ShotError(
				`requested backend ${a.backend} but the page ran ${adapterInfo.backend}`,
			);

		let size = a.size;
		if (a.resize) {
			await page.setViewportSize(a.resize);
			size = a.resize;
			const f0 = await page.evaluate(() => window.__pebble3d.frame);
			await waitHook(
				`v.frame >= ${f0 + RESIZE_SETTLE_FRAMES}`,
				"resize settle frames",
			);
		}
		const base =
			a.name ??
			`${a.scene ?? a.app}-${a.cam ?? "default"}-${a.backend}-${size.width}x${size.height}${a.debug ? `-${a.debug}` : ""}`;
		const outDir = a.out ?? DEFAULT_OUT_DIR;
		mkdirSync(outDir, { recursive: true });
		const frames = [];
		if (a.sequence !== undefined) {
			for (let i = 0; i < a.sequence; i++) {
				const t = a.ticks + i * a.every;
				if (i > 0)
					await page.evaluate((to) => window.__shotGate.advanceTo(to), t);
				// Held: the frame for tick t has rendered and the next rAF is parked.
				await waitHook(
					`v.tick === ${t} && window.__shotGate.held()`,
					`sequence frame ${i} (tick ${t})`,
				);
				const f = join(outDir, `${base}-f${String(i).padStart(3, "0")}.png`);
				await page.screenshot({
					path: f,
					animations: "disabled",
					caret: "hide",
				});
				frames.push(f);
			}
			await page.evaluate(() => window.__shotGate.open());
		}
		await waitHook("v.done === true", "__pebble3d.done");

		const result = await page.evaluate(() => {
			const v = window.__pebble3d;
			const s = v.stats();
			return {
				adapterInfo: v.adapterInfo,
				stats: { ...s, errors: [...s.errors] },
				stateHash: v.stateHash(),
				tick: v.tick,
			};
		});
		const canvasSize = await page.evaluate(() => {
			const c = document.querySelector("canvas");
			return c ? { width: c.width, height: c.height } : null;
		});
		if (
			!canvasSize ||
			canvasSize.width !== size.width ||
			canvasSize.height !== size.height
		)
			throw new ShotError(
				`canvas is ${JSON.stringify(canvasSize)}, expected ${size.width}x${size.height}`,
			);

		let png;
		if (a.sequence === undefined) {
			png = join(outDir, `${base}.png`);
			await page.screenshot({
				path: png,
				animations: "disabled",
				caret: "hide",
			});
		} else {
			png = join(outDir, `${base}.webp`);
			const fps =
				a.fps ?? (a.every === 1 ? SEQUENCE_FPS_PER_TICK : 60 / a.every);
			await writeAnimatedWebp(frames, png, fps, a.scale);
			if (!a.keepFrames) {
				for (const f of frames) rmSync(f, { force: true });
				frames.length = 0;
			}
		}

		for (const x of a.allow) {
			if (x.count !== undefined && x.seen !== x.count)
				failures.push(
					`--allow-console-error "${x.substring}" expected exactly ${x.count} match(es), saw ${x.seen}`,
				);
		}
		const game = await page.evaluate(() => {
			const g = window.__pebble3d?.game;
			if (!g) return undefined;
			const out = {};
			for (const [k, f] of Object.entries(g))
				out[k] = typeof f === "function" ? f() : f;
			return out;
		});
		const sidecar = { ...result, ...(game ? { game } : {}), console: flagged };
		const json = join(outDir, `${base}.json`);
		writeFileSync(json, `${JSON.stringify(sidecar, null, 2)}\n`);
		return { software: false, png, json, sidecar, failures, frames };
	} finally {
		await browser.close();
	}
}

// --- sequence ----------------------------------------------------------------------------

/**
 * Page init script (serialised by Playwright, so self-contained). Wraps requestAnimationFrame:
 * once `__pebble3d.tick >= from`, each frame callback is parked until the shot releases it, so
 * exactly one sim tick renders per screenshot. `advanceTo(t)` moves `from` to `t` and lets
 * frames run (one fixed-mode tick each) until the tick reaches it, then parks again.
 */
function gateAnimationFrames(from) {
	const raf = window.requestAnimationFrame.bind(window);
	let parked = [];
	let gated = true;
	window.requestAnimationFrame = (cb) =>
		raf((ts) => {
			const v = window.__pebble3d;
			if (gated && v?.ready && v.tick >= from) parked.push(cb);
			else cb(ts);
		});
	// Runs every parked callback (the game loop and any other rAF user) in one real frame.
	const flush = () => {
		const cbs = parked;
		parked = [];
		raf((ts) => {
			for (const cb of cbs) cb(ts);
		});
	};
	window.__shotGate = {
		held: () => parked.length > 0,
		release: flush,
		advanceTo: (t) => {
			from = t;
			flush();
		},
		open: () => {
			gated = false;
			flush();
		},
	};
}

async function writeAnimatedWebp(frames, out, fps, scale) {
	const delay = Math.round(1000 / fps);
	const { default: sharp } = await import("sharp");
	let inputs = frames;
	if (scale !== undefined && scale !== 1) {
		const meta = await sharp(frames[0]).metadata();
		const width = Math.round((meta.width ?? 0) * scale);
		inputs = await Promise.all(
			frames.map((f) => sharp(f).resize({ width }).png().toBuffer()),
		);
	}
	await sharp(inputs, { join: { animated: true } })
		.webp({ quality: 82, loop: 0, delay: frames.map(() => delay) })
		.toFile(out);
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	const allowlist = loadAllowlist();
	const appDir = join(ROOT, "apps", a.app);
	if (a.build) build(a.app);
	const url = await startPreview(appDir, a.port);

	let r = await capture(url, a, !a.headed, allowlist);
	if (
		r.software &&
		!a.headed &&
		(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
	) {
		console.error("shot: headless got a software adapter; retrying headed");
		for (const x of a.allow) x.seen = 0;
		r = await capture(url, a, false, allowlist);
	}
	if (r.software)
		throw new ShotError(
			`software/fallback adapter (SwiftShader) refused: ${JSON.stringify(r.adapterInfo)}`,
		);

	if (r.frames.length > 0)
		console.log(`shot: ${r.frames.length} frames ${r.frames[0]} ...`);
	console.log(`shot: ${r.png}`);
	console.log(`shot: ${r.json}`);
	console.log(
		`shot: backend=${r.sidecar.adapterInfo.backend} adapter=${r.sidecar.adapterInfo.vendor}/${r.sidecar.adapterInfo.architecture} tick=${r.sidecar.tick} stateHash=${r.sidecar.stateHash}`,
	);
	if (r.failures.length > 0) {
		for (const f of r.failures) console.error(`shot: FAIL ${f}`);
		return 1;
	}
	return 0;
}

main()
	.then((code) => {
		killChildren();
		process.exit(code);
	})
	.catch((e) => {
		killChildren();
		console.error(
			`shot: FAIL ${e instanceof ShotError ? e.message : (e?.stack ?? e)}`,
		);
		process.exit(1);
	});
