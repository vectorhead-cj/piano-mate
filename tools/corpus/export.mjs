// Writes public/phrases.json, the phrases the app practises from, from the extracted collections.
// Runs exportPhrases.ts through Vite so it can import the app's TypeScript directly.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dataDir = `${root}tools/corpus/data/collections`;
const outFile = `${root}public/phrases.json`;

const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { decodePhrases } = await server.ssrLoadModule("/tools/corpus/facts.ts");
  const { exportBank } = await server.ssrLoadModule("/tools/corpus/exportPhrases.ts");
  const files = readdirSync(dataDir).map((name) => JSON.parse(readFileSync(`${dataDir}/${name}`, "utf8")));
  const labels = Object.fromEntries(files.map((f) => [f.collection, f.label]));
  const bank = exportBank(files.flatMap(decodePhrases), labels);
  const json = JSON.stringify(bank);
  writeFileSync(outFile, json);
  console.log(`Wrote ${bank.phrases.length} phrases from ${bank.sources.length} sources to public/phrases.json (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
} finally {
  await server.close();
}
