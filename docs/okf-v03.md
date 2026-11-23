# Open Knowledge Format 0.3: compatibility reference

**Pin:** [upstream `SPEC.md` at `527e81aff55992be21507e97004286789126f88c`][spec]. The [October 23 draft][draft] became **Version 0.3** on [November 18, 2026][promotion]. On November 23, 2026, upstream advertised no Git tags and listed no GitHub Releases. This is a non-draft spec commit, not a `v0.3` tag or a claim about OKF Enforcer support.

## Two breaking changes from 0.2

1. **Paths start beside the referring file.** `/` starts at the bundle root, which need not be the vault or repository root; it is not an OS path. Readers **must** resolve both forms for body links and path fields. Only for 0.2-or-earlier or unversioned bundles **may** a reader retry a missing file-relative **path field** at the root. This fallback is not for body links or declared 0.3 bundles. Compare Acme's actual `attester.resource`: [`attesters/sql_equality.py` in 0.2][old-path] became [`/attesters/sql_equality.py` in 0.3][new-path]. [§6][paths] · [§§12–13.1][versions]
2. **A human review can expire on edit.** A verification needs `by` and `at`. Count it only if its instant is **at or after** `generated.at`, or `generated` is absent. Keep older events as history. Any current `human:<id>` gives human-reviewed; only non-human current events (including `team:` or unknown schemes) give machine-confirmed; none gives unverified. No legacy fallback restores a lost tier. `generated.at` records meaningful content changes, not formatting or link repairs. Only `by` is explicitly required in `generated`; §5.3 does not equate a present record with an unusable `at` to an absent `generated`. [§§5.2–5.3][trust] · [§7][actors] · [0.2 trust rule][old-trust]

Before 1.0 a minor version can break compatibility. Readers **should** try an unfamiliar declared version rather than refuse the bundle. Older/unversioned bundles may use two v0.1 fallbacks: read `timestamp` if `generated` is absent, and read a legacy `# Citations` list. Neither is required in new files. [§12][versions] · [Appendix B][legacy]

## Conformance: bundle, reader, producer

- **Bundle / validator.** [§11.1][conformance] tests whether every existing frontmatter block in an in-scope `.md` parses as a YAML mapping and whether reserved files, if present, follow §§8–9. A concept is a non-reserved UTF-8 `.md` with a nonempty string `type`, the only universally required key. Its YAML 1.2 core mapping starts and ends with exact `---` lines, the first at file start. Ordinary Markdown without frontmatter or without `type` is skipped (validators **should** warn); malformed frontmatter is not absent. Dot-files and dot-directories are excluded; non-Markdown files are assets. [§§3–4][discovery] · [§4.1][metadata]
- **Reader.** Accept unknown types and keys at any depth, missing optional families or indexes, and broken links. Null, `""`, and `[]` mean absent. Accept a singleton for `tags`, `sources`, `verified`, or `parameters`; `tags: "ops,finance"` is **one** tag. Ignore entries missing required keys and **should** warn; retain unknown vocabulary values and **may** warn. None of these makes the bundle nonconformant. [§11.2][conformance]
- **Producer / editor.** Must not emit duplicate keys (readers **may** reject them). Must retain unknown keys, even inside known mappings; `x-<producer>-<name>` is recommended, not required. Avoid reserializing unchanged values. Neither `index.md` nor `log.md` is a concept at any level. Of the reserved files, only the root index may have frontmatter. A root index declaring `okf_version: "0.3"` is recommended, not required; `title`, `description`, and `license` are optional bundle metadata, not concept defaults. Regeneration **must** preserve existing root-index frontmatter. Nested indexes and all logs have no frontmatter; log date headings use `YYYY-MM-DD`, newest first. [§4][discovery] · [§4.1][metadata] · [§§8–9][reserved]

## Other interoperability traps

