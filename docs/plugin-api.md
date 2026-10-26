# Extending validation from another Obsidian plugin

> API v1 is implemented on this development branch; this does not announce a
> release. Feature-detect it rather than assuming an installed version has it.

OKF Enforcer hosts **note-level validators**, not another general plugin
framework. A companion owns its policy, settings and integrations. Enforcer
runs its checks in the active-note and vault reports and labels the source of
each finding. Examples include an organization’s required owner, an allowed
type vocabulary, project metadata conventions, or extra attestation policy.

An extension error means that policy failed, **not that the note violates core
OKF**. Provider crashes and deadlines mean extension checks are incomplete,
not that core validation failed or that the extension passed. Built-in Portent
remains compatible and advisory; it has not been extracted into a dependency.

## Quick start: require an owner

1. Have the user install and enable both Obsidian plugins. There is no automatic
   dependency installation or plugin-loader ordering guarantee in this API.
2. Copy/vendor this repository’s [`api.ts`](../api.ts) into your companion as
   `src/vendor/okf-api.ts`. It has no host implementation or runtime Obsidian
   imports. **There is no published npm SDK.** Do not import Enforcer’s `main`,
   registry, internal report DTOs or validator implementation.
3. Register synchronously in `onload` using the lifetime-aware helper:

```ts
import { Plugin } from "obsidian";
import { attachValidator } from "./vendor/okf-api";

export default class OwnerPolicy extends Plugin {
  onload() {
    attachValidator(this.app, this, {
      id: "my-owner-policy/required-owner",
      name: "Owner policy",
      validate(context) {
        if (context.signal.aborted || context.kind !== "concept" ||
            context.frontmatterState !== "valid") return [];
        const owner = context.frontmatter?.owner;
        return typeof owner === "string" && owner.trim() ? [] : [{
          rule: "owner-required",
          message: "Set a non-empty owner in frontmatter.",
          severity: "error",
        }];
      },
    });
  }
}
```

The same compilable example lives in
[`examples/owner-validator`](../examples/owner-validator/main.ts), with a sample
manifest. Bundle it as its own plugin with `obsidian` external, as for any
Obsidian plugin. Do not bundle the host. Add `owner: human:alice` to a valid
concept to resolve the finding. `index.md` and `log.md` are deliberately skipped
by this example, but a provider may validate their bodies.

Run **Validate active note** or **Validate vault (full report)**. The existing
pane shows **Owner policy** alongside the diagnostic, with separate core and
extension verdicts. Save-time checks run when **On save → Check the note** (or
check and fix) is enabled. Core fixes revalidate; they do not resolve an owner
error or offer the extension an auto-fix operation.

## Contract

The host exposes `plugin.apiV1` with `apiVersion: 1`, `pluginVersion`,
`okfVersion`, and one operation:

```ts
registerValidator(provider: ValidationProvider): () => void;
```

| Provider field | Meaning |
| --- | --- |
| `id` | Stable unique lowercase ID, preferably `your-plugin/rule-set`; segments contain letters, digits, `.`, `_`, `-`, separated by `/` |
| `name` | Non-empty human-readable source label |
| `validate(context)` | An array of diagnostics, or a Promise of that array |

IDs in the `okf` or `okf-enforcer` namespaces are reserved. Duplicate IDs throw;
one plugin cannot silently replace another. The returned disposer is
idempotent. A stale disposer cannot remove a later registration with the same
ID. Public registration errors carry `code` equal to `invalid-provider`,
`duplicate-provider` or `unavailable`.

Each diagnostic has a non-empty `rule`, non-empty `message`, and severity
`"error"` or `"warning"`. Use stable rule IDs owned by your plugin. Return `[]`
when the check passes or is inapplicable. The host adds the source ID/name;
extra fields such as `fix`, `providerId` or `providerName` are not accepted as
authority and are stripped. Core findings cannot be replaced or suppressed.

### Callback context

| Field | Contents |
| --- | --- |
| `path` | Vault-relative Markdown path |
| `kind` | `"concept"`, `"index"` or `"log"` (reserved names are recognized by the host) |
| `content` | Complete Markdown text read for this pass |
| `body` | Text after the frontmatter block, or the entire text when it has no recognized block |
| `frontmatter` | Parsed mapping, or `null`; Obsidian’s YAML parser is used |
| `frontmatterState` | `"valid"`, `"missing"` or `"invalid"`; a non-mapping YAML value is invalid |
| `evaluatedAt` | Captured ISO timestamp, shared by the pass |
| `coreDiagnostics` | Copied note-level OKF diagnostics, without fixes, other providers or Portent; folder-gap checks are separate |
| `signal` | Invocation-specific `AbortSignal` for cooperative cancellation |

Data is copied/frozen per invocation, including nested YAML values and core
diagnostics. Parsed date objects normalize to ISO strings. YAML aliases/cycles
may be preserved; do not assume every parsed mapping can be JSON-stringified.
No mutable vault, plugin, DOM, host settings or write callback is supplied.
Do not mutate context or retain it indefinitely. Invalid/missing frontmatter
still reaches body-oriented validators; do not assume `frontmatter` exists.

Active-note, scan, save and post-fix checks use the same pipeline. A pass
captures settings, evaluation time and registrations. Scans obey exclusions
and the configured Obsidian configuration directory. They are not atomic vault
snapshots or conformance certificates. Unreadable/unprocessed notes and reduced
core checks yield unknown core conformance; folder findings are counted
separately from notes. Extension coverage is tracked independently.

## Lifetime and load order

