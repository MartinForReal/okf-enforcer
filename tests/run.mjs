import { build } from "esbuild";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const output = await mkdtemp(path.join(tmpdir(), "okf-enforcer-tests-"));
try {
  const entries = (await readdir("tests")).filter((f) => f.endsWith(".test.ts"));
  await build({
    entryPoints: entries.map((f) => path.join("tests", f)),
    outdir: output,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    alias: { obsidian: path.resolve("tests/obsidian-stub.ts") },
    logLevel: "warning",
  });
  const result = spawnSync(process.execPath, [
    "--test", ...process.argv.slice(2),
    ...entries.map((f) => path.join(output, f.replace(/\.ts$/, ".cjs"))),
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  // Only remove the unique scratch directory this invocation created.
  if (path.dirname(output) !== path.resolve(tmpdir()) ||
      !path.basename(output).startsWith("okf-enforcer-tests-")) {
    throw new Error("Refusing to remove an unexpected test-output directory");
  }
  await rm(output, { recursive: true, force: true });
}
