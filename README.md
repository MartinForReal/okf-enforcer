# OKF Enforcer

![Build](https://github.com/MartinForReal/okf-enforcer/actions/workflows/build.yml/badge.svg)
[![Release](https://img.shields.io/github/v/release/MartinForReal/okf-enforcer?display_name=tag&sort=semver)](https://github.com/MartinForReal/okf-enforcer/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

An [Obsidian](https://obsidian.md) plugin that validates and enforces the **Open Knowledge Format (OKF) v0.1** across your vault — keeping every note self-describing, agent-readable, and portable.

OKF is an open, minimal convention for representing knowledge as a directory of Markdown files with YAML frontmatter. Its one hard rule: every non-reserved note carries a parseable frontmatter block with a non-empty `type`. This plugin makes following that effortless. See the [OKF specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

## Features

- **Conformance validation.** Checks every note against OKF v0.1. Spec §9 rules (parseable frontmatter, non-empty `type`, valid `index.md`/`log.md` structure) are reported as **errors**; the spec's recommended fields and SHOULD-guidance are **warnings** you can toggle. The spec's permissive rules are respected — broken links and missing optional fields never fail a bundle.
- **Vault-wide report.** A compact, collapsible side panel lists every non-conformant note, errors first, with a one-line summary of conformant / error / warning counts. Hidden by default; opens only on demand.
- **Status-bar indicator.** A single status-bar item shows the active note's state (`✓` / `⚠` / `✖`) with details in its tooltip. Click it to auto-fix the current note.
- **Auto-fix.** Inserts missing frontmatter (`type`, `title`, `timestamp`) non-destructively — it never overwrites values you've set.
- **Prompt for required fields.** When a note is missing a meaningful `type`, a dialog lets you set `type`, `title`, and `description` directly.
- **On-save & on-create hooks.** New notes, edited notes, and notes added by the **Importer** plugin are brought into conformance automatically.
- **`index.md` generation.** Builds and refreshes OKF §6 directory listings so each folder is self-describing.
- **`log.md` entries.** Adds dated §7 changelog entries.
- **Large-vault friendly.** Scans and fixes run through a batched, non-blocking queue with an inline progress bar — the UI never freezes.

## Usage

Open the command palette and search for **OKF**:

| Command | What it does |
|---|---|
| Validate vault (full report) | Scan everything and open the report panel |
| Validate active note | Check the current note |
| Fix active note | Insert missing OKF frontmatter |
| Fix all auto-fixable issues in vault | Bulk auto-fix |
| Generate/refresh index.md for a folder | Build the §6 listing for the active note's folder |
| Generate/refresh index.md for ALL folders | Build listings vault-wide |
| Add log.md entry (current folder) | Append a dated §7 changelog entry |

Clicking the status-bar item auto-fixes the active note and, if a required field is still missing, prompts you to fill it.

## Settings

Configure under **Settings → OKF Enforcer**:

- **Default type for auto-fix** — value inserted into `type` when fixing notes that lack it.
- **Live check on save / open**, **Scan vault on startup**, **Fix format issues on save**, **Auto-generate index.md** — automation toggles.
- **Batch size** — files processed per async chunk (lower = smoother UI on very large vaults).
- **Warn on missing recommended fields / tags**, **Check reserved files** — which warnings to surface.
- **Excluded folders** — paths skipped during validation (defaults: `.obsidian`, `Templates`, `.trash`).

## Installation

### From the Community Plugins browser
Once accepted: **Settings → Community plugins → Browse**, search for "OKF Enforcer", install, and enable.

### Manual
Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/MartinForReal/okf-enforcer/releases/latest) into your vault at `.obsidian/plugins/okf-enforcer/`, then enable the plugin.

## Development

```bash
npm install
npm run build   # bundles main.ts -> main.js via esbuild
```

Pushing a version tag (e.g. `0.1.0`) triggers the GitHub Actions workflow that builds and attaches `main.js`, `manifest.json`, and `styles.css` to a new release automatically.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE).

## Acknowledgements

Implements the Open Knowledge Format specification by Google Cloud Platform.
