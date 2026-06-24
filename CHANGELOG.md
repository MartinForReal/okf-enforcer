# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.2]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.2
[0.1.1]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.1
[0.1.0]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.0
