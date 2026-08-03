# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Index gaps can be reported instead of written** ([#15](https://github.com/MartinForReal/okf-enforcer/issues/15)).
  A new **Report index gaps** setting, off by default, makes a vault scan warn
  where a folder has no `index.md` and where an existing one doesn't list a note
  anywhere in the file — and write nothing. A note counts as listed under
  whatever heading, in whatever order, and in whatever grouping its author
  chose, so a listing kept by hand doesn't read as incomplete merely for not
  looking generated. Both findings are warnings: §8 makes an index optional and
  §11 forbids failing a bundle for a missing one.

  This comes from the closing comment on
  [#8](https://github.com/MartinForReal/okf-enforcer/issues/8) — a vault that
  writes its own indexes for readability can't use generation, because
  generation writes a shape the vault didn't choose, but still wants to be told
  when a listing has fallen behind.

### Changed
- The report pane names each finding by its full vault-relative path instead of
  the file name alone. Two notes named the same in different folders were one
  row repeated, and an index finding — which names `index.md` — said nothing at
  all about which folder it meant. The folder part is what ellipsizes when the
  pane is narrow, so the file name stays readable at any width.
- The report pane offers **Open note →** only when the path resolves to a file.
  It was always shown and silently did nothing otherwise, which a gap report —
  which names the `index.md` a folder hasn't got — would hit every time.

### Internal
- The listing a folder's contents call for, and the write of that listing, are
  now separate steps, so the gap report and the generator read a folder the same
  way. "Is this note already listed?" likewise has one implementation shared
  between reporting a gap and closing it.

## [0.5.0] - 2026-07-31

Three §5 trust signals that didn't do what they promised. The derived trust tier
and `sources[].author` were described as shipped in the 0.3.0 notes and the
README but were never surfaced or checked; `stale_after` was validated for its
form only, so a review deadline could pass unnoticed.

### Added
- **`stale_after` is enforced, not just parsed** ([#10](https://github.com/MartinForReal/okf-enforcer/issues/10)).
  A note whose `stale_after` has passed is flagged as due for review; previously
  only the date's *form* was checked, so a deadline from last year passed
  silently. Advisory only — §11 keeps it out of conformance.
- **The derived trust tier is shown** ([#11](https://github.com/MartinForReal/okf-enforcer/issues/11)).
  The active note's tier (unverified / machine-confirmed / human-reviewed, §5.3)
  appears in the status-bar tooltip. It was computed but reached no surface. The
  report pane lists only files that *have* issues, so a conformant note would
  never show a tier there.
- **`sources[].author` is validated** ([#12](https://github.com/MartinForReal/okf-enforcer/issues/12)).
  Warns when an entry's `author` is present but not a non-empty string,
  alongside the existing `resource` / `usage_count` / `last_modified` checks.

All three sit behind **Validate trust & lifecycle fields**, off by default, so no
vault starts reporting anything new unless it had already opted in.

### Changed
- The default **Actor for `generated.by`** is now `okf-enforcer/0.5`, tracking
  the minor line as it did at 0.3.0 and 0.4.0. This is a default: if you have
  ever saved settings, your existing actor is kept as written.

### Fixed
- README and the 0.3.0 changelog entry claimed derived trust tiers and
  `sources[].author` validation that had not shipped. Corrected.

## [0.4.1] - 2026-07-31

### Changed
- Re-release of 0.4.0 under a fresh tag. The `0.4.0` release was published
  before CI could attach `main.js`, `manifest.json`, and `styles.css`, so it
  briefly carried no assets and was reported as an incomplete release. The
  assets were restored afterward, but downstream caches may have pinned the
  original, so this tag supersedes it. No code changes since 0.4.0.

## [0.4.0] - 2026-07-30

Index generation follows [#8](https://github.com/MartinForReal/okf-enforcer/issues/8):
listings describe what they link to, they say what a directory holds rather than
only that it holds something, and generation no longer destroys what you wrote —
it adds to an existing index rather than replacing it. §8 makes `index.md`
optional and §11 forbids failing a bundle for a missing one, so every folder gets
an index generated rather than flagged for lacking one, and one that already
exists is validated against §8.

### Added
- **Entry descriptions** — a note's entry in a generated `index.md` now carries
  its frontmatter `description`, which §8 recommends ("Entries SHOULD include the
  description from the linked concept's frontmatter"). (#8)
- **Additive index generation** — generating over an existing `index.md` now
  appends only the entries it doesn't already list, leaving prose, ordering,
  section structure, and hand-edited descriptions exactly as written. A folder is
  matched whether its entry was written as `sub/` or `sub/index.md`, so nothing
  is listed twice, and a `_No concepts yet._` placeholder left by a hand-written
  index gives way to real entries. The new **Rebuild existing index.md** setting
  (off by default) restores rewrite-from-scratch, which also prunes entries for
  notes that are gone and re-groups them under their current `type`. (#8)
- **Link repair** — an entry that points at the right thing by the wrong path
  has its destination corrected in place: `sub/`, `sub`, `<sub/>`, and a
  mis-cased or differently escaped path all become `sub/index.md`. Only the
  destination changes; the entry's title, description, and position are the
  author's. Equivalent spellings are left alone (`./a.md` resolves the same as
  `a.md`). Bullets inside a fenced code block are sample text, so an index that
  documents the format is neither rewritten nor appended to inside the fence.
  (#8)
- **Stale entries are dropped.** An entry naming a file the folder no longer
  holds is removed, and a section heading left empty by that goes with it —
  unless the author wrote prose under it. Only entries this plugin would list
  are candidates (`a.md`, `pic.png`, `sub/`, `sub/index.md`); a cross-link deeper
  into the tree, a path out of the folder, an absolute bundle path, a URL, and a
  link to something that still exists but the plugin doesn't list (`log.md`) are
  all left as written, however broken §6.1 allows them to be. (#8)
- **Subdirectory descriptions** — new **Subdirectory description section**
  setting names a heading in a subfolder's `index.md` (e.g. `Purpose`) whose
  first paragraph becomes that folder's description in the parent listing. Blank
  by default. Non-root indexes carry no frontmatter (§8), so a body section is
  the only place a folder can describe itself. Additive generation never touches
  the section, and a rebuild carries it over, so it survives a refresh. (#8)
- **Generate index.md on startup** — new setting, off by default, that brings
  every folder's `index.md` up to date once when the plugin loads. The existing
  create/rename/delete hooks only see what happens while the plugin is running,
  so this is for what changed while it wasn't: a vault synced from another
  machine, or edited outside Obsidian. It runs before the startup scan, so the
  scan judges the listings as they now stand rather than the ones it is about to
  replace, and it runs quietly — progress in the status bar, no notice at the
  end. Off by default because it writes across the whole vault, which is not
  something to do to someone's notes unasked. (#8)

### Changed
- **Entries are grouped by their `type`.** A generated listing files each note
  under a heading derived from its `type` — `# Concepts`, `# Metrics`,
  `# Attested Computations` — instead of putting everything under `# Concepts`.
  §8 asks entries to be grouped under section headings for progressive
  disclosure, and the type is what a reader is disclosing. Only the last word is
  pluralised, so a multi-word type reads naturally; a lower-case type is
  capitalised for the heading (`wiki` → `Wikis`) while capitals the author chose
  are left alone, so an acronym stays one (`API` → `APIs`). Sections are ordered
  subdirectories first, then types alphabetically, so a folder renders the same
  way every time. Types that differ only in case share one section. (#8)
- **A note with no `type` is listed under `# Untyped`** rather than assumed to be
  a concept. §11 already reports the missing `type` as an error; the listing just
  stops papering over it. (#8)
- **Attachments are listed under `# Files`.** A file that isn't a note is still
  part of what the directory holds, and §8 asks the index to enumerate the
  directory's contents. Without this, a folder holding nothing but images
  rendered an index claiming the folder was empty. Reserved files (`index.md`,
  `log.md`) are still not listed. (#8)
- **Every folder gets an `index.md`, including an empty and a newly created
  one.** §8 leaves the file optional, but a folder without one is a dead end in
  its parent's listing, so the plugin writes one everywhere rather than only
  where there is something to enumerate. A folder with nothing to list gets an
  **empty** index — §8 asks an index to enumerate what a directory holds, and
  there is nothing to enumerate — so the file exists for the parent entry to
  point at without claiming anything. Creating a folder in the file explorer
  generates its index straight away; nothing else announces a folder that holds
  no notes yet. Obsidian's config folder and anything under **Excluded folders**
  are left alone. The §8 check accepts both an empty index and one that says a
  directory is empty in words, so an index written by hand or by an earlier
  version of this plugin isn't reported for it. (#8)
- Subdirectory entries in a generated `index.md` now link to that folder's own
  `index.md` rather than a bare `folder/` path — clicking the bare path in
  Obsidian's default settings created a new, empty note, and an index that
  already has one gets it corrected. Every subfolder is listed and gets an index
  of its own, so the link always points at a file that exists. (#8)
- "Generate/refresh index.md for ALL folders" now processes deepest folders
  first, so each parent listing sees its children's freshly written indexes.
- Descriptions in generated listings are collapsed to a single line and clipped
  at 200 characters, so a multi-line `description` can't break a bullet.
- A subdirectory entry with no description no longer emits a trailing `-`.
- "Generate/refresh index.md for ALL folders" reports how many indexes actually
  changed (`updated index.md in X of Y folder(s)`) rather than how many folders
  it visited.
- The default `generated.by` actor is now `okf-enforcer/0.4`. Existing vaults keep
  the actor already saved in their settings.
- **The settings tab reads shorter and groups by subject.** Every option's
  description was rewritten to a sentence or two — the four that had grown into
  paragraphs (**Auto-generate index.md**, **Generate index.md on startup**,
  **Rebuild existing index.md**, **Enable Portent validation**) most of all — and
  **Warn on missing tags**, which had no description at all, gained one. The
  index options moved out of **Automation** into their own **index.md** group,
  **Excluded folders** and **Batch size** into **Scope & performance**: neither
  scoping nor throughput is automation, and **Excluded folders** governs index
  generation as much as validation. No setting was renamed, removed, or given a
  new default, so nothing needs migrating.
- **Rebuild existing index.md now says what it costs.** Its description read as a
  list of what a rebuild refreshes and never mentioned that a rebuild discards
  the file's prose, keeping only the section named by **Subdirectory description
  section**. Both descriptions now say so.
- **Default type for auto-fix is trimmed**, like the actor field already was. A
  value of only spaces used to reach the frontmatter as `type:` with nothing
  after it, which the plugin then reported as an error against the note — it now
  falls back to `Concept`.

### Removed
- **Check reserved files** setting. `index.md` / `log.md` structure is now always
  validated: §11 rule 3 ("every reserved filename follows the structure in §8 and
  §9 respectively when present") is one of the three requirements for a conformant
  bundle, so it isn't something to switch off. The check still only judges a file
  that exists — a missing `index.md` is generated, never reported.

### Fixed
- **Deleting or moving a note left its `index.md` stale.** Auto-generation
  listened for `modify` and `create` but not `delete` or `rename`, so a folder's
  listing was only refreshed when something was added or edited — a deleted note
  kept its entry until the index was regenerated by hand. Both events now mark
  the folder, and a rename marks the folder the note left as well as the one it
  joined. (#8)
- **A change deep in a tree left every listing above it stale.** Only the folder
  holding the changed note was refreshed, but a listing describes its
  subdirectories too, and both halves of a subdirectory entry look past the
  folder itself — whether one is worth listing depends on what it holds at any
  depth, and its description is read out of its own `index.md`. So a subfolder
  linked as `sub/` kept that bare link until something in the parent changed,
  and a newly filled subfolder went unlisted. Every folder above a change is now
  refreshed, deepest first, so a parent sees its children's updated indexes.
  (#8)
- **A subdirectory's own subdirectories went unlisted.** A listing links at
  `sub/index.md`, but only the folder a change landed in was ever queued, so a
  subfolder nothing had touched never got the index its parent pointed at — the
  entry dangled, and a folder that already had an index was skipped entirely, so
  nothing below it was reached either. Generating a folder now writes the
  indexes of the subfolders it links at, following any that are missing however
  deep they sit. The descent stops once every folder below has one, so a settled
  tree costs an in-memory walk and no writes. (#8)
- **A folder holding no notes never got an `index.md`.** "Generate/refresh
  index.md for ALL folders" found its folders by looking at where the notes
  were, so a folder holding only subfolders — or nothing at all — was invisible
  to it, while its parent listed it and linked at an index nothing would write.
  The command now walks the folder tree itself. (#8)
- **Emptying a listing left a stray blank line.** Dropping the last entry from an
  existing index produced a file holding a single newline rather than an empty
  one, so a folder whose last note was deleted didn't match the empty index a
  rebuild writes for the same folder. (#8)
- **A `]` in a title grew the index on every pass.** An entry was recognised by a
  pattern that stopped at the first `]`, so `* [Rev [2] notes](rev.md)` read as
  naming something the folder didn't hold — the plugin couldn't find the entry it
  had just written, and appended a fresh copy every time the folder was touched.
  Titles and destinations are now read with their brackets and parentheses
  balanced, so an entry the plugin writes is one it can find again. This happened
  on default settings. (#8)
- **Parentheses in a file name truncated the entry.** `report (1).pdf` was
  written as `report%20(1).pdf` — `encodeURI` leaves parentheses alone — and read
  back as a link to `report%20(1`, so the entry was rewritten with everything
  after it, hand-written description included, thrown away. Destinations now
  escape their parentheses, and reading one balances them. (#8)
- **An entry linking at a heading was deleted.** `* [Simple Paxos](paxos.md#simple)`
  names `paxos.md`, but the whole string was looked up as a file name, found
  nothing, and the entry was dropped as stale — taking the author's description
  with it. §6.1 permits broken links; only an entry naming a file the folder no
  longer holds is a candidate. A `#fragment` or `?query` is now split off before
  the lookup, and kept when a destination is corrected. (#8)
- **An index written in `[[wikilinks]]` was listed twice.** Only `[Title](link)`
  entries counted as already listed, so the first generation over an index
  written in Obsidian's own link syntax appended a second copy of every entry.
  Wikilink entries are now recognised — `[[note]]`, `[[note|Alias]]`,
  `[[note#heading]]` — and left exactly as written: §8 asks for markdown links,
  but rewriting the syntax an author chose is the same destructive move in
  another coat. A wikilink names a file rather than spelling out a destination,
  so none of a destination's punctuation applies inside it: `[[notes (draft)]]`
  is that note, not `notes` with a title after it. (#8)
- **A heading the plugin doesn't generate was removed with its entries.** Dropping
  a stale entry took the heading above it whenever nothing was left underneath,
  `# Reading list` and any other section an author added included. Only a heading
  this plugin would itself write is removed now — and a type heading that has
  emptied out (`# Concepts`) is left standing rather than deleted, since with no
  notes left in the folder there is nothing to tell it apart from a heading
  someone wrote. (#8)
- **Pruning a root index glued its frontmatter to the listing.** A root
  `index.md` whose first entry was dropped could come back as `---# Concepts`,
  closing fence and heading on one line — a state no later pass repaired and the
  §8 check didn't report. (#8)
- **A title could take over the link it sat in.** A note titled
  `See](elsewhere.md) this` rendered an entry pointing at `elsewhere.md`;
  brackets in a title are now escaped. Titles are also collapsed to a single line
  and clipped at 200 characters, which descriptions already were. (#8)
- **`#` and `?` in a file name produced a link the plugin couldn't follow.**
  `encodeURI` leaves the reserved delimiters alone, so `Meeting #3.md` was
  written as `Meeting%20#3.md` — which Obsidian reads as a link to a note called
  `Meeting ` at a heading. Both are now escaped, alongside the parentheses, and a
  destination is compared with them folded back so the escaped form and one
  typed by hand still count as the same entry — a name that literally holds the
  characters `%23` included, which is a different file and stays one. A `#` in a
  *folder* name no longer truncates a path either: an entry naming
  `research#2024/papers/paxos.md` used to look like a note this folder had held
  and lost, and a link reaching past the folder is now left alone rather than
  read as a heading in a sibling. (#8)
- **An entry written as a numbered list was listed a second time.** Only `*`,
  `-` and `+` bullets were recognised, so an index written as `1. [Q](q.md)` had
  every one of its entries appended again underneath. A numbered entry now counts
  as a listing and, like a wikilink, is never rewritten or pruned — the shape is
  the author's. A line that only looks like one doesn't count: CommonMark starts
  an ordered list mid-paragraph only at `1`, so a `2.` written under prose is
  read as the sentence it is. An embed (`![[banner.png]]`) no longer counts
  either: it displays a file rather than linking to one, so the `# Files` entry
  for it is still added. (#8)
- **An unterminated ``` fence grew the index on every pass.** A fence that never
  closes runs to the end of the file, so entries appended below it were read back
  as sample text and appended again — a stray fence in prose was enough. New
  entries are now placed above an unterminated fence, and only an unterminated
  one: a file whose last line closes a block still takes new entries after it.
  (#8)
- **The §8 check couldn't read the entries this plugin writes.** An index whose
  titles hold brackets, or that is written entirely in wikilinks, was reported as
  not listing the directory's contents. The check and the merger now read an
  entry the same way. (#8)
- The community-store entry description said "OKF v0.1"; the plugin has targeted
  v0.2 since 0.3.0.

## [0.3.0] - 2026-07-27

Targets **OKF v0.2** (was v0.1). A v0.2 consumer still accepts v0.1 bundles via
the fallbacks below, so existing vaults keep validating.

### Added
- **Provenance / trust / lifecycle validation** (§5), opt-in via **Validate trust
  & lifecycle fields**. When present, checks `generated`/`verified` shape and the
  actor convention (`<producer>/<version>`, `human:<id>`, `process:<id>`), and
  validates `status` (`draft|stable|deprecated`), `stale_after` (absolute date),
  and `sources` (`resource`, `usage_count`, `last_modified`).

  > **Correction.** This entry originally read "derives trust tiers (unverified /
  > machine-confirmed / human-reviewed)" and listed `author` among the validated
  > `sources` signals. Neither was true of 0.3.0: the tier was computed but never
  > shown anywhere, and `author` was not checked. Both are fixed in 0.5.0
  > ([#11](https://github.com/MartinForReal/okf-enforcer/issues/11),
  > [#12](https://github.com/MartinForReal/okf-enforcer/issues/12)).
- **Attested Computation concepts** (§10). A `type: Attested Computation` note is
  checked for a required `runtime`, a present computation (inline `# Computation`
  fence or a `computation` path), and `parameters`/`executor`/`attester` shape.
  Toggle under **Validate Attested Computation concepts**.
- **v0.1 → v0.2 migration** — the "Migrate note to latest OKF" command (and, by
  default, ordinary auto-fix / fix-on-save) rewrites a legacy `timestamp` into
  `generated: { by, at }` and lifts a body `# Citations` list into `sources`.
  Auto-migration is toggled by **Auto-migrate to latest OKF on fix** (on by
  default); turn it off to keep migrations manual via the command.
- **Configurable `generated.by` actor** — auto-fix now writes a `generated` block;
  the actor it records is set by **Default actor for `generated.by`**.

### Changed
- **`timestamp` → `generated: { by, at }`** (§13.1). Auto-fix writes `generated`
  for new notes; a legacy `timestamp` is accepted as a fallback and surfaces a
  migrate hint instead of a "missing" warning.
- **Body `# Citations` → `sources`** (§13.1). A legacy `# Citations` list is
  recognized and offered for migration; provenance now lives in frontmatter.
- Root `index.md` may declare `okf_version` `0.1` or `0.2`; index generation writes
  `okf_version: "0.2"` into the root index. Section references in the report updated
  to v0.2 numbering (index §8, log §9, conformance §11, versioning §12).

### Internal
- Portent validation is isolated in its own `portent.ts` module (vocabulary,
  settings, and checks); `OkfSettings` composes `PortentSettings`. Behavior-neutral.

## [0.2.2] - 2026-07-18

### Changed
- Re-release of 0.2.1 under a fresh tag. The `0.2.1` tag was first published
  against the wrong commit; the tag was corrected afterward, but downstream
  caches may have pinned the original, so this tag supersedes it. No code
  changes since 0.2.1.

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
- **Settings searchable on Obsidian 1.13+.** The settings tab now implements the
  declarative `getSettingDefinitions()` API, so every setting is indexed by
  Obsidian's global settings search on 1.13.0+. The imperative `display()` is
  kept as the fallback for older versions (dual-support); both render from one
  shared definition list so they can't drift.

### Changed
- **Minimum Obsidian version is now 1.7.2** (was 1.4.0). The plugin already
  relied on APIs newer than the old floor — `fileManager.processFrontMatter`
  (since 1.4.4) and `workspace.revealLeaf` (since 1.7.2) — so the declared
  `1.4.0` never actually worked; the manifest now states the true minimum.

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

[0.5.0]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.5.0
[0.4.1]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.4.1
[0.4.0]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.4.0
[0.3.0]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.3.0
[0.2.2]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.2.2
[0.2.1]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.2.1
[0.2.0]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.2.0
[0.1.3]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.3
[0.1.2]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.2
[0.1.1]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.1
[0.1.0]: https://github.com/MartinForReal/okf-enforcer/releases/tag/0.1.0
