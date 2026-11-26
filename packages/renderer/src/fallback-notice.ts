/** `id` of the notice element, so it is shown at most once per page. */
export const FALLBACK_NOTICE_ID = "pebble3d-webgl-notice";

export const FALLBACK_NOTICE_TEXT =
	"WebGPU is not available in this browser, so this demo is running on the WebGL fallback. Some effects may look different or run slower.";

/**
 * Shows a small dismissible notice (bottom-left, above the game) saying the renderer fell
 * back to WebGL. Idempotent; a no-op without a DOM. Returns the element, or null.
 */
export function showFallbackNotice(
	doc: Document | undefined = globalThis.document,
): HTMLElement | null {
	if (!doc?.body) return null;
	const existing = doc.getElementById(FALLBACK_NOTICE_ID);
	if (existing) return existing;
	const box = doc.createElement("div");
	box.id = FALLBACK_NOTICE_ID;
	box.setAttribute("role", "status");
	box.style.cssText =
		"position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:min(420px,calc(100vw - 24px));" +
		"display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;" +
		"background:rgba(21,23,27,0.94);border:1px solid #2A2C31;color:#ECEAE6;" +
		"font:13px/1.45 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.35)";
	const text = doc.createElement("span");
	text.textContent = FALLBACK_NOTICE_TEXT;
	const close = doc.createElement("button");
	close.type = "button";
	close.textContent = "×";
	close.setAttribute("aria-label", "Dismiss");
	close.style.cssText =
		"flex:none;border:0;background:none;color:#B9B5AE;font-size:18px;line-height:1;cursor:pointer;padding:0 2px";
	close.addEventListener("click", () => box.remove());
	box.append(text, close);
	doc.body.append(box);
	return box;
}