- **Links and sources.** A URI scheme denotes an absolute URL. In-bundle paths are case-sensitive; encode spaces and reserved characters in path names. Never read outside the bundle from the local filesystem, including through symlinks. Strip the fragment for concept lookup. Inline/reference-style Markdown links and path fields targeting concepts give directed edges; links to assets are valid but not concept edges. `[[wikilinks]]` are not OKF links. `sources[].resource` is required within an entry but may be a free-text scope, not a path. A claim footnote joins to `sources[].id` by label, not list position or footnote text. [§3.2][discovery] · [§5.1][sources] · [§6][paths]
- **Time and status.** Accept quoted or YAML-native timestamps: an RFC 3339 date-time needs an offset; a date alone means midnight **UTC**. Use `stale_after`, not the edit or verification time: stale begins at `now >= stale_after`. An unparseable deadline must **never** be labeled fresh. Stale means review is due, not that a claim is false. Missing `status` defaults to `stable`; an unknown status does not and is excluded from current-only results. `superseded_by` applies only to `deprecated`; current-only readers **should** follow it. Keeping a deprecated stub on rename is guidance. [§5 timestamps][dates] · [§§5.4–5.5][lifecycle]
- **Attestable ≠ attested.** Only `type: Attested Computation` requires `runtime`. Each parameter needs `name` and `type`; `required` defaults to false. An explicit `computation` file takes precedence: if missing, **no** inline fallback. Without the field, use the first fence under any ATX `Computation` heading, stopping at the next same-or-higher heading. No usable computation means not attestable. An agent may bind parameters, not rewrite the computation. `executor` and `attester` are optional fields, but no runtime or no attester means no attested label. Definition verification is not a per-run verdict. The §10.5 walkthrough is informative; §11.2 says readers **should** surface a failed attestation. [§10.2][contract] · [§10.3][locator] · [§§10.5–11.2][verdict]

## Pinned fixtures and expected outcomes

- [Trust and timestamp tests][time-tests]: pre-edit human review alone → unverified; add a post-edit process check → machine-confirmed; a human check at the **exact** edit instant → human-reviewed. Includes native dates, offsetless date-times and impossible dates.
- [Acme's deprecated metric][stub] reaches the same successor by root-relative `superseded_by` and a file-relative body link. [Index regeneration fixture][index-test] preserves `x-acme-owner` while replacing the listing.
- [Appendix A's expected results][worked]: at `2026-07-01T00:00:00Z`, revenue is human-reviewed and fresh; profit is machine-confirmed and stale. Both computations are **attestable**; neither document proves a run passed.

[spec]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md
[draft]: https://github.com/open-knowledge-format/open-knowledge-format/blob/9506f310ed17c4f7c4ec942fb5a4aadce6152629/SPEC.md#L1-L11
[promotion]: https://github.com/open-knowledge-format/open-knowledge-format/commit/f097ae8ef309be3fafbe5cd2db21f135ac2d6bd1
[old-path]: https://github.com/open-knowledge-format/open-knowledge-format/blob/56e30af256a98c9fb421cba60ad0e0b9a87887ad/bundles/acme_retail/computations/revenue-ytd.md#L9-L13
[old-trust]: https://github.com/open-knowledge-format/open-knowledge-format/blob/56e30af256a98c9fb421cba60ad0e0b9a87887ad/SPEC.md#L401-L410
[new-path]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/bundles/acme_retail/computations/revenue-ytd.md#L9-L13
[discovery]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L97-L135
[metadata]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L151-L182
[dates]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L238-L250
[sources]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L267-L295
[trust]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L297-L335
[lifecycle]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L337-L369
[paths]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L373-L417
[actors]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L421-L436
[reserved]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L440-L500
[contract]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L516-L526
[locator]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L580-L602
[verdict]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L628-L674
[conformance]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L650-L691
[versions]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L695-L735
[legacy]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L929-L936
[time-tests]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/tests/test_document.py#L118-L167
[stub]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/bundles/acme_retail/metrics/gross-margin-legacy.md#L6-L15
[index-test]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/tests/test_index.py#L121-L131
[worked]: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#L919-L925
