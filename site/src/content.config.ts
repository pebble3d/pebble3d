import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { z } from "astro/zod";

// src/content/docs is generated from the repo's docs/ by scripts/sync.mjs.
export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
				/** Site path of this page's raw markdown twin. */
				rawMarkdown: z.string().optional(),
				/** Repo path of the source file. */
				sourcePath: z.string().optional(),
			}),
		}),
	}),
};
