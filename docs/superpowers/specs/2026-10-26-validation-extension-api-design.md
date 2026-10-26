# Validation extension API v1

**Direction approved October 26, 2026:** the API must let companion plugins
extend validation inside Enforcer's existing reports. This supersedes the
initial read-only-query proposal in PR #26. Implementation and desktop E2E
remain required; a public API is not considered delivered by this document.

## Intent and approaches

Keep OKF Enforcer a focused host for OKF validation. Companion plugins own
additional rules, vocabularies, settings, and product integrations; Enforcer
runs their checks and presents clearly attributed findings with its own.

| Approach | Decision |
| --- | --- |
| Export read-only validation/scan queries | Insufficient for the user's goal; retain useful collection machinery internally, not as the primary public API |
| Register note validators into the existing pipeline | Selected; delivers a small extension point and shared reporting |
| General plugin framework with UI/fix/service registries | Not selected; Obsidian already hosts plugins and this project need not duplicate it |

V1 is note-level validation: active-note checks, each note in a vault scan, and
post-fix validation use the same extension pipeline. Reserved notes are
identified in the context so a provider can opt out. A separate whole-vault
provider phase, external service clients, generic UI extensions, automatic
dependency installation, extension auto-fixes, and certification are out of
scope. Existing built-in Portent settings and behavior remain compatible;
extracting it into a separately distributed production plugin is not required.

## Public contract

`apiV1` exposes API/plugin/OKF versions and:

```ts
registerValidator(provider: ValidationProvider): () => void;
```

A provider has a unique non-empty `id`, a human-readable `name`, and
`validate(context)`, returning an array of diagnostics synchronously or as a
Promise. Diagnostics contain a provider-owned `rule`, `message`, and severity
`error` or `warning`. The host supplies attribution; a provider cannot claim
the OKF namespace, attach core `FixKind` operations, or replace core findings.
Duplicate IDs reject instead of replacing another provider. The returned
disposer is idempotent and cannot remove a later registration reusing an ID.

Context contains a vault-relative `path`, note `kind` (concept/index/log),
`content`, Markdown `body`, parsed `frontmatter` or null with an explicit
missing/invalid/valid state, `evaluatedAt`, copied core diagnostics, and an
`AbortSignal`. Data is copied/frozen for each invocation; core state and another
provider's inputs are never shared mutable objects. Normalized date values are
ISO strings. No vault, Plugin, DOM, mutable settings, or write callback is given.
Invalid/missing frontmatter is still visible to body-oriented checks.

The lookup helper isolates conventional private `app.plugins` access, checks
the v1 shape, and returns undefined for absent/loading/disabled/incompatible
providers. A copyable `attachValidator(app, owner, provider)` helper registers
on readiness, reattaches after host reload, and disposes on the companion's
normal Component cleanup. Its owned workspace ready/stopping listeners are
removed on disposal. No global-window registry or periodic polling is used.

Register synchronously during the companion's load lifecycle, or explicitly
cancel its asynchronous setup on unload. A provider should capture its own
configuration per registration and re-register when its rule settings change.

## Lifecycle and failure isolation

Publish only after persisted settings and workspace readiness succeed. A
failed or late, already-unloaded initializer cannot publish defaults. Unload
invalidates old facades, aborts pending callbacks, and removes registrations;
an old facade must never register into a new host generation.

Each validation pass snapshots the current registrations. Disposing a
registration aborts its pending callbacks and discards late results. A failed,
malformed, or timed-out provider produces an attributed failure finding and an
incomplete extension assessment, while core and other providers continue.
The host's default asynchronous deadline is 2000 ms per provider/note. Aborting
and deadlines are cooperative: they cannot preempt synchronous JavaScript or
sandbox a plugin that already has its own Obsidian privileges.

Registration changes invalidate cached extension findings and schedule a
coalesced read-only refresh of the active note and any displayed vault report.
A pass from an older registry revision is not presented as current. A slow
active-note result must not overwrite a newer note's verdict. The host refresh
does not generate indexes, modify notes, open views, or steal focus.

## Core versus extension results

Core OKF findings keep their existing severity/fix rules. Portent remains
advisory. Additional findings carry host-owned provider ID/name and render in
the same file rows, with a visible source label. Extension errors may fail an
extension's assessment but **must not change core OKF conformance**. Status and
summary distinguish core errors, extension errors, and incomplete checks.

Fix eligibility and mutations remain core-only. After a user-invoked fix, the
shared validation pipeline runs again, so unresolved extension findings stay
visible without giving extensions a vault-writing capability.

Preserve honest internal scan accounting: clean/read-failed/unprocessed files,
folder/index-gap findings separate from file counts, captured settings/time,
and unknown core conformance for unreadable/cancelled or reduced core checks.
Provider failure is separately incomplete extension coverage, not a fabricated
core error or an apparently successful extension pass. A scan is not atomic
and is not a certificate.

## Required verification

- Registration, duplicate/reserved IDs, malformed diagnostics, stripped fix
  fields, multiple providers, source attribution, and preserved core verdicts.
- Copied/frozen context, real YAML in Obsidian, reserved/malformed notes, async
  failures/deadlines, abort, disposal, and ignored late results.
- Same findings in active-note, save-triggered, full-scan, and post-fix reports.
- Companion loads before host, host restarts while companion stays enabled,
  companion unloads while a callback is pending, and no callback/listener leak.
- A real separate test companion adds/removes visible findings in installed
  Obsidian; provider failure does not stop core checks or another provider.
- No validation-driven Markdown mutations; existing fix/index commands still
  work on disposable fixtures. Type-check/build and the tracked bundle agree.
- Obsidian 1.7.2 API compatibility stays; actual Android/iOS acceptance remains
  an explicit gate if only a Windows runtime is available.

## References

- [OKF conformance](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md#11-conformance)
- [Obsidian lifecycle management](https://docs.obsidian.md/plugins/guides/lifecycle-management)
- [Obsidian manifest](https://docs.obsidian.md/Reference/Manifest)
- [Community-directory developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Public API declarations](https://github.com/obsidianmd/obsidian-api/blob/9abd9605ce081383674aae1ed111c456edde0688/obsidian.d.ts)
