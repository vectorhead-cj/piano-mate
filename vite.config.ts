import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

/** The patch number is the commit count, so every pushed commit shows a new version. */
function appVersion(): string {
  const [major, minor] = pkg.version.split(".");
  try {
    const commits = execSync("git rev-list --count HEAD", { encoding: "utf8" }).trim();
    return `${major}.${minor}.${commits}`;
  } catch {
    return pkg.version;
  }
}

// Read in index.html as %VITE_APP_VERSION%.
process.env.VITE_APP_VERSION = appVersion();

export default defineConfig({
  // GitHub Pages serves the site from /<repo-name>/.
  base: "/piano-mate/",
  server: { host: true },
  // VexFlow embeds the Bravura music font, which alone is most of the bundle.
  build: { chunkSizeWarningLimit: 2000 },
});
