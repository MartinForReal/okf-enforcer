# Read-only Plugin API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PR #26 and exercise the built provider and a companion plugin in a disposable Obsidian vault.

**Architecture:** Keep public types/discovery host-independent. Share a read-only collector between the revocable facade and the existing UI; keep presentation outside the collector. Test ordinary control flow in Node and the actual bundle, parser, lifecycle, and UI in installed Obsidian.

**Tech Stack:** TypeScript 5.4.5, Obsidian API 1.7.2, esbuild 0.28.1, Node's built-in tests; installed Obsidian 1.14.5 and the bundled Windows computer-use driver.

**Spec:** `docs/superpowers/specs/2026-10-26-read-only-plugin-api-design.md`

## Global Constraints

- API version `1`, OKF `0.2`, existing Obsidian 1.7.2 floor; no release publishing.
- Publish only after saved settings and workspace readiness; invalidate across unload/reload.
- No API writes, fixes, UI updates, network, subscriptions, global registry, third-party rule registry, or automatic dependency installation.
- Public diagnostics contain source/rule/severity/message, not FixKind, Plugin, TFile, caches, or live settings.
- Snapshot configuration and evaluation time per call; incomplete or reduced error-check coverage means unknown conformance.
- Keep file outcomes/counts separate from folder/index-gap findings; preserve existing settings, Portent warnings, and user workflows.
- Test a disposable vault/profile only. Desktop E2E is required; absent Android/iOS runtimes remain an explicit separate acceptance gate.

## Review Focus

- Unload during a read rejects unavailable rather than returning stale results (Tasks 2/3).
- UI mutation between API awaits yields busy without blocking existing user operations (Tasks 2/3).
- Nested settings arrays and returned DTOs cannot mutate an in-flight call or provider state (Tasks 1/2).
- Missing indexes are folder findings, not extra files or negative clean-file counts (Tasks 2/3).
- Delayed/rejected settings loads cannot publish default-backed facades (Task 3).

---

### Task 1: Public contract and supplied-content validation

**Files:** Create `api.ts`, `validation.ts`, `tests/api-content.test.ts`, `tests/obsidian-stub.ts`, `tests/run.mjs`; modify `validator.ts`, `package.json`.

**Interfaces:** Produce `OkfApiV1`, copied diagnostic/content/vault DTOs, operational codes, and `getOkfApi(app: unknown): OkfApiV1 | undefined`; produce configuration snapshot, content-report, and diagnostic/conformance conversion helpers. Add an optional evaluation Date to existing `validateContent`, preserving defaults.

- [ ] Write failing tests for invalid paths, excluded/unsaved supplied content, reserved files, diagnostic ownership, full/reduced coverage, fixed freshness time, copied data, and unavailable/incompatible discovery.
- [ ] Run `npm test`; observe missing-feature failures before implementation.
- [ ] Implement the small contract/content adapter and clock plumbing without altering severities.
- [ ] Use JSON-flow frontmatter in Node tests; the host stub parses only this valid YAML subset. Actual YAML parsing is a Task 3 runtime assertion, not a unit-test claim.
- [ ] Run all tests and `npx tsc --noEmit`; expect the new content/discovery cases to pass.
- [ ] Commit the independently testable building blocks.

### Task 2: Shared collector and revocable facade

**Files:** Create `scan.ts`, `api-service.ts`, `tests/api-scan.test.ts`.

**Interfaces:** Consume Task 1's types/helpers. Produce `collectVault(host, settings, context): Promise<CollectedScan>`, preserving internal fix metadata for the UI and converting separately to copied public DTOs. Produce a controller with `publish()`, `dispose()`, and optional `api`; the host supplies file/folder readers and an activity busy/revision snapshot.

- [ ] Write failing tests for clean/error/unreadable files, folder failures/gaps, empty scope, cancellation, exact counts, reduced coverage, concurrent scans, UI activity, configuration changes, disposal, stale handles, and unload during pending reads.
- [ ] Run `npm test`; verify new failures describe missing collector/lifecycle behavior.
- [ ] Implement batched read-only collection with per-candidate outcomes, fixed configuration/time, cancellation, copied DTOs, and guard checks after awaits. Do not swallow lifecycle/busy errors as read findings.
- [ ] Run the whole suite and type-check; expect Tasks 1/2 green.
- [ ] Commit the collector/controller.

### Task 3: Actual Obsidian integration and desktop E2E

**Files:** Modify `main.ts`, `report-view.ts`, `styles.css`; create `tests/e2e/consumer.ts`, `tests/e2e/prepare.mjs`, `tests/e2e/README.md` and any narrowly scoped available-driver runner.

**Interfaces:** Adapt Task 2 to real Obsidian files/folders with captured settings. `OkfPlugin.apiV1` exposes only the current initialized facade. Produce a companion receipt with named assertions, runtime/provider versions, bundle hash, fixture path, and fault-injection labels.

- [ ] Write the companion before wiring main; its first actual-app run demonstrates the absent runtime API.
- [ ] Prepare a new vault/profile outside the checkout with clean/error/invalid-YAML/Attested/reserved/excluded fixtures and deterministic automation settings; leave existing vaults and security/privacy settings unchanged.
- [ ] Publish after settings/layout readiness, invalidate before unload, and guard delayed initialization. Track existing operation activity/revision so API reads never change UI or block user work.
- [ ] Share the collector with UI scans. Preserve fixable/active-note behavior; show incomplete/reduced coverage and correct file/folder counts.
- [ ] Run the companion in installed Obsidian via the available CUA driver, with a disposable-instance loopback Electron debug connection if needed.
- [ ] Assert real YAML parsing, matching diagnostics, unchanged note bytes/events, no API-driven UI change, scopes/gaps, failures, busy/cancel, delayed/failed initialization, stale handles, re-enable, and unload during a read.
- [ ] Use CUA to invoke the companion command and inspect rendered results; exercise Enforcer's active-note/full-report/fix controls on fixture notes.
- [ ] Run tests/type-check/build and actual-app E2E after fixes; preserve receipts and label fault injection accurately.
- [ ] Commit integration, tracked bundle, and reproducible test fixture.

### Task 4: Documentation, review, and PR delivery

**Files:** Create `docs/plugin-api.md`; update `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `.github/workflows/build.yml`, and the approved design status/evidence.

**Interfaces:** Consume implemented types and actual receipts; no additional features.

- [ ] Document the lookup helper, errors, scope/coverage, lifecycle, and private-discovery risk; add `npm test` to CI and development instructions.
- [ ] Record exact desktop evidence and bundle identity; retain the mobile gate rather than relabeling source checks mobile E2E.
- [ ] Obtain one fresh whole-branch review; fix important findings with RED/GREEN regression tests and a green full suite.
- [ ] Verify a fresh build matches the tracked bundle, intended diff scope, and preserved local configuration.
- [ ] Update existing PR #26 with implementation/evidence; keep the already-merged #25 separate. Do not merge or publish a release.
