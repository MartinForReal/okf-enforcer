# Validation Extension API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let companion plugins contribute validation findings to Enforcer's existing active-note/vault reports and prove the lifecycle in actual Obsidian.

**Architecture:** A small provider registry owns callbacks, attribution, cancellation and failure isolation. Existing validation/collection remains internal and invokes that registry. A public registration facade plus a lifetime-aware attach helper replaces the read-only-first public surface.

**Tech Stack:** Existing TypeScript 5.4.5, Obsidian API 1.7.2, esbuild 0.28.1, Node tests; installed Obsidian 1.14.5, disposable desktop companion, CUA and loopback-only CDP.

**Spec:** `docs/superpowers/specs/2026-10-26-validation-extension-api-design.md`

**Execution status, October 26, 2026:** The implementation has 75 passing Node
tests, type-check and a matching rebuilt bundle. The actual pre-integration
Obsidian build failed API readiness (RED); Windows Obsidian 1.14.5 then passed
all 18 desktop companion checks (GREEN). Receipts and real renderer screenshots
are preserved outside the repository. Native CUA inspected the report; pointer
input was unavailable, so real command invocation used the user-authorized
fixture-scoped loopback driver. No trust/security action was automated.

The fresh whole-branch review's receiver, sparse-output and queued-refresh
findings were fixed with RED/GREEN regressions, along with safe fixture reuse.
Runtime testing refined only the harness: wait for eventual UI state, track
the tested invocation's signal, isolate the save control from background work,
and reopen the result modal after the companion's real unload. A backgrounded
retry exposed Electron timer throttling (one zero-delay wait took nearly 60 s);
the harness now guards and records foreground visibility. A foreground-stable
repeat passed 18/18 without changing assertions, timeouts or production code.
The provider bundle is unchanged. PR #26 stays open as a draft for the user's review; no
merge or release. Android/iOS and actual Obsidian 1.7.2 runtime are untested.

## Global Constraints

- Public API v1 focuses on `registerValidator(provider): () => void`, not a general framework or scan-query SDK.
- Preserve core OKF conformance, built-in Portent settings, the 1.7.2 floor and core-only fixes; no release publishing or user-vault edits.
- Provider context is copied/frozen; diagnostics are attributed and cannot supply core fix callbacks or overwrite OKF findings.
- Default async deadline 2000 ms; failure/cancellation does not become a successful empty extension result or stop other validators.
- No global registry/polling; attachment follows host readiness/reload and owner cleanup.
- Keep pre-existing local .obsidian data untouched. Test only a marked disposable vault/profile.
- Source tests do not substitute for desktop E2E or actual mobile runtime acceptance.

## Review Focus

- A stale disposer or facade must not remove/register into a replacement generation (Task 1).
- A provider that throws, times out, returns invalid data or resolves after unload must not poison another provider or the core verdict (Task 1).
- Registration changes during a scan/active-note switch must not publish stale findings (Task 2).
- Save/status-click/fix paths must use the same extension checks without giving them write authority (Task 2/3).
- Host/companion enable ordering and repeated reload must not duplicate callbacks or leave workspace listeners (Task 1/3).

---

### Task 1: Provider contract, registry, and lifetime-aware attachment

**Files:** Modify `api.ts`, `api-service.ts`, `validation.ts`, `validator.ts`, existing tests; create `extensions.ts`, `validation-types.ts`, `tests/extensions.test.ts`.

**Interfaces:** Produce `ValidationProvider`, `ValidationContext`, `ValidationDiagnostic`, registration-only `OkfApiV1`, `attachValidator(app, owner, provider)`; internal `ExtensionRegistry.register/snapshot/validate/dispose` and revision. Keep useful read-only engine methods internal to `ApiController` and move internal report DTOs out of the public contract.

- [x] Write tests for registry behavior, duplicate/reserved IDs, copied context, multiple callbacks, failure/deadline/abort, invalid results, core separation, stale disposers/facades, load order, reattach and listener cleanup.
- [x] Run `npm test`; observe missing extension functionality before implementation.
- [x] Implement the narrow contract/registry/helper, preserving the existing internal collection tests rather than exporting their query surface.
- [x] Run all Node tests and `npx tsc --noEmit`; expect all old internal behaviors plus new extension cases green.
- [x] Commit the independently testable provider mechanism.

### Task 2: One validation pipeline and attributed existing UI

**Files:** Modify `main.ts`, `scan.ts`, `report-view.ts`, `styles.css`, internal controller and focused integration tests.

**Interfaces:** `OkfPlugin.apiV1` exposes the initialized registration facade; a pass captures settings, time and provider snapshot, returns core plus attributed extension findings and coverage. Internal scans retain file/folder counters and UI fix metadata.

- [x] Write failing tests for core verdict unaffected by extension errors, scanner provider outcomes, stale registry passes and active/full/post-fix agreement.
- [x] Wire settings/layout publication and unload invalidation, ready/stopping events, provider-change refresh, and active-note race cancellation.
- [x] Invoke extensions in active validation, full scans, on-save checks and post-fix validation. Keep fix eligibility core-only.
- [x] Show source labels and distinct core/extension/incomplete status in existing rows and summaries, without creating a new report/plugin framework.
- [x] Run full tests/type-check/build and commit the pipeline integration.

### Task 3: Actual Obsidian extension-consumer E2E

**Files:** Refocus `tests/e2e/consumer.ts`, `prepare.mjs`, `cdp.mjs`, `README.md` from query consumption to validator registration.

**Interfaces:** A separate real companion registers rules through the same public helper; receipts identify app/build, named outcomes, fixture-only mutations and explicit fault injection.

- [x] Run the companion against the pre-integration bundle first; confirm missing registration API is a real-app RED.
- [x] Exercise visible active/full reports, post-fix and on-save checks, duplicate/source isolation, failing and slow providers, host reload, owner unload during callbacks and automatic reattachment.
- [x] Inspect actual report/source labels with CUA and invoke the real command via the available fixture-scoped loopback driver; capture the actual renderer and preserve receipt/evidence outside the repository.
- [x] Verify no validation-driven note changes, and separately verify intentional core fix/index controls on disposable notes.
- [x] Repeat full tests/type-check/build and actual-app checks after fixes; commit fixture and tracked bundle.

### Task 4: Documentation, independent review, and PR delivery

**Files:** Add `docs/plugin-api.md`; update README, contributing instructions, changelog, CI, and design status/evidence.

- [x] Document a copyable registration/cleanup example, context, source ownership, async limits, private discovery and no sandbox promises.
- [x] Add Node tests to CI and record real desktop evidence with any untested mobile gate explicit.
- [x] Obtain one fresh whole-branch review; fix important findings with RED/GREEN regression tests and a green full suite.
- [x] Verify clean intended diff and rebuilt tracked bundle; update PR #26 to extension-focused implementation/evidence. Do not merge or publish a release.
