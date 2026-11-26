import { describe, expect, it } from "vitest";
import {
	FALLBACK_NOTICE_ID,
	FALLBACK_NOTICE_TEXT,
	showFallbackNotice,
} from "../src/fallback-notice.ts";

/** Just enough of the DOM for the notice: elements with children, ids and click handlers. */
class FakeEl {
	id = "";
	type = "";
	textContent = "";
	style = { cssText: "" };
	attrs: Record<string, string> = {};
	children: FakeEl[] = [];
	parent: FakeEl | null = null;
	handlers: Record<string, () => void> = {};
	setAttribute(k: string, v: string): void {
		this.attrs[k] = v;
	}
	addEventListener(type: string, cb: () => void): void {
		this.handlers[type] = cb;
	}
	append(...els: FakeEl[]): void {
		for (const el of els) {
			el.parent = this;
			this.children.push(el);
		}
	}
	remove(): void {
		if (!this.parent) return;
		this.parent.children = this.parent.children.filter((c) => c !== this);
		this.parent = null;
	}
}

function fakeDoc() {
	const body = new FakeEl();
	const find = (el: FakeEl, id: string): FakeEl | null => {
		if (el.id === id) return el;
		for (const c of el.children) {
			const f = find(c, id);
			if (f) return f;
		}
		return null;
	};
	const doc = {
		body,
		createElement: () => new FakeEl(),
		getElementById: (id: string) => find(body, id),
	};
	return { body, doc: doc as unknown as Document };
}

describe("showFallbackNotice", () => {
	it("is a no-op without a DOM (Node)", () => {
		expect(showFallbackNotice(undefined)).toBeNull();
	});

	it("adds one status notice with the text and a dismiss button", () => {
		const { body, doc } = fakeDoc();
		const el = showFallbackNotice(doc) as unknown as FakeEl;
		expect(el.id).toBe(FALLBACK_NOTICE_ID);
		expect(el.attrs.role).toBe("status");
		expect(el.children[0]?.textContent).toBe(FALLBACK_NOTICE_TEXT);
		expect(showFallbackNotice(doc)).toBe(el as unknown as HTMLElement);
		expect(body.children).toHaveLength(1);

		const close = el.children[1];
		expect(close?.attrs["aria-label"]).toBe("Dismiss");
		close?.handlers.click?.();
		expect(body.children).toHaveLength(0);
	});
});
