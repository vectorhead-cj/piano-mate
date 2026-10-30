import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the site from /<repo-name>/; the artifact build is inlined, so paths stay relative.
  base: mode === "artifact" ? "./" : "/piano-mate/",
  server: { host: true },
  // VexFlow embeds the Bravura music font, which alone is most of the bundle.
  build: { chunkSizeWarningLimit: 2000 },
}));
