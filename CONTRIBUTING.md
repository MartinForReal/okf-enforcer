# Contributing to OKF Enforcer

Thanks for your interest in improving OKF Enforcer!

## Development setup

```bash
git clone https://github.com/MartinForReal/okf-enforcer.git
cd okf-enforcer
npm install
npm run build
```

To test in a real vault, symlink or copy `main.js`, `manifest.json`, and `styles.css`
into `<your-vault>/.obsidian/plugins/okf-enforcer/` and reload Obsidian. The
[Hot Reload](https://github.com/pjeby/hot-reload) plugin speeds up iteration.

## Before opening a pull request

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
