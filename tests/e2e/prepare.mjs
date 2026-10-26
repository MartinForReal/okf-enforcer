// Prepare only our disposable fixture. Does not launch an app or touch user vaults.
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, unlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { execFileSync } from "node:child_process";

const existing = process.argv[2];
const root = existing ? path.resolve(existing) : await mkdtemp(path.join(tmpdir(), "okf-enforcer-e2e-"));
if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("okf-enforcer-e2e-")) {
  throw new Error("Fixture root must be our own unique temp directory");
}
if (existing && JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8")).kind !== "okf-enforcer-e2e") {
  throw new Error("Refusing to update an unmarked fixture");
}
const vault = path.join(root, "OKF API E2E"), profile = path.join(root, "profile"), evidence = path.join(root, "evidence");
const provider = path.join(vault, ".obsidian/plugins/okf-enforcer");
const consumer = path.join(vault, ".obsidian/plugins/okf-api-e2e-consumer");
await Promise.all([provider, consumer, profile, evidence].map((p) => mkdir(p, { recursive: true })));
const fixtures = {
  "clean.md": "---\ntype: Concept\ntitle: Clean note\npolicy:\n  owners:\n    - human:fixture\n---\n\n# Clean note\n",
  "broken.md": "# Missing frontmatter\n",
  "invalid-yaml.md": "---\ntype: [unterminated\n---\n\n# Invalid YAML\n",
  "computation.md": "---\ntype: Attested Computation\n---\n\n# No runtime\n",
  "fix-me.md": "# Fix this fixture\n",
  "index.md": "---\nokf_version: '0.2'\n---\n\n# Concepts\n\n* [Clean](clean.md)\n",
  "nested/note.md": "---\ntype: Topic\n---\n\n# Nested note\n",
  "nested/index.md": "# Concepts\n\n* [Nested note](note.md)\n",
  "gap/note.md": "---\ntype: Concept\n---\n",
  "Excluded/private.md": "# Excluded invalid note\n",
  ".obsidian/hidden.md": "# Configuration is not a concept\n",
};
for (const [relative, text] of Object.entries(fixtures)) {
  const target = path.join(vault, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text);
}
// Reset exactly the artifact created by our intentional missing-index control.
// Marker/root checks above authorize only this fixture; never recursively clean it.
const gap = path.resolve(vault, "gap"), generatedIndex = path.resolve(gap, "index.md");
if (!generatedIndex.startsWith(vault + path.sep) || (await lstat(gap)).isSymbolicLink()) throw new Error("Unsafe fixture control path");
try { await unlink(generatedIndex); } catch (error) { if (error.code !== "ENOENT") throw error; }
for (const name of ["main.js", "manifest.json", "styles.css"]) await copyFile(name, path.join(provider, name));
const settings = { warnMissingFields: [], warnTrustFields: true, checkAttestedComputation: true,
  scanOnStartup: false, fixOnSave: false, liveCheckOnSave: false, autoGenerateIndex: false,
  generateIndexOnStartup: false, autoMigrateOnFix: false, reportIndexGaps: false,
  enablePortent: false, excludeFolders: ["Excluded"], batchSize: 1 };
await writeFile(path.join(provider, "data.json"), JSON.stringify(settings));
await writeFile(path.join(vault, ".obsidian/community-plugins.json"), JSON.stringify(["okf-api-e2e-consumer", "okf-enforcer"]));
await writeFile(path.join(consumer, "manifest.json"), JSON.stringify({ id: "okf-api-e2e-consumer", name: "OKF API E2E Consumer", version: "0.0.1", minAppVersion: "1.7.2", author: "OKF Enforcer tests", description: "Disposable local test companion", isDesktopOnly: true }));
await build({ entryPoints: ["tests/e2e/consumer.ts"], bundle: true, platform: "node", format: "cjs", target: "es2018", external: ["obsidian"], outfile: path.join(consumer, "main.js") });
const bundleSha256 = createHash("sha256").update(await readFile("main.js")).digest("hex");
const config = { evidenceDir: evidence, fixtureRoot: root, vault, bundleSha256,
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
await writeFile(path.join(consumer, "data.json"), JSON.stringify(config));
let debugPort;
if (existing) debugPort = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8")).debugPort;
else {
  const server = createServer(); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  debugPort = server.address().port; await new Promise((resolve) => server.close(resolve));
  const id = createHash("sha256").update(vault).digest("hex").slice(0, 16);
  await writeFile(path.join(profile, "obsidian.json"), JSON.stringify({ vaults: { [id]: { path: vault, ts: Date.now(), open: true } } }));
}
const meta = { kind: "okf-enforcer-e2e", ...config, profile, debugPort };
await writeFile(path.join(root, "fixture.json"), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
