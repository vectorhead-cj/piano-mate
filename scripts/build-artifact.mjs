// Builds the app as a single self-contained HTML fragment for publishing as a Claude artifact.
// The artifact host wraps the page in its own <!doctype>/<html>/<head>/<body> skeleton and only
// allows scripts from a few CDNs, so all JS and CSS is inlined and the document tags are stripped.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";

const outDir = "dist-artifact";
const outFile = join(outDir, "piano-mate.html");

await build({ mode: "artifact", build: { outDir, emptyOutDir: true, modulePreload: false } });

const html = readFileSync(join(outDir, "index.html"), "utf8");
const asset = (href) => readFileSync(join(outDir, href.replace(/^\.\//, "")), "utf8");

const inlined = html
  .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => {
    // A literal "</script" inside the bundle would end the inline tag early.
    const js = asset(src).replace(/<\/script/gi, "<\\/script");
    return `<script type="module">${js}</script>`;
  })
  .replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => `<style>${asset(href)}</style>`);

const head = inlined.match(/<head>([\s\S]*)<\/head>/)?.[1];
const body = inlined.match(/<body>([\s\S]*)<\/body>/)?.[1];
if (head === undefined || body === undefined) throw new Error("Unexpected index.html shape");
if (/src="\.?\/?assets\//.test(inlined) || /href="\.?\/?assets\//.test(inlined)) {
  throw new Error("An asset reference was not inlined");
}

// The skeleton already sets charset and viewport; the <title> must stay near the top of the file.
const headKept = head
  .replace(/<meta charset="[^"]*"\s*\/?>/i, "")
  .replace(/<meta\s+name="viewport"[\s\S]*?\/?>/i, "")
  .replace(/<title>[^<]*<\/title>/i, "");

writeFileSync(outFile, `<title>Piano Mate</title>\n${headKept.trim()}\n${body.trim()}\n`);
console.log(`Wrote ${outFile} (${(readFileSync(outFile).length / 1024).toFixed(0)} KB)`);

// Vite copies public/ into the build; the page fetches the phrase corpus from beside itself,
// so the artifact must publish it as a supporting file at the same relative path.
const phrases = join(outDir, "phrases.json");
if (!existsSync(phrases)) throw new Error(`${phrases} is missing; run npm run corpus:export`);
console.log(`Publish ${phrases} beside it as "phrases.json" (${(readFileSync(phrases).length / 1024).toFixed(0)} KB)`);
