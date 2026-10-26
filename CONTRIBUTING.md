# Contributing to OKF Enforcer

Thanks for your interest in improving OKF Enforcer!

## Development setup

```bash
git clone https://github.com/MartinForReal/okf-enforcer.git
cd okf-enforcer
npm install
npm test
npx tsc --noEmit
npm run build
```

To test in a real vault, symlink or copy `main.js`, `manifest.json`, and `styles.css`
into `<your-vault>/.obsidian/plugins/okf-enforcer/` and reload Obsidian. The
[Hot Reload](https://github.com/pjeby/hot-reload) plugin speeds up iteration.

## Before opening a pull request

- Run `npm test` — these are Node tests with Obsidian boundary doubles, not
  proof of actual YAML parsing, desktop UI behavior or mobile acceptance.
- Run `npx tsc --noEmit` — the build must type-check cleanly.
- Run `npm run build` — `main.js` must build without errors.
- **Commit the rebuilt `main.js`.** It is a tracked artifact, not a build output
  git ignores: Obsidian loads the plugin from it, and the release workflow
  attaches whatever the tag points at. A PR that changes a `.ts` file but not
  its `main.js` reads as correct and ships nothing. If you're unsure yours is
  current, rebuild and check `git status` — no diff means it was.
- Keep changes focused; describe what and why in the PR.
- Follow the existing style: build DOM with `createEl`/`createDiv` (never `innerHTML`),
  put styling in `styles.css`, and register events via `registerEvent` so they unload.

## Validation extensions

See the [plugin-author guide](docs/plugin-api.md) and the compilable
[owner-policy example](examples/owner-validator/main.ts). Keep the public API
focused on registering validation; internal collection/report helpers are not
an exported scan SDK. Extension findings must remain attributed, non-fixable,
and separate from core conformance.

Follow [the disposable Obsidian E2E procedure](tests/e2e/README.md) for runtime
changes. Never use a personal vault/profile, bypass a vault-trust prompt, or
equate a green source suite with runtime acceptance. Receipts and screenshots
belong outside the repository; report actual desktop and mobile gates honestly.

## Reporting bugs

Open an issue with your Obsidian version, OS, plugin version, and steps to reproduce.

## Releasing (maintainers)

Releases go through a PR like any other change, so the version bump is reviewable
and the tag lands on `main`:

```bash
git switch -c release/0.6.0 origin/main
npm version minor --no-git-tag-version   # updates package.json + manifest.json + versions.json
npm run build                            # main.js is tracked — commit the rebuild
```

Then date the `## [Unreleased]` heading in `CHANGELOG.md`, open the PR, and once
it's merged, tag the merge commit:

```bash
git switch main && git pull
git tag 0.6.0 && git push origin 0.6.0
```

Pushing the tag triggers the release workflow, which builds and attaches the
assets. **Let the workflow create the release — don't publish one from the GitHub
UI.** Doing that creates the tag itself, so the run finds a release already
there; the workflow now uploads onto it rather than failing, but the generated
notes are then whatever you typed by hand.
