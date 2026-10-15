import { glob } from "node:fs/promises";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { getSlugs } from "fumadocs-core/source";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

import { getPageImageUrl } from "./src/lib/shared";

const imageRoutes: string[] = [];
for await (const entry of glob("**/*.mdx", { cwd: "content/docs" })) {
  imageRoutes.push(getPageImageUrl({ slugs: getSlugs(entry) }).url);
}

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: {
          enabled: true,
          crawlLinks: true,
        },
      },

      pages: [
        {
          path: "/docs",
        },
        {
          path: "/api/search",
        },
        {
          path: "llms-full.txt",
        },
        {
          path: "llms.txt",
        },
      ],
    }),
    react(),
    // please see https://tanstack.com/start/latest/docs/framework/react/guide/hosting#nitro for guides on hosting
    nitro({
      // TanStack Start pre-renders responses as text, which breaks images
      prerender: { routes: imageRoutes },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: "tslib/tslib.es6.js",
    },
  },
});
