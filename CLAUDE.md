# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A dependency-free GNOME Shell extension (GJS, ES modules, GNOME 46–48) that shows Claude Code subscription usage (5-hour session + weekly) as two mini progress bars in the top bar. No build step, no package manager.

## Commands

```bash
gjs -m test.js    # assert-based unit checks + one live fetch (live part skipped if ~/.claude/.credentials.json is missing)

# Dev install: symlink so edits are picked up on shell restart
ln -sfn "$PWD/claude-usage@local" ~/.local/share/gnome-shell/extensions/claude-usage@local
gnome-extensions enable claude-usage@local

# Run in a nested shell without logging out
dbus-run-session -- gnome-shell --nested --wayland   # GNOME 46–47
dbus-run-session -- gnome-shell --devkit             # GNOME 48+

journalctl -f -o cat /usr/bin/gnome-shell             # shell log
```

There is no test runner or single-test selection: `test.js` is a flat list of `assert(...)` calls; add new checks there.

## Architecture

- `claude-usage@local/usage.js` — the only file importable outside GNOME Shell (no `resource:///org/gnome/shell/...` imports). Holds `fetchUsage` (reads the OAuth token from `~/.claude/.credentials.json`, GETs the undocumented `https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20`) and pure helpers `pct`, `level`, `until`. Put new logic here as pure functions so `test.js` can cover it.
- `claude-usage@local/extension.js` — UI only: `PanelMenu.Button` with two panel rows, two menu sections, a refresh item, and a `REFRESH_SECONDS` timer. `_refresh()` fetches into state; `_render()` paints from state (also re-run on menu open so countdowns stay current). `disable()` must tear down everything `enable()` creates (timer, Soup session, button).
- Response fields used: `five_hour` / `seven_day`, each with `utilization` (0–100) and `resets_at` (ISO).

## Coupled values (keep in sync)

- `PANEL_WIDTH` / `MENU_WIDTH` in `extension.js` must match the `.cu-track` / `.cu-track-big` widths in `stylesheet.css`. Fill widths are set from JS (scaled by the theme scale factor for HiDPI) and animated with `ease()`.
- `level()` thresholds (50 / 80) map to the `.cu-low` / `.cu-mid` / `.cu-high` classes in `stylesheet.css`.

## Rules

- Keep it dependency-free: GJS and GNOME platform libraries only.
- The extension must stay read-only with respect to `~/.claude/` — never write, refresh or copy the credentials file (Claude Code owns token refresh; an expired token surfaces as `HTTP 401` in the menu).
- Never commit tokens or real API responses.
- Supported shell versions are declared in `metadata.json`.
