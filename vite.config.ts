import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the site from /<repo-name>/
  base: "/piano-mate/",
  server: { host: true },
  // VexFlow embeds the Bravura music font, which alone is most of the bundle.
  build: { chunkSizeWarningLimit: 1000 },
});
