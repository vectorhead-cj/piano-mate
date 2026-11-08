// The app's version: <major>.<minor> from package.json, and as patch the number of commits
// since package.json's version last changed, so every pushed commit shows a new version.
// Run directly (`npm run version:next`) to see the version at HEAD, the one deployed, and the next.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const git = (args) => execSync(`git ${args}`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** The version a build of `ref` shows; package.json's own version outside git. */
export function appVersion(ref = "HEAD") {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const [major, minor] = pkg.version.split(".");
  try {
    const bump = git(`log -1 --format=%H -G'"version":' -- package.json`);
    return `${major}.${minor}.${git(`rev-list --count ${bump}..${ref}`)}`;
  } catch {
    return pkg.version;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const head = appVersion("HEAD");
  const [major, minor, patch] = head.split(".");
  let deployed = "unknown";
  let ahead = 0;
  try {
    deployed = appVersion("origin/master");
    ahead = Number(git("rev-list --count origin/master..HEAD"));
  } catch {}
  console.log(`HEAD:        v${head}${ahead > 0 ? ` (${ahead} commit${ahead === 1 ? "" : "s"} not pushed)` : ""}`);
  console.log(`Deployed:    v${deployed} (origin/master, as of the last fetch)`);
  console.log(`Next commit: v${major}.${minor}.${Number(patch) + 1}`);
}
