# Actual Obsidian desktop E2E

This is a disposable **test companion**, not a shipped integration. It uses the
real provider bundle, Obsidian YAML parser, plugin loader, vault, and report UI.
Node tests use JSON-flow frontmatter only and do not establish runtime acceptance.

1. `npm run build`
2. `node tests/e2e/prepare.mjs` prints a new marked fixture root, vault, profile,
   evidence directory and loopback debug port. No existing vault is modified.
3. Launch the installed Obsidian executable with
   `--user-data-dir="<profile>" --remote-debugging-port=<debugPort>
   --remote-debugging-address=127.0.0.1`. Do not point this at a user profile.
4. Inspect the actual window with the available desktop driver. Use the command
   palette to run **OKF API E2E Consumer: Run OKF API E2E** and inspect its modal.
   A first-open vault-trust prompt must be decided **manually by the user**.
   Stop at that prompt: neither the harness nor automation may bypass it or
   change the app's security settings. Plugin-loader fault injection is allowed
   only after the fixture is trusted, never as an alternative to trust.
   Launch the app visibly and keep its launcher alive if the execution host
   otherwise closes GUI children when the launch command exits. For example,
   in PowerShell, use `$p = Start-Process -WindowStyle Normal -PassThru` with the
   isolated-profile arguments above, followed by `Wait-Process -Id $p.Id`.
   Keep the test window in the foreground throughout the suite. Hidden or
   fully occluded Electron windows throttle timers: an observed zero-delay
   timer took nearly 60 seconds, invalidating bounded race-check waits. The
   harness records visibility transitions and fails if the window is hidden;
   restore it with the native driver (or manually), reset and rerun. Do not
   enlarge race-check timeouts or disable app/browser protections to force GREEN.
5. `node tests/e2e/cdp.mjs <fixtureRoot> receipt` reads the actual result. The
   Node 22+ helper verifies the target vault before any non-inventory operation.
   `run` invokes the same companion programmatically; `screenshot` captures the
   real renderer. Neither substitutes for inspecting the visible UI.
6. Receipts and screenshots stay under the printed evidence directory, outside
   the repository. The receipt labels deliberately injected read/init failures.

For another build, close/reload only this isolated instance and run
`node tests/e2e/prepare.mjs <fixtureRoot>` to update its marked fixture. The tool
refuses arbitrary update paths. It never downloads or installs software, changes
security/privacy settings, or opens other vaults. Close the test app normally
when finished; preserve the evidence for review.

Desktop E2E does not establish Android/iOS acceptance. Record mobile separately.

The companion is listed before the host to exercise load order. It checks real
YAML/frozen context, source attribution, active/full agreement, failures and the
2-second deadline, host reload and stale handles, delayed/failed settings,
partial coverage and read-only index-gap reports. Markdown hashes are compared
**before** explicitly labelled save/fix/index mutation controls. It then unloads
and reloads the actual companion during a pending callback to check cancellation
and discarded late findings. Receipt fault-injection labels are part of the
evidence; these are not claims about failures in an ordinary vault.
It also checks status-click behavior, a real note switch while a callback is
pending, and registry replacement during a vault pass. Background refreshes
may overlap explicit validation: wait for the observed verdict and retain the
signal of the invocation being tested, not the last callback in another scan.
The save control starts only after competing refreshes settle and requires an
existing owner finding, so a background scan cannot masquerade as a save hook.

For a true RED/GREEN run, preserve the pre-integration bundle in the marked
fixture, run the companion and observe the absent API failure, then rebuild,
update the fixture and rerun. Do not report an unexecuted harness as passing.

### Verified desktop run (October 26, 2026)

Windows Obsidian **1.14.5: 18 passed, 0 failed**. The pre-integration build
failed the real-app registration-readiness check as expected. Provider bundle
SHA-256: `83a6e67baa4a2ede3b8dc714ae4f3cb1559a40ad9ffaaab2587d939a4ec4228b`.

Evidence is preserved outside the repository: the baseline RED receipt and
screenshot, GREEN receipts, and an actual active/vault report screenshot. CUA
accessibility confirmed the source label and separate core/extension results;
native pointer input was unavailable, so commands ran through the guarded
loopback driver. No trust/security decision was automated. The fixture starts
with nine in-scope notes; the separately labelled index-generation control
adds a tenth. Android/iOS and actual Obsidian 1.7.2 runtime remain untested.
