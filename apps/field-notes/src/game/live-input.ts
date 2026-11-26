import { BTN, type TickInput } from "./input.ts";

/** Radians of photo look per pixel of locked mouse movement at the default 50 degree FOV. */
const LOOK_SENS = 0.0021;
/** FOV degrees per wheel notch (deltaY 100). */
const ZOOM_PER_NOTCH = 3;

const HELD: Record<string, number> = {
	KeyW: BTN.F,
	ArrowUp: BTN.F,
	KeyS: BTN.B,
	ArrowDown: BTN.B,
	KeyA: BTN.L,
	ArrowLeft: BTN.L,
	KeyD: BTN.R,
	ArrowRight: BTN.R,
	ShiftLeft: BTN.SPRINT,
	ShiftRight: BTN.SPRINT,
};

const EDGE: Record<string, number> = {
	KeyC: BTN.PHOTO,
	KeyF: BTN.AF,
	KeyE: BTN.EV_UP,
	KeyQ: BTN.EV_DOWN,
	Enter: BTN.START,
	NumpadEnter: BTN.START,
};

/**
 * Keyboard and mouse to TickInput. It owns the movement keys: a capture-phase listener
 * stops the engine's own WASD bindings so photo mode can freeze the character. Edges
 * (presses) latch until the next tick consumes them.
 */
export class LiveInput {
	private held = 0;
	private edges = 0;
	private space = false;
	private focusDir = 0;
	private dx = 0;
	private dy = 0;
	private wheel = 0;
	/** Photo mode or not (set by the app each frame; changes what Space and clicks do). */
	photo = false;
	/** Title / results: any click starts. */
	menu = true;

	constructor(private readonly canvas: HTMLCanvasElement) {
		window.addEventListener("keydown", this.onKey, { capture: true });
		window.addEventListener("keyup", this.onKey, { capture: true });
		window.addEventListener("blur", () => {
			this.held = 0;
			this.space = false;
			this.focusDir = 0;
		});
		canvas.addEventListener("mousedown", this.onMouseDown);
		canvas.addEventListener("contextmenu", (e) => e.preventDefault());
		canvas.addEventListener("wheel", this.onWheel, { passive: false });
		document.addEventListener("mousemove", this.onMouseMove);
	}

	private readonly onKey = (e: KeyboardEvent): void => {
		const down = e.type === "keydown";
		const h = HELD[e.code];
		let handled = false;
		if (h !== undefined) {
			this.held = down ? this.held | h : this.held & ~h;
			handled = true;
		}
		if (down && !e.repeat) {
			const ed = EDGE[e.code];
			if (ed !== undefined) {
				this.edges |= ed;
				handled = true;
			}
		}
		if (e.code === "Space") {
			if (down && !e.repeat)
				this.edges |= this.photo ? BTN.SHUTTER : this.menu ? BTN.START : 0;
			this.space = down;
			handled = true;
		}
		if (e.code === "KeyZ" || e.code === "KeyX") {
			this.focusDir = down ? (e.code === "KeyZ" ? -1 : 1) : 0;
			handled = true;
		}
		if (handled) {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	};

	private readonly onMouseDown = (e: MouseEvent): void => {
		if (this.menu) {
			if (e.button === 0) this.edges |= BTN.START;
			return;
		}
		if (e.button === 2) {
			this.edges |= BTN.PHOTO;
			return;
		}
		if (e.button === 0 && this.photo) {
			if (document.pointerLockElement !== this.canvas)
				void this.canvas.requestPointerLock()?.catch?.(() => {});
			else this.edges |= BTN.SHUTTER;
		}
	};

	private readonly onMouseMove = (e: MouseEvent): void => {
		if (!this.photo || document.pointerLockElement !== this.canvas) return;
		this.dx += e.movementX;
		this.dy += e.movementY;
	};

	private readonly onWheel = (e: WheelEvent): void => {
		if (!this.photo) return;
		e.preventDefault();
		this.wheel += e.deltaY / 100;
	};

	/** Fills `out` for one tick. `camYaw` is the exploration camera's yaw. */
	sample(out: TickInput, camYaw: number, fovDeg: number, focus: number): void {
		out.buttons = this.held | this.edges;
		if (this.space && !this.photo) out.buttons |= BTN.JUMP;
		this.edges = 0;
		out.camYaw = camYaw;
		const k = LOOK_SENS * (fovDeg / 50);
		out.lookYaw = -this.dx * k;
		out.lookPitch = -this.dy * k;
		out.zoom = this.wheel * ZOOM_PER_NOTCH;
		out.focus = this.focusDir * 0.02 * Math.max(1, focus / 2.5);
		this.dx = 0;
		this.dy = 0;
		this.wheel = 0;
	}
}
