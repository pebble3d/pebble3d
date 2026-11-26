/// <reference lib="webworker" />
// The Breakpoint sim worker: loads the Rapier wasm build, runs the Driver on its own clock
// and streams every displayed tick's packed state to the main thread (see WorkerHost).
import { loadSim } from "@pebble3d/sdk/sim";
import { Driver } from "./driver.ts";
import {
	type HostMsg,
	type LiveStatus,
	liveOf,
	MAX_BALLS,
	packSite,
	statusKey,
	type WorkerMsg,
} from "./host.ts";
import type { Site } from "./site.ts";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let driver: Driver | null = null;
const pool: Float32Array[] = [];
let paused = false;
let lastKey = "";
let fullAt = 0;

function send(m: WorkerMsg, transfer: Transferable[] = []): void {
	ctx.postMessage(m, transfer);
}

function packed(site: Site): { buf: Float32Array; balls: number } {
	const len = (site.n + MAX_BALLS) * 8;
	let buf = pool.pop();
	if (!buf || buf.length !== len) buf = new Float32Array(len);
	const balls = packSite(site, buf);
	return { buf, balls };
}

ctx.onmessage = async (e: MessageEvent<HostMsg>) => {
	const m = e.data;
	try {
		switch (m.t) {
			case "init": {
				const h = await loadSim(m.build, m.wasmUrl);
				const World = h.world.constructor as new (
					seed: number,
					g: number,
				) => typeof h.world;
				h.world.free();
				const src = { make: () => new World(1, -9.81), memory: h.memory };
				driver = new Driver(src, m.opts, {
					level: (i, seed, site) => {
						const p = packed(site);
						send({ t: "level", i, seed, ...p }, [p.buf.buffer]);
					},
					fire: (shot) => send({ t: "fire", shot }),
					shotDone: (r, best) => send({ t: "shotDone", r, best }),
					tick: (site) => {
						const p = packed(site);
						const st = (driver as Driver).snapshot();
						// The full status (with the results list) only when it changed shape or
						// every 100 ms; every tick carries the small live slice.
						const key = statusKey(st);
						const now = performance.now();
						const full = key !== lastKey || now - fullAt > 100;
						if (full) {
							lastKey = key;
							fullAt = now;
						}
						const live: LiveStatus = liveOf(st, {} as LiveStatus);
						send({ t: "tick", ...p, ...(full ? { status: st } : {}), live }, [
							p.buf.buffer,
						]);
					},
					replayStart: (i, seed, shot, result, site) => {
						const p = packed(site);
						send({ t: "replayStart", i, seed, shot, result, ...p }, [
							p.buf.buffer,
						]);
					},
					replayVerified: (ok, hash) => send({ t: "replayVerified", ok, hash }),
					replayEnd: () => {
						const d = driver as Driver;
						const p = packed(d.site);
						const s = d.session;
						send(
							{ t: "replayEnd", i: s.levelIndex, seed: s.levelSeed(), ...p },
							[p.buf.buffer],
						);
					},
				});
				send({ t: "status", status: driver.snapshot() });
				send({ t: "ready" });
				loop();
				break;
			}
			case "begin":
				driver?.begin();
				break;
			case "fire":
				driver?.fire(m.v[0], m.v[1], m.v[2]);
				break;
			case "advance":
				driver?.advance();
				break;
			case "replay":
				driver?.requestReplay();
				break;
			case "skip":
				driver?.skipReplay();
				break;
			case "timeScale":
				if (driver) driver.timeScale = m.s;
				break;
			case "pause":
				paused = m.on;
				last = performance.now(); // no catch-up for the hidden time
				break;
			case "recycle":
				if (pool.length < 8) pool.push(m.buf);
				break;
		}
	} catch (err) {
		send({
			t: "error",
			msg: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
		});
	}
};

let last = performance.now();
let statusAt = 0;
function loop(): void {
	const d = driver;
	if (!d) return;
	const now = performance.now();
	const dt = Math.min(0.1, (now - last) / 1000);
	last = now;
	if (paused) {
		setTimeout(loop, 50);
		return;
	}
	try {
		d.frame(dt);
		// Ticks carry the status; between ticks (title, cards) send it a few times a second.
		if (now - statusAt > 100) {
			statusAt = now;
			send({ t: "status", status: d.snapshot() });
		}
	} catch (err) {
		send({
			t: "error",
			msg: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
		});
		return;
	}
	setTimeout(loop, 2);
}
