## OKF Enforcer 0.1.0

First release. Keeps an Obsidian vault conformant with the **Open Knowledge Format (OKF) v0.1)** — every note self-describing, agent-readable, and portable.

**Highlights**
- Validate the whole vault against OKF v0.1, with errors vs. toggleable warnings that respect the spec's permissive rules.
- Non-destructive auto-fix on save, on create (incl. the Importer plugin), and on demand.
- A prompt to fill the required `type` (plus `title`/`description`) when it can't be inferred.
- Auto-generated `index.md` listings and dated `log.md` entries.
- Minimal UI footprint: a single clickable status-bar indicator, a compact collapsible report panel hidden by default, and an inline progress bar for large vaults.

**Install (manual):** copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/okf-enforcer/` and enable the plugin.

See the [README](README.md) for full usage and settings.