`attachValidator(app, owner, provider)` returns a cleanup function and registers
it with the companion’s normal `Component.register`. It:

- waits when Enforcer is absent, disabled, loading or incompatible;
- attaches once on `okf-enforcer:validators-ready`;
- disconnects on `okf-enforcer:validators-stopping` and reattaches to a new
  generation after host reload;
- removes its workspace listeners and registration on owner cleanup.

It does not poll, use a global window registry, install plugins or open a view.
Registration changes invalidate cached findings and coalesce a **read-only**
active-note refresh and any existing vault report. An older registry pass or
old tab’s slow callback cannot overwrite the new result. Ordinary note saves
obey the user’s existing live-check settings.

The host publishes only after saved settings and layout readiness succeed.
Failed initialization does not publish defaults. On unload, old facades are
revoked and pending callbacks are aborted. Do not cache an API reference across
reloads. If you need direct discovery, `getOkfApi(app)` returns a compatible
facade or `undefined`; prefer `attachValidator` for the full lifecycle.

**Private-discovery caveat:** Obsidian does not expose a typed public
cross-plugin service registry. `getOkfApi` isolates the conventional **private**
`app.plugins.plugins["okf-enforcer"]` lookup and checks the shape. Obsidian can
change those internals. The helper is a compatibility boundary, not an official
Obsidian dependency mechanism. Keep your plugin usable, or explain its missing
host dependency, when the API is unavailable.

If your companion loads settings asynchronously, cancel **its own setup** on
unload; `Component.register` cannot rescue an attachment first created after
its owner has already unloaded:

```ts
onload() {
  let stopped = false;
  this.register(() => { stopped = true; });
  void this.loadData().then((saved) => {
    if (stopped) return;
    const policy = makeProvider(saved); // your code: capture an immutable config
    attachValidator(this.app, this, policy);
  }).catch((error) => console.error("Policy setup failed", error));
}
```

Capture your rule settings per registration. When they change, dispose the
previous attachment and attach a new provider; that refreshes the host’s cached
findings. Keep any returned cleanup idempotent. Do not mutate a callback’s
captured configuration midway through a pass.

## Async checks and failures

The host’s asynchronous deadline is **2000 ms per provider per note**. Providers
run independently; a throw, rejection, malformed result or deadline produces a
source-labelled warning and an incomplete assessment while core and other
providers continue. An invalid diagnostic invalidates that invocation’s whole
result rather than accepting a misleading partial success.

Pass `context.signal` to cancellable I/O and check it before expensive work.
Unregistering, host unload, tab changes and scan invalidation abort pending
checks. Late results are discarded, even if your Promise ignores cancellation.
Clean up provider-owned listeners/timers in your own plugin lifecycle too.

This is **not a sandbox**, and the timer cannot preempt synchronous JavaScript.
A CPU-bound validator can still block Obsidian. A companion already has its own
Obsidian privileges; read-only context does not make untrusted code safe. Do not
perform writes as a validation side effect. Any network access, consent,
credentials, privacy policy and cache belong to the companion, not the host.
Prefer local/deterministic checks and avoid network fan-out for vault scans.

V1 does not register auto-fixes, arbitrary UI, services, whole-vault phases,
automatic dependency installation, or a public scan/query SDK. These are
deliberately separate from extending validation.

## Testing and current proof boundaries

- `npm test` covers registry isolation, revocation, attachment order/cleanup,
  pipeline results, core-versus-extension verdicts, initialization, stale tab
  and registry results, save/post-fix paths, and report rendering boundaries.
  Node tests use a JSON-flow YAML subset and Obsidian boundary doubles.
- `npx tsc --noEmit` also checks the owner example; `npm run build` rebuilds the
  tracked provider bundle against the Obsidian 1.7.2 API declarations.
- The actual desktop companion and marked-fixture driver are described in
  [`tests/e2e/README.md`](../tests/e2e/README.md). Test real YAML, visible source
  labels, core fixes, save checks, reload and pending-callback cleanup there.
- **October 26, 2026: 18/18 desktop checks passed in Windows Obsidian 1.14.5.**
  The pre-integration bundle first failed API readiness in the actual app;
  the current bundle passed after the human trust gate was resolved. No
  trust/security action was automated. Real command invocation used the
  fixture-scoped loopback driver; native CUA inspected the actual report.
  Pointer automation was unavailable, so native-input coverage is not claimed.
- The desktop receipt covers real YAML/frozen context, active/full source
  labels, status click, stale tab and scan cancellation, provider failures and
  the 2000 ms deadline, host/companion reload, delayed/failed settings,
  partial coverage, unchanged Markdown during validation, and separately
  labelled intentional save/fix/index controls. Screenshots show core OKF
  conformance staying successful on a note with an extension error.
- Tested provider bundle SHA-256:
  `83a6e67baa4a2ede3b8dc714ae4f3cb1559a40ad9ffaaab2587d939a4ec4228b`.
  Local receipts/screenshots remain outside the repository; the fixture
  procedure prints their location and is reproducible from source.
- Android/iOS runtime acceptance is **not tested**. The API is host-independent
  and the 1.7.2 type-check is not proof of desktop or mobile runtime acceptance.

## Upstream references

- [Obsidian lifecycle management](https://docs.obsidian.md/plugins/guides/lifecycle-management)
- [Obsidian plugin manifest](https://docs.obsidian.md/Reference/Manifest)
- [Obsidian API declarations](https://github.com/obsidianmd/obsidian-api)
- [OKF specification and conformance](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md#11-conformance)
