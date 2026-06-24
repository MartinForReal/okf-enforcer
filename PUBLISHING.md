# Publishing OKF Enforcer to the Obsidian Community Store

This guide walks through everything from a fresh GitHub repo to an accepted listing.
Replace `MartinForReal` and `MartinForReal` everywhere they appear (manifest.json,
LICENSE, community-plugin-entry.json) with your real GitHub handle and display name first.

## 0. One-time prerequisites
- A public GitHub account.
- `git` and Node.js 18+ installed locally.

## 1. Fill in your identity
Search-and-replace these placeholders across the repo before committing:
- `MartinForReal`   -> your name (manifest.json `author`, LICENSE copyright line)
- `MartinForReal` -> your GitHub username (manifest.json `authorUrl`, repo URLs)

Confirm none remain:
    grep -rn "MartinForReal\|MartinForReal" .

## 2. Create the GitHub repository
The repo name should match the plugin id by convention: `okf-enforcer`.

    # from inside this folder
    git init
    git add .
    git commit -m "Initial release: OKF Enforcer v0.1.0"
    git branch -M main
    git remote add origin https://github.com/MartinForReal/okf-enforcer.git
    git push -u origin main

## 3. Create the GitHub release
Obsidian installs plugins from a GitHub *release* whose tag is the exact version
number — **no leading `v`** (tag must be `0.1.0`, not `v0.1.0`).

Attach these three files as individual release assets (NOT zipped):
- `main.js`
- `manifest.json`
- `styles.css`

Using the GitHub CLI:

    gh release create 0.1.0 main.js manifest.json styles.css \
      --title "0.1.0" --notes "First release."

Or via the web UI: Releases -> Draft a new release -> tag `0.1.0` ->
upload the three files -> Publish.

## 4. Verify the repo structure
The submission bot checks for these at the repo root:
- [x] `manifest.json` (with `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `isDesktopOnly`)
- [x] `versions.json`
- [x] `main.js` (committed AND attached to the release)
- [x] `README.md`
- [x] `LICENSE`
- [x] A release tagged `0.1.0` with main.js + manifest.json + styles.css attached

## 5. Submit to obsidianmd/obsidian-releases
1. Fork https://github.com/obsidianmd/obsidian-releases
2. Edit `community-plugins.json` and append your entry as the **last** array element
   (the contents are in `community-plugin-entry.json` in this repo — copy that object in,
   keeping the existing entries and adding a comma after the previous one).
3. Commit and open a Pull Request against `obsidianmd/obsidian-releases`.
4. The PR template asks you to confirm a checklist — tick the items (they match section 4).
5. An automated bot validates your repo/release; fix anything it flags. A human reviewer
   then reviews the code. Be responsive to comments — this can take days to weeks.

## 6. After acceptance
Once merged, the plugin appears in **Settings -> Community plugins -> Browse** within a
few hours. Future updates: bump the version with `npm version patch|minor|major`
(this runs `version-bump.mjs` to update manifest.json + versions.json), commit, then
create a new GitHub release tagged with the new version and the three assets attached.
You do NOT submit another PR for updates — Obsidian picks up new releases automatically.

## Common rejection reasons to avoid
- Tag has a leading `v` (must be bare `0.1.0`).
- `main.js`/`manifest.json`/`styles.css` zipped instead of attached individually.
- `manifest.json` id doesn't match across repo, or contains `obsidian`/`plugin` in the name.
- Using `innerHTML`/`outerHTML` or inline styles instead of the DOM API + CSS classes
  (this plugin already uses `createEl`/`createDiv` and a `styles.css`).
- Not unloading registered views/events on plugin disable (this plugin detaches its view
  in `onunload` and registers all events via `registerEvent`).
