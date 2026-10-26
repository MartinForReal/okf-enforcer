# Read-only plugin API v1

**Status:** Proposed design, October 26, 2026. No runtime API is implemented by
this document. The selected direction is a small API for companion plugins;
the contract and implementation decisions below remain proposals for review.

## Intent and boundaries

Let another Obsidian plugin reuse OKF Enforcer's validation in its own UI,
without bringing that plugin's product features into Enforcer. Enforcer owns
OKF checks and its existing configured Portent layer. A consumer owns its extra
analysis, branding, grading, certification, and any external service.

Goals are a versioned read-only contract, honest scan coverage, predictable
disable/reload behavior, and unchanged standalone use of Enforcer.

Non-goals are a generic rule/provider registry, third-party settings or report
sections, writes or auto-fix callbacks, subscriptions, certificate issuance,
network services, automatic plugin installation, and a portable core package.
Do not move Portent or migrate its persisted settings as part of this work.

## Approaches considered

| Approach | Benefit | Trade-off / decision |
| --- | --- | --- |
| Small runtime API in Enforcer | Companion plugins share the installed validator and configuration | Selected direction; consumers require an enabled provider and own availability checks |
| Host-independent core library | Plugins and CLIs can bundle validation without running Enforcer | Defer until a cross-host consumer exists; requires decoupling YAML parsing and a separate package/release contract |
| General extension framework | External rules could participate in the host's UI | Not selected; adds rule ownership, settings, lifecycle, and conformance ambiguity before there is a demonstrated need |

An external tool that already reads OKF Markdown does not need an Obsidian
runtime dependency. No integration or endorsement follows from this proposal.

## Current implementation

At the design baseline, plugin 0.6.1, [validator.ts](../../../validator.ts)
exports `validateContent`, but imports Obsidian's YAML parser and composes
Portent settings. These source exports are not an installed-plugin SDK.
[main.ts](../../../main.ts) owns asynchronous settings initialization,
validation orchestration, writes, and the report. Its `scanVault` updates UI
state and returns no report, while `processQueue` catches worker failures.
Neither the UI summary nor the private settings/report objects should become
the public contract.

## Proposed public surface

Expose `apiV1` on the enabled plugin only after persisted settings and required
workspace initialization have completed. Do not expose an API backed by
temporary defaults, or publish it after a failed initialization or unload.

| Member | Contract |
| --- | --- |
| `apiVersion` | Literal `1`; the contract's major version, independent of the plugin release |
| `pluginVersion` | Installed Enforcer version as a string |
| `okfVersion` | Target specification version as a string, initially `0.2` |
| `validateContent({ path, content })` | Promise of a report for supplied Markdown; no vault read, write, UI, or network activity |
| `scanVault({ signal }?)` | Promise of a read-only report for the configured vault scope; an optional `AbortSignal` supports cancellation |

`path` is a non-empty vault-relative `.md` path using `/`; reject absolute
paths, backslashes, and `.` / `..` segments. It need not exist. Derive root
versus nested reserved-file behavior from the path rather than a caller's
boolean. Explicit supplied content is validated even if its path would be
excluded from a vault scan. Content validation does not run folder-tree index
gap checks, and never claims to assess the whole vault.

Both methods capture the provider's configured checks and one evaluation time
at the start of the call. No caller-provided settings overrides are supported
in v1. Reports contain copied plain data, not live settings, `TFile`, `Plugin`,
DOM, caches, or internal mutable objects. Consumer mutation must not affect
Enforcer or another consumer. `FixKind` is not part of this read-only contract.

## Report semantics

Keep supplied-content and configured-vault reports explicitly distinguishable.
Each includes API/plugin/OKF versions, evaluation time, enabled checks,
`checkCoverage`, `conformance`, and diagnostics with `source`, `rule`,
`severity`, and `message`. Label the built-in
sources `okf` and `portent`; message wording is not a machine-stable identifier.
No third-party diagnostic registration is implied by these source labels.

Vault reports also include:

- Start and finish times, the effective excluded folders, and the fact that
  Obsidian's config directory is excluded.
- Every enumerated candidate, including clean files, with an outcome of
  validated, unreadable, or unprocessed. Candidate, successful, failed, and
  unprocessed counts must reconcile.
- Folder/index-gap findings and failed folder checks separately from file
  counts. A finding about a missing `index.md` is not an extra scanned file.
- `status`: `complete`, `partial`, or `cancelled`. A read or folder-check failure
  produces `partial`; cancellation records the processed subset and leaves
  remaining candidates unprocessed. Malformed YAML is a validation diagnostic,
  not a read failure.
- `conformance`: `conformant`, `non-conformant`, or `unknown`, for the stated
  scope only. An incomplete/cancelled report or one with reduced check coverage
  is `unknown`, even when observed errors are also reported. With complete
  processing and full check coverage, core OKF errors mean non-conformant;
  otherwise conformant. Optional warnings, including Portent, do not change it.

