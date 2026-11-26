import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { BASE, REPO_URL, SITE_URL } from "./site.config.mjs";

export default defineConfig({
	site: SITE_URL,
	base: BASE,
	trailingSlash: "always",
	// Keep source whitespace: compression drops the space between a line-ending word and
	// a link on the next line ("the<a>examples</a>").
	compressHTML: false,
	// No client JS on the marketing pages (Starlight would turn link prefetching on).
	prefetch: false,
	build: { format: "directory" },
	integrations: [
		// The games under play/<id>/ are bare app pages, so the sitemap lists their demo
		// pages instead. Starlight sees this sitemap and does not add its own.
		sitemap(),
		starlight({
			title: "Pebble3D",
			description:
				"Pebble3D is a browser 3D game engine built for AI coding agents: JSON scenes checked by a schema, deterministic Rust/WASM physics, WebGPU rendering and Gaussian splats.",
			logo: { src: "./src/assets/pebble.svg", alt: "" },
			favicon: "/favicon.svg",
			head: [
				{
					tag: "meta",
					attrs: {
						property: "og:image",
						content: `${SITE_URL}${BASE}og/home.jpg`,
					},
				},
				{
					tag: "meta",
					attrs: {
						name: "twitter:image",
						content: `${SITE_URL}${BASE}og/home.jpg`,
					},
				},
			],
			social: [{ icon: "github", label: "GitHub", href: REPO_URL }],
			customCss: [
				"@fontsource/space-grotesk/latin-400.css",
				"@fontsource/space-grotesk/latin-500.css",
				"@fontsource/space-grotesk/latin-700.css",
				"@fontsource/jetbrains-mono/latin-400.css",
				"@fontsource/jetbrains-mono/latin-600.css",
				"./src/styles/starlight.css",
			],
			components: {
				ThemeProvider: "./src/components/starlight/ThemeProvider.astro",
				ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
				SocialIcons: "./src/components/starlight/SocialIcons.astro",
				PageTitle: "./src/components/starlight/PageTitle.astro",
			},
			expressiveCode: {
				themes: ["github-dark-default"],
				styleOverrides: {
					borderColor: "#2A2C31",
					borderRadius: "10px",
					codeBackground: "#15171B",
					codeFontFamily: "'JetBrains Mono', ui-monospace, monospace",
					uiFontFamily: "'Space Grotesk', system-ui, sans-serif",
					frames: {
						editorTabBarBackground: "#121317",
						terminalTitlebarBackground: "#121317",
						frameBoxShadowCssValue: "none",
					},
				},
			},
			sidebar: [
				{
					label: "Start here",
					items: [
						{ label: "Overview", slug: "docs" },
						"docs/getting-started",
						{ label: "AGENTS.md", slug: "docs/agents" },
					],
				},
				{
					label: "Reference",
					items: [
						"docs/scene-reference",
						"docs/api-reference",
						"docs/examples",
					],
				},
				{
					label: "Verify and debug",
					items: ["docs/verification", "docs/troubleshooting"],
				},
				{
					label: "Cookbook",
					items: [{ autogenerate: { directory: "docs/cookbook" } }],
				},
				{
					label: "More",
					items: [
						// Starlight adds the base to these links itself.
						{ label: "Demos", link: "/demos/" },
						{ label: "Build with AI", link: "/build-with-ai/" },
						// Absolute, so no trailing slash is added to the file name.
						{ label: "llms.txt", link: `${SITE_URL}${BASE}llms.txt` },
					],
				},
			],
			pagefind: true,
		}),
	],
});
