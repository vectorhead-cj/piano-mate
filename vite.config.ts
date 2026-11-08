import { defineConfig } from "vite";
import { appVersion } from "./scripts/version.mjs";

// Read in index.html as %VITE_APP_VERSION%.
process.env.VITE_APP_VERSION = appVersion();

export default defineConfig({
  // GitHub Pages serves the site from /<repo-name>/.
  base: "/piano-mate/",
  server: { host: true },
  // VexFlow embeds the Bravura music font, which alone is most of the bundle.
  build: { chunkSizeWarningLimit: 2000 },
});
