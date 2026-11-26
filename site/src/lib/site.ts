import { BASE, REPO_BRANCH, REPO_URL, SITE_URL } from "../../site.config.mjs";
import data from "../data/games.json";

export { BASE, REPO_BRANCH, REPO_URL, SITE_URL };

export interface Link {
	label: string;
	href: string;
}
export interface Game {
	id: string;
	name: string;
	/** Directory under apps/. */
	app: string;
	blurb: string;
	tag: string;
	genre: string;
	pitch: string;
	controls: { keys: string; action: string }[];
	features: { title: string; text: string; links: Link[] }[];
	/** The first screenshot is the cover. Files live in public/shots/<id>/. */
	screenshots: { file: string; alt: string }[];
	caption: string;
	/** False while the demo does not render correctly on the WebGL fallback. */
	webglFallback: boolean;
}

export const games: Game[] = data.games;

/** A site path (`demos/`, `docs/x/#y`) or an absolute URL, as an href under the base. */
export function href(path: string): string {
	if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("#")) return path;
	return `${BASE}${path.replace(/^\/+/, "")}`;
}

/** The absolute URL of a site path. */
export function abs(path: string): string {
	return `${SITE_URL}${href(path)}`;
}

export const shot = (g: Game, i = 0): string =>
	href(`shots/${g.id}/${g.screenshots[i]?.file ?? g.screenshots[0]?.file}`);
export const playHref = (g: Game): string => href(`play/${g.id}/`);
export const pageHref = (g: Game): string => href(`demos/${g.id}/`);
export const sourceUrl = (path: string): string =>
	`${REPO_URL}/tree/${REPO_BRANCH}/${path}`;

/** "6 demos", written so it reads right for any count. */
export const demoCount = (n = games.length): string =>
	`${n} ${n === 1 ? "demo" : "demos"}`;

/** schema.org for the engine (used on the home page). */
export const engineJsonLd = [
	{
		"@context": "https://schema.org",
		"@type": "SoftwareSourceCode",
		name: "Pebble3D",
		codeRepository: REPO_URL,
		url: abs(""),
		description:
			"Source for Pebble3D, a browser 3D game engine: JSON scenes validated by a zod schema, three.js WebGPU rendering, and Rapier physics compiled from Rust to WebAssembly.",
		programmingLanguage: ["TypeScript", "Rust"],
		runtimePlatform: "Web browser (WebGPU, with a WebGL fallback)",
		license: `${REPO_URL}/blob/${REPO_BRANCH}/LICENSE`,
		author: { "@type": "Organization", name: "RJV Solutions" },
	},
	{
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "Pebble3D",
		applicationCategory: "DeveloperApplication",
		applicationSubCategory: "Game engine",
		operatingSystem: "Any (runs in a web browser)",
		url: abs(""),
		downloadUrl: REPO_URL,
		softwareHelp: abs("docs/"),
		license: `${REPO_URL}/blob/${REPO_BRANCH}/LICENSE`,
		author: { "@type": "Organization", name: "RJV Solutions" },
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "USD",
			description:
				"Free for organizations under USD $50,000 a year in revenue plus funding; a commercial licence above that.",
		},
	},
];

export function gameJsonLd(g: Game) {
	return {
		"@context": "https://schema.org",
		"@type": "VideoGame",
		name: g.name,
		description: g.pitch,
		url: abs(`demos/${g.id}/`),
		image: g.screenshots.map((s) => abs(`shots/${g.id}/${s.file}`)),
		genre: g.genre,
		gamePlatform: "Web browser",
		applicationCategory: "Game",
		operatingSystem: "Any (runs in a web browser)",
		playMode: "SinglePlayer",
		isAccessibleForFree: true,
		offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
		author: { "@type": "Organization", name: "RJV Solutions" },
	};
}
