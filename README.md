# OKF Enforcer

![Build](https://github.com/MartinForReal/okf-enforcer/actions/workflows/build.yml/badge.svg)
[![Release](https://img.shields.io/github/v/release/MartinForReal/okf-enforcer?display_name=tag&sort=semver)](https://github.com/MartinForReal/okf-enforcer/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

An [Obsidian](https://obsidian.md) plugin that validates and enforces the **Open Knowledge Format (OKF) v0.2** across your vault — keeping every note self-describing, agent-readable, and portable.

OKF is an open, minimal convention for representing knowledge as a directory of Markdown files with YAML frontmatter. Its one hard rule: every non-reserved note carries a parseable frontmatter block with a non-empty `type`. v0.2 adds first-class **provenance, trust, lifecycle, and attestation** on top of that, while staying backward-compatible with v0.1 bundles. This plugin makes following the format effortless. See the [OKF specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

## Features

- **Conformance validation.** Checks every note against OKF v0.2. The hard rules (parseable frontmatter, non-empty `type`, valid `index.md`/`log.md` structure — §11/§8/§9) are reported as **errors**; the spec's recommended fields and SHOULD-guidance are **warnings** you can toggle. The spec's permissive rules are respected — broken links and missing optional fields never fail a bundle.
- **Trust & provenance (v0.2).** Opt-in checks for the §5 families: `generated`/`verified` and the actor convention, `status` (`draft|stable|deprecated`), `stale_after` — both that it's an absolute date and whether it has passed, so a note that's due for review says so — and `sources` with its credibility signals (`author`/`usage_count`/`last_modified`). The note's derived trust tier (unverified / machine-confirmed / human-reviewed) is shown in the status-bar tooltip.
- **Attested Computation (v0.2).** Validates `type: Attested Computation` concepts (§10) — a required `runtime`, a present computation (inline `# Computation` fence or a `computation` path), and `parameters`/`executor`/`attester` shape.
- **v0.1 → v0.2 migration.** A command rewrites a legacy `timestamp` into `generated: { by, at }` and lifts a body `# Citations` list into `sources`, then offers to declare `okf_version: "0.2"` in the root index.
- **Vault-wide report.** A compact, collapsible side panel lists every non-conformant note, errors first, with a one-line summary of conformant / error / warning counts. Hidden by default; opens only on demand.
- **Status-bar indicator.** A single status-bar item shows the active note's state (`✓` / `⚠` / `✖`) with details in its tooltip — including the note's derived trust tier, when trust checks are on. Click it to auto-fix the current note.
- **Auto-fix.** Inserts missing frontmatter (`type`, `title`, `generated`) non-destructively — it never overwrites values you've set.
- **Prompt for required fields.** When a note is missing a meaningful `type`, a dialog lets you set `type`, `title`, and `description` directly.
- **On-save & on-create hooks.** New notes, edited notes, and notes added by the **Importer** plugin are brought into conformance automatically.
- **`index.md` generation.** §8 says an index *may* appear in a directory and §11 forbids failing a bundle for a missing one — so rather than flag what's absent, the plugin writes one for every folder, an empty or newly created folder included, and validates against §8 any index that already exists. A folder with nothing to list gets an empty index rather than a listing that describes emptiness; Obsidian's config folder and anything under **Excluded folders** are left alone. Generating over an existing index is **additive**: the entries it doesn't already list are appended, a link that points at the wrong path is corrected, an entry whose note the folder no longer holds is dropped, and your prose, ordering, titles, and edited descriptions stay as written. An index hand-written in Obsidian's own `[[wikilink]]` syntax, or as a numbered list, is read as already listing what it links at, and left in that shape; an entry that links at a heading (`paxos.md#simple`) keeps its fragment, and a heading you added keeps its place even once the entries under it are gone. Listings follow §8 (with `okf_version` in the root index): entries are **grouped by their `type`** — `# Concepts`, `# Metrics`, `# Attested Computations` — so a listing says what a directory holds rather than only that it holds something. Notes carry their frontmatter `description`, as §8 recommends; a note whose `type` is missing is listed under `# Untyped` rather than assumed to be a concept, and attachments are listed under `# Files`. Subdirectory entries always link to that folder's own `index.md`, never a bare `folder/` path that Obsidian would turn into a new note, and can pull their description from a named section (e.g. `# Purpose`) of that index. Because every folder has an index, no entry ever points at a file that isn't there.
- **`log.md` entries.** Adds dated §9 changelog entries.
- **Portent layer (opt-in, beta).** Optionally layer the [Portent](https://portent.md) knowledge-base spec on top of OKF — type vocabulary, lifecycle, and `belongs_to`/`related_to` relationships — surfaced as non-blocking warnings. The schema is fully free-form: rename fields (e.g. `status` → `state`), redefine the accepted vocabularies, and toggle each check independently, so you can match your own conventions or track the evolving pre-1.0 spec.
- **Large-vault friendly.** Scans and fixes run through a batched, non-blocking queue with an inline progress bar — the UI never freezes.

## Usage

Open the command palette and search for **OKF**:

| Command | What it does |
|---|---|
| Validate vault (full report) | Scan everything and open the report panel |
| Validate active note | Check the current note |
| Fix active note | Insert missing OKF frontmatter |
| Fix all auto-fixable issues in vault | Bulk auto-fix |
| Migrate note to latest OKF | Rewrite `timestamp`→`generated` and `# Citations`→`sources` |
| Generate/refresh index.md for a folder | Build the §8 listing for the active note's folder |
| Generate/refresh index.md for ALL folders | Build listings vault-wide |
| Add log.md entry (current folder) | Append a dated §9 changelog entry |

Clicking the status-bar item auto-fixes the active note and, if a required field is still missing, prompts you to fill it.

## Settings

Configure under **Settings → OKF Enforcer**:

- **Default type for auto-fix** — value inserted into `type` when fixing notes that lack it.
- **Default actor for `generated.by`** — the actor recorded when auto-fix adds a `generated` block (e.g. `okf-enforcer/0.5` or `human:<id>`). It goes into an inline YAML mapping, so it cannot contain a comma.
- **Live check on save / open** — validate the active note as you edit and when you open it.
- **Automation** — **Scan vault on startup**, **Fix format issues on save**, and **Auto-migrate to latest OKF on fix**. The last is on by default and lets ordinary auto-fix apply the v0.1 → v0.2 migrations; turn it off to keep them behind the explicit command, since a migration rewrites what you wrote.
- **Auto-generate index.md** — keep every folder's `index.md` current as notes are added, renamed, and deleted, along with every listing above it, since a parent describes its subdirectories by what they hold. Every folder gets one — a new or empty folder included, generated as soon as the folder appears and left empty while there is nothing to list.
- **Generate index.md on startup** — off by default, since the hooks above already keep listings current while the plugin is running. Turn it on to bring every folder's `index.md` up to date once when the plugin loads, for what changed while Obsidian was closed — a vault synced from another machine, or edited outside it. It runs before the startup scan, so the scan judges the listings as they now stand rather than the ones it is about to replace, and it runs quietly: progress shows in the status bar, with no notice at the end.
- **Rebuild existing index.md** — off by default, so generating over an existing index adds what's missing, fixes links that point at the wrong path, and removes entries for notes that are gone, changing nothing else. Turn it on to rewrite the listing from the folder's contents instead, which also refreshes every description, re-sorts the entries, and re-groups them under their current `type` — at the cost of any prose in the file, which a rebuild discards apart from the section named below.
- **Subdirectory description section** — heading in a subfolder's `index.md` whose first paragraph becomes that folder's description in the parent listing (e.g. `Purpose`). Blank by default, which leaves subdirectory entries undescribed. Additive generation never touches the file's prose, and this is the one section a rebuild carries over, so the description you write survives a refresh either way.
- **Rules** — **Warn on missing recommended fields**, **Warn on missing tags**, **Validate trust & lifecycle fields**, and **Validate Attested Computation concepts** select which optional checks to surface. **Validate trust & lifecycle fields** also decides whether the note's trust tier appears in the status-bar tooltip, since the tier is derived from the same §5 `verified` events the checks read. `index.md` / `log.md` structure is always checked: §11 makes it one of the three requirements for a conformant bundle, so it isn't a toggle.
- **Excluded folders** — paths skipped during validation and index generation (default: `Templates`). Use this for attachment folders you'd rather not have an `index.md` in. The Obsidian config folder (e.g. `.obsidian`) is always skipped automatically.
- **Batch size** — files processed per async chunk (lower = smoother UI on very large vaults).
- **Enable Portent validation** _(experimental / beta — the Portent spec is pre-1.0 and may change)_ — layer the [Portent](https://portent.md) spec on top of OKF: default type vocabulary (`Project`, `Operation`, `Responsibility`, `Task`, `Event`, `Note`, `Topic`, `Person`), lifecycle metadata (optional and format-free — a single `status`/`state` value, boolean `organized`/`archived`, or omitted entirely when organized by default), and relationship shape (`belongs_to` single wikilink, `related_to` list of wikilinks). All Portent findings are warnings — they never break OKF conformance.
- **Portent schema** — with Portent validation enabled, every property name and vocabulary is free-form. Remap each concept onto your vault's own frontmatter keys (e.g. rename the lifecycle field `status` → `state`) and set the accepted `type` and status values, so you can follow your own conventions or a future spec revision without waiting for a plugin update. Leave any field blank to restore its default. Each optional check — type vocabulary, lifecycle, `belongs_to`, and `related_to` — can be toggled on or off individually.

## Installation

Requires **Obsidian 1.7.2 or newer**.

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
