import esbuild from "esbuild";
import { readFileSync } from "node:fs";

// Obsidian distributes main.js on its own. Keep the copyright and permission
// notices of its bundled parsers (including their runtime dependencies) in it.
const notices = ["yaml/LICENSE", "markdown-it/LICENSE", "entities/LICENSE", "linkify-it/LICENSE",
  "mdurl/LICENSE", "punycode.js/LICENSE-MIT.txt", "uc.micro/LICENSE.txt"].map(file =>
  file + "\n" + readFileSync(new URL(`node_modules/${file}`, import.meta.url), "utf8").trim()).join("\n\n");

esbuild.build({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2018",
  platform: "browser",
  outfile: "main.js",
  footer: { js: `/* Third-party notices:\n${notices.replace(/\*\//g, "* /")}\n*/` },
  sourcemap: false,
  minify: false,
  logLevel: "info",
}).catch(() => process.exit(1));
