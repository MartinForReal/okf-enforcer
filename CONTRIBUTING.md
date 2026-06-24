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
- Keep changes focused; describe what and why in the PR.
- Follow the existing style: build DOM with `createEl`/`createDiv` (never `innerHTML`),
  put styling in `styles.css`, and register events via `registerEvent` so they unload.

## Reporting bugs

Open an issue with your Obsidian version, OS, plugin version, and steps to reproduce.

## Releasing (maintainers)

```bash
npm version patch   # or minor / major — updates manifest.json + versions.json
git push --follow-tags
```

Pushing the tag triggers the release workflow, which builds and attaches the assets.
