# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-07-17

> **Portent support is experimental (beta).** The [Portent](https://portent.md)
> spec is pre-1.0 and may still change; validation is opt-in and every Portent
> rule is a warning. The schema is fully configurable so you can adapt as the
> spec evolves.

### Added
- **Configurable Portent schema.** With **Enable Portent validation** on, the
  Portent property names and vocabularies are now free-form (Settings → OKF
  Enforcer → Portent schema). Remap each concept onto your vault's own
  frontmatter keys — for example rename the lifecycle field from `status` to
  `state` — and set the accepted `type` and status values. This lets you track
  your own conventions or a future revision of the Portent spec without a plugin
  update. Blank fields fall back to the Portent v0 defaults, so existing vaults
  are unaffected. (#4)
- **Per-check Portent toggles.** Type-vocabulary, lifecycle, `belongs_to`, and
  `related_to` validation can each be turned on or off independently under
  Settings → OKF Enforcer → Portent, so you only validate the optional fields
  your vault uses. These and the schema fields are grayed out and disabled until
  **Enable Portent validation** is on.

### Fixed
- **Lifecycle metadata is now format-free.** Per the Portent spec ("Use any
  representation that preserves organized and archived state"), an object may
  omit lifecycle metadata entirely when it is organized by default, so the
  plugin no longer warns "Portent lifecycle metadata missing." Value checks
  still apply when a recognized lifecycle field is present.
- **Empty relationships don't warn.** A blank `belongs_to`/`related_to` (null,
  empty string, or empty list) is treated as unset — like a template
  placeholder — so only non-empty malformed values are flagged.

## [0.2.0] - 2026-07-13

### Added
- **Portent validation** (opt-in). A new **Enable Portent validation** setting
  layers the [Portent](https://portent.md) spec on top of OKF: it checks the
  default type vocabulary (`Project`, `Operation`, `Responsibility`, `Task`,
  `Event`, `Note`, `Topic`, `Person`), lifecycle metadata (`status:
  captured|organized|archived`, or boolean `organized`/`archived`), and
  relationship shape (`belongs_to` single wikilink, `related_to` list of
  wikilinks). All Portent findings are warnings and never affect OKF
  conformance. Disabled by default.

### Removed
- Stray `RELEASE-NOTES-0.1.0.md` from the repository root; release history now
  lives solely in this changelog.

### Fixed
- Clearer validation error when `type` is a list or other non-string value. The
  report now states that OKF §4.1 requires `type` to be a single string
  (previously it was mislabeled as "present but empty"), and the insert-a-value
  quick-fix is no longer offered for a malformed non-string `type` so existing
  data is never silently discarded.

## [0.1.3] - 2026-06-24

### Changed
- `onload` is now synchronous (returns void, matching the Plugin base type);
  settings initialize from defaults immediately and persisted values load in the
  background.

## [0.1.2] - 2026-06-24

### Changed
- Removed the redundant plugin-name heading from the settings tab.
- Detect the vault config folder via `Vault#configDir` instead of assuming `.obsidian`.
- Restricted the release workflow to semantic-version tags only.

## [0.1.1] - 2026-06-24

### Changed
- Addressed Obsidian plugin-review feedback: no longer detach the view on unload
  or startup (preserves user-positioned panels); settings headings use
  `Setting().setHeading()`; resolved floating-promise and type-safety lint
  (typed `parseYaml`/frontmatter access, `instanceof TFolder` narrowing,
  removed unnecessary assertions and a redundant regex escape).
- Progress-bar width now driven by a CSS custom property instead of an inline style.

### Added
- GitHub artifact attestations for release assets (build provenance).

## [0.1.0] - 2026-06-24

Initial release.

### Added
- OKF v0.1 conformance validation. Spec §9 rules (parseable frontmatter, non-empty
  `type`, valid `index.md`/`log.md` structure) are reported as errors; recommended
  fields and SHOULD-guidance are toggleable warnings. Permissive rules (broken links,
  missing optional fields) never fail a bundle.
- Compact, collapsible vault-wide report panel — hidden by default, opens on demand,
  collapsed file groups, one-line summary of conformant/error/warning counts.
- Clickable status-bar indicator showing the active note's state with details in a tooltip.
  Clicking it auto-fixes the active note.
- Non-destructive auto-fix that inserts missing `type`, `title`, and `timestamp`.
- Prompt dialog to supply required fields (`type`, `title`, `description`) when a note
  is missing a meaningful type.
- On-save and on-create hooks, so edited notes and notes added by the Importer plugin are
  brought into conformance automatically.
- `index.md` generation (OKF §6) per folder and vault-wide.
- `log.md` dated changelog entries (OKF §7).
- Batched, non-blocking scan/fix queue with an inline progress bar for large vaults.
- Settings for automation toggles, batch size, warning rules, and excluded folders.

[0.1.3]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.3
[0.1.2]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.2
[0.1.1]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.1
[0.1.0]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.0
