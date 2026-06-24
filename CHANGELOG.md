# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.0
