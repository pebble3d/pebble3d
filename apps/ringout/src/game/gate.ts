/**
 * Menu-key lockout. Space and Enter are also the dash keys, so a player still mashing dash
 * when a screen appears must not skip the replay, dismiss the verdict or start a rematch.
 * `arm()` on entering such a screen; presses during the lockout are swallowed.
 */
export class MenuGate {
	static readonly LOCK = 0.75;
	private left = 0;

	arm(seconds = MenuGate.LOCK): void {
		this.left = seconds;
	}

	tick(dt: number): void {
		if (this.left > 0) this.left = Math.max(0, this.left - dt);
	}

	get locked(): boolean {
		return this.left > 0;
	}

	/** True when a confirm press should act (`pressed` is consumed either way by the caller). */
	accept(pressed: boolean): boolean {
		return pressed && this.left <= 0;
	}
}
