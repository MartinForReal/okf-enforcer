# OKF Enforcer

![Build](https://github.com/MartinForReal/okf-enforcer/actions/workflows/build.yml/badge.svg)
[![Release](https://img.shields.io/github/v/release/MartinForReal/okf-enforcer?display_name=tag&sort=semver)](https://github.com/MartinForReal/okf-enforcer/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

An [Obsidian](https://obsidian.md) plugin for validating **Open Knowledge Format (OKF) v0.3** bundles, with compatibility for v0.1 and v0.2. Enforcer treats the vault as one bundle; to validate a bundle stored inside a larger repository, open its directory as the vault root.

The target is the [non-draft v0.3 SPEC at commit `527e81a`](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md). Upstream documents the changes in §13, not in a tagged release. See the [compatibility reference](docs/okf-v03.md) for the normative differences and upstream examples.

## Features

- **Structural validation.** In v0.3, an ordinary `.md` file without a nonempty string `type` is not a concept: a README is reported as a warning, not rejected or converted. An existing frontmatter block must be a YAML 1.2 core mapping between exact `---` lines; malformed blocks and duplicate keys are errors. `index.md` and `log.md` are reserved; dot-paths are outside the bundle. Missing indexes, optional families, unknown types or extension keys never fail a v0.3 bundle.
- **Trust, lifecycle and provenance.** Opt-in §5 advice checks `generated`, `verified`, source credibility signals, review deadlines and `superseded_by` on deprecated concepts. The status tooltip counts only complete verification events at or after the last meaningful change (all valid events if no generation is recorded). `team:` and custom actor schemes do not grant human review. Date-only timestamps mean midnight UTC; date-times require an offset. A malformed deadline is not fresh. Scalar tags are one tag, not split at commas.
- **Links and computations.** In the vault, Markdown links and path fields resolve beside the referring file or from the root with `/`. Targets are case-sensitive; missing targets are advisory. Only legacy or undeclared bundles may retry missing relative **path fields** at the root. Enforcer checks names in the vault inventory, not external files or URLs. For an Attested Computation it checks the runtime, parameter and executor/attester shapes, and a computation file or the first fenced block in the `Computation` section. A file takes precedence. Enforcer does **not** execute code, attest runs, or certify values.
- **Legacy vaults.** A root declaration of `"0.1"` or `"0.2"` retains the legacy required-concept checks. Malformed YAML is never repaired by guessing. An unknown declaration gets best-effort diagnostics and an **unknown** verdict. Without a declaration Enforcer uses v0.3 discovery and allows the legacy path and field fallbacks. A historical `type: Log` header in an undeclared vault is reported as version-ambiguous rather than certified. Optional root `title`, `description`, `license` and extension keys are kept when regenerating an index.
- **Vault-wide report.** A compact, collapsible side panel lists findings **grouped by folder**, errors first, with separate core OKF and extension results. Read failures, unprocessed notes and reduced core checks are shown as incomplete/unknown rather than a clean vault. Folder findings have their own count. **The note you have open gets its own section at the top, listed open**, even before a vault scan. Hidden by default; opens only on demand.
- **Validation extensions (API v1).** Companion plugins register extra note-level checks, such as an owner requirement or type vocabulary. Their source-labelled findings appear in existing active-note, save, vault and post-fix reports without changing core OKF conformance or gaining auto-fix authority. See the [plugin developer guide](docs/plugin-api.md) and [owner-policy example](examples/owner-validator/main.ts). This branch adds the API; it is not a release announcement.
- **Status-bar indicator.** A single status-bar item shows the active note's state (`✓` / `⚠` / `✖`) with details in its tooltip — including the note's derived trust tier, when trust checks are on. Click it to auto-fix the current note.
- **Fixes and migrations.** Checks never write. The ordinary fixer can add a missing title or generation record to an existing typed concept; it does not overwrite authored values, turn untyped Markdown into concepts, or invent a generation date over verification history. A separate, explicit legacy-field command can move a top-level `timestamp` to `generated.at` and a simple `# Citations` list to `sources`. Ambiguous prose and unsupported YAML edit shapes are left alone. No fix or migration upgrades a bundle declaration.
- **`index.md` generation.** Writes sectioned listings with concept titles and descriptions, untyped Markdown under `# Untyped`, attachments under `# Files`, and subdirectories linked to their own `index.md`. Additive mode keeps hand-written sections, list numbering, Obsidian wikilinks and equivalent Markdown links. Rebuild mode regenerates the listing but retains existing root frontmatter verbatim. A newly created root for an empty bundle declares `"0.3"`; an existing index or populated unversioned bundle is not stamped. Change the declaration yourself only after checking your paths and legacy log format.
- **Index gaps, reported rather than written (opt-in).** For a vault whose `index.md` files are kept by hand — its own headings, its own order, its own groupings — generation writes a shape the vault didn't choose. Set **Incomplete index.md** to *Report in the vault scan* instead: a vault scan then warns where a folder has no `index.md`, and where an existing one doesn't list a note anywhere in the file, and writes nothing. A note counts as listed wherever it appears, so a listing you maintain yourself never reads as incomplete just for not looking generated. Opening a folder's `index.md` reports the same gaps in the pane's active-note section and in the status bar, so the note in front of you says what a scan would.
- **`log.md` entries.** Adds dated §9 changelog entries.
- **Portent layer (opt-in, beta).** Optionally layer the [Portent](https://portent.md) knowledge-base spec on top of OKF — type vocabulary, lifecycle, and `belongs_to`/`related_to` relationships — surfaced as non-blocking warnings. The schema is fully free-form: rename fields (e.g. `status` → `state`), redefine the accepted vocabularies, and choose which checks run, so you can match your own conventions or track the evolving pre-1.0 spec.
- **Large-vault friendly.** Scans and fixes run through a batched, non-blocking queue with an inline progress bar — the UI never freezes.

## Usage

Open the command palette and search for **OKF**:

| Command | What it does |
|---|---|
| Validate vault (full report) | Scan everything and open the report panel |
| Validate active note | Check the current note |
| Fix active note | Add safe missing fields to an existing concept |
| Fix all auto-fixable issues in vault | Apply the same non-migrating fixes in bulk |
| Migrate legacy timestamp and Citations in active note | Explicitly migrate supported legacy fields on this note only |
| Generate/refresh index.md for a folder | Build the §8 listing for the active note's folder |
| Generate/refresh index.md for ALL folders | Build listings vault-wide |
| Add log.md entry (current folder) | Append a dated §9 changelog entry |

Click the status bar to fix the active note and open its report. In a declared legacy bundle, you can supply a missing `type` explicitly. To make an ordinary v0.3 Markdown file a concept, give it a string `type` yourself.

## Settings

Configure under **Settings → OKF Enforcer**:

- **Default type for legacy prompt** — the suggested type if you choose to turn a legacy note into a concept.
- **Default actor for `generated.by`** — an actor such as `okf-enforcer/0.6` or `human:alex`. New `generated` mappings write `by` and `at` on separate indented lines. Actor punctuation and timestamp offsets are preserved; existing inline mappings stay as written. No version declaration or existing generation record is changed.
- **On save** — **Do nothing**, **Check the note**, or **Check and fix** missing optional fields. Opening a note and running a scan are always read-only. **Scan vault on startup** runs that same check. The old auto-migration preference no longer rewrites notes on save.
- **Incomplete index.md** — what to do about a folder whose §8 listing is missing or out of date:
  - **Ignore** — nothing happens on its own; the *Generate/refresh index.md* commands still write when you run them.
  - **Report in the vault scan** — a scan warns where a folder has no `index.md`, and where the one it has doesn't list a note anywhere in the file. Nothing is written. Opening a folder's `index.md` runs the same check for that one folder, so the active-note section and the status bar agree with the row the scan gives that file. For a vault that keeps its listings by hand: an entry counts under whatever heading and in whatever order its author put it, so only a genuinely absent one is reported. Both findings are warnings — §8 makes an index optional and §11 forbids failing a bundle for a missing one.
  - **Write it as notes change** (the default) — keep every folder's `index.md` current as notes are added, renamed, and deleted, along with every listing above it, since a parent describes its subdirectories by what they hold. Every folder gets one — a new or empty folder included, generated as soon as the folder appears and left empty while there is nothing to list.
  - **Write it as notes change, and at startup** — as above, plus one pass over the whole vault when the plugin loads, for what changed while Obsidian was closed: a vault synced from another machine, or edited outside it. It runs before the startup scan, so the scan judges the listings as they now stand rather than the ones it is about to replace, and it runs quietly — progress shows in the status bar, with no notice at the end.
- **Rebuild existing index.md** — off by default, so generating over an existing index adds what's missing, fixes links that point at the wrong path, and removes entries for notes that are gone, changing nothing else. Turn it on to rewrite the listing from the folder's contents instead, which also refreshes every description, re-sorts the entries, and re-groups them under their current `type` — at the cost of any prose in the file, which a rebuild discards apart from the section named below. It governs the *Generate/refresh index.md* commands too, so it still matters with **Incomplete index.md** set to Ignore.
- **Subdirectory description section** — heading in a subfolder's `index.md` whose first paragraph becomes that folder's description in the parent listing (e.g. `Purpose`). Blank by default, which leaves subdirectory entries undescribed. Additive generation never touches the file's prose, and this is the one section a rebuild carries over, so the description you write survives a refresh either way.
- **Rules** — **Warn about missing fields** selects optional authoring advice (`title`, `description`, `generated`, `tags`); leave it blank for none. **Validate trust & lifecycle fields** also shows the derived trust tier in the active tooltip. **Validate Attested Computation concepts** enables contract advice. Neither toggle disables §11 structural checks.
- **Excluded folders** — comma-separated, case-sensitive folder names or vault-relative paths (default: `Templates`). With `assets, Templates`, vault operations skip every folder named `assets` or `Templates` and everything below it, including `assets/`, `docs/assets/`, and `docs/onboarding-kit/assets/`. Use `docs/assets` instead to skip only that subtree, not `other/docs/assets/`. `assets-old/`, `myassets/`, and files named `assets` or `assets.md` outside an excluded folder still count. The vault's Obsidian config folder is always skipped.
  - Index generation never writes inside an excluded folder or deletes an index already there. Refreshing a parent removes a generated directory entry for an excluded child; in the default additive mode, authored prose, wikilinks, and numbered references stay as written.
- **Batch size** — files processed per async chunk (lower = smoother UI on very large vaults).
- **Enable Portent validation** _(experimental / beta — the Portent spec is pre-1.0 and may change)_ — layer the [Portent](https://portent.md) spec on top of OKF: default type vocabulary (`Project`, `Operation`, `Responsibility`, `Task`, `Event`, `Note`, `Topic`, `Person`), lifecycle metadata (optional and format-free — a single `status`/`state` value, boolean `organized`/`archived`, or omitted entirely when organized by default), and relationship shape (`belongs_to` single wikilink, `related_to` list of wikilinks). All Portent findings are warnings — they never break OKF conformance.
- **Checks** — comma-separated: which of Portent's optional checks to run — `type`, `lifecycle`, `belongs_to`, `related_to`. A note that doesn't carry the field a check looks at is never flagged. Leave blank to run none.
- **Portent schema** — **Type vocabulary** and **Lifecycle status values** set the accepted values, and **Field name overrides** takes comma-separated `concept=key` pairs remapping the frontmatter keys Portent reads onto the ones your vault uses (e.g. `status=state, belongs_to=parent`). Anything you leave out keeps its own name, so a vault that follows the spec leaves the box empty. Between them you can follow your own conventions, or a future spec revision, without waiting for a plugin update.

## Installation

Requires **Obsidian 1.7.2 or newer**.

### From the Community Plugins browser
Once accepted: **Settings → Community plugins → Browse**, search for "OKF Enforcer", install, and enable.

### Manual
Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/MartinForReal/okf-enforcer/releases/latest) into your vault at `.obsidian/plugins/okf-enforcer/`, then enable the plugin.

## Development

```bash
npm ci
npm test        # Node registry/pipeline/lifecycle/report tests
npx tsc --noEmit
npm run build   # bundles main.ts -> main.js via esbuild
```

Pushing a version tag (e.g. `0.1.0`) triggers the GitHub Actions workflow that builds and attaches `main.js`, `manifest.json`, and `styles.css` to a new release automatically.

### Plugin developers

Use the [validation-extension API guide](docs/plugin-api.md) to contribute checks
from a separate Obsidian plugin. It documents registration, load order, cleanup,
async cancellation, failure isolation and the private-discovery caveat. The
copyable contract does not require a published SDK or importing the host bundle.
For actual-app testing, use the [disposable desktop fixture](tests/e2e/README.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE).

## Acknowledgements

Implements the Open Knowledge Format specification from the [canonical upstream repository](https://github.com/open-knowledge-format/open-knowledge-format).