For both content and vault reports, `checkCoverage` is `full` only when every
built-in core check group capable of emitting an error is enabled; otherwise
it is `reduced`. In particular, `checkAttestedComputation: false` means reduced
coverage and unknown conformance, even if no matching concept was observed.
Do not infer inapplicability to manufacture full coverage. Disabling only
warning-producing checks does not reduce error-check coverage. Report disabled
error-capable groups as reasons alongside the captured enabled checks. This
is deliberately more conservative than equating a completed configured pass
with conformance; it does not change existing validator severity classifications.

A complete scan means the enumerated configured scope was processed, not that
the mutable vault was read atomically. Excluded files were not certified, and
the report is not a signed snapshot, content-quality verdict, grade, or
independent certificate. Do not add hashes or attestation claims in v1.

## Availability, versions, and lifecycle

Obsidian's documented manifest has no community-plugin dependency declaration
or load-order contract. `minAppVersion` concerns Obsidian, not a provider API.
Community-directory policy prohibits plugins from installing or updating their
dependencies. Consumers must let users install/enable Enforcer themselves.

Document a small `getOkfApi(app)` lookup/shape-check helper. It returns the v1
facade or `undefined` when absent, disabled, initializing, incompatible, or
when discovery is unsupported. A generic unavailable/not-ready message must
not assume the provider is missing. Consumers reacquire on each user action
rather than assume initialization order or retain a reference indefinitely.

The conventional `app.plugins` discovery bridge is not in Obsidian's published
API. Isolate that access in the helper and describe it as a compatibility risk;
casts or module augmentation do not make it public. Do not add a global-window
registry. A zero-private-API requirement would require a different reviewed
protocol, not an undocumented promise that this lookup is supported.

Each facade belongs to one provider load generation. Unload invalidates it;
old references must fail even if Enforcer is subsequently re-enabled. Check
generation again after asynchronous work and before returning results. Never
publish a pending initialization's facade after unload. No v1 subscriptions
means no consumer callbacks retained by the provider.

Operational errors reject with an `Error` carrying a documented string `code`:
`invalid-request`, `unavailable`, or `busy`. Consumers inspect `code`, not
cross-bundle `instanceof`. A scan overlapping another scan/fix/index-write
operation reports `busy`, not an empty successful report or a Notice. An
aborted caller signal returns a cancelled report; provider unload instead
rejects with `unavailable`. An already-aborted signal reads no files.

Additive optional report fields may evolve within API v1. Removing fields or
changing their meaning requires a new API major. Plugin and OKF version
strings do not replace this compatibility check. No version bump or minimum
Obsidian-version increase is part of this design-only change.

## Implementation boundaries and acceptance

Factor a read-only collector away from presentation so the API and existing
UI use the same checks. Keep active-note versus vault scope explicit. API
calls must not invoke startup/index-generation, migration, or fix paths; they
must not open/refresh views, change the active-note verdict, or show Notices.
Preserve existing commands, automation, settings keys, and Portent opt-in
warning semantics. Read-only API design is not a sandbox: another installed
plugin already has its own vault access and security responsibilities.

Required verification before an implementation can ship:

- Core/Portent diagnostics agree with existing validation; reserved files,
  unsaved supplied content, optional warnings, and configured exclusions are
  covered. Content-only checks perform no vault I/O.
- A clean scan, a failed file read, a failed folder check, cancellation before
  and during work, and busy operation states produce truthful outcomes and
  counts; no incomplete scan can claim conformance.
- A fully processed report with `checkAttestedComputation` disabled has reduced
  check coverage and unknown conformance. Disabling warning-only groups alone
  does not reduce coverage. The same policy applies to supplied content.
- Initialization delay/failure, provider absent/disabled, consumer loading
  first, incompatible API, provider reload, stale references, and unload
  during asynchronous work are exercised.
- Settings changes during a call do not change its captured configuration;
  mutating a returned report cannot alter provider state or another report.
- Spies verify no vault mutations, network requests, or presentation side
  effects. Existing Enforcer workflows retain their regression coverage.
- Type-check against the existing Obsidian 1.7.2 floor, rebuild the tracked
  bundle, and test actual desktop and Android/iOS behavior. Passing source
  checks alone is not runtime/mobile acceptance.

File layout, test runner, internal collector interfaces, and efficient copying
are builder decisions. Keep the public types in a host-independent module
and document the helper/interface so companion authors can vendor the small
contract. A separately published npm SDK is not required for v1. An
implementation plan and code PR follow approval of this design, not this PR.

## Primary references

- [Canonical OKF v0.2 specification, especially conformance](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md#11-conformance)
- [Obsidian manifest](https://docs.obsidian.md/Reference/Manifest)
- [Obsidian developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Published Obsidian API declarations](https://github.com/obsidianmd/obsidian-api/blob/9abd9605ce081383674aae1ed111c456edde0688/obsidian.d.ts)
- [Obsidian lifecycle management](https://docs.obsidian.md/plugins/guides/lifecycle-management)
- [Dataview's lookup helper](https://github.com/blacksmithgu/obsidian-dataview/blob/5ad0994ff384cbb797de382e7edff2388141b73a/src/index.ts#L54-L60)
- [Tasks' explicitly versioned API](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/6c7e9a1443e645f29998619974329b61cd2d52dd/src/main.ts#L31-L33)
