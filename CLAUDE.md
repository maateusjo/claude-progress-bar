# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A dependency-free GNOME Shell extension (GJS, ES modules, GNOME 46–48) that shows Claude Code or ChatGPT/Codex subscription usage (5-hour session + weekly) as two mini progress bars in the top bar. No build step, no package manager.

## Commands

```bash
gjs -m test.js    # assert-based unit checks + one live fetch per provider whose credentials file exists

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

- `claude-usage@local/usage.js` — the only file importable outside GNOME Shell (no `resource:///org/gnome/shell/...` imports). Holds the `PROVIDERS` table (`claude`: token from `~/.claude/.credentials.json` → `api.anthropic.com/api/oauth/usage`; `codex`: token + account id from `$CODEX_HOME/auth.json` → `chatgpt.com/backend-api/wham/usage`, both undocumented), `fetchUsage(session, provider)` which returns `[session5h, weekly]` as `{utilization, resets_at}`, and pure helpers `pct`, `level`, `until`, `codexLimits`, `jwtEmail`. `accountName(provider)` shows the username part of the account email left of the logo (Claude: `oauthAccount.emailAddress` in `~/.claude.json`; Codex: `email` claim of `tokens.id_token`). A new provider is one entry in `PROVIDERS` whose `limits()` normalizes to that shape. Put new logic here as pure functions so `test.js` can cover it.
- `claude-usage@local/extension.js` — UI only: `PanelMenu.Button` with two panel rows, two menu sections, provider radio items (choice saved in `~/.config/claude-usage-provider`), a refresh item, and a `REFRESH_SECONDS` timer. `_refresh()` fetches into state; `_render()` paints from state (also re-run on menu open so countdowns stay current). `disable()` must tear down everything `enable()` creates (timer, Soup session, button).
- Claude response: `five_hour` / `seven_day` with `utilization` (0–100) and `resets_at` (ISO). Codex response: `rate_limit.primary_window` / `secondary_window` with `used_percent` and `reset_at` (Unix seconds).
- `_refresh()` drops results if the provider was switched while the request was in flight.

## Coupled values (keep in sync)

- `PANEL_WIDTH` / `MENU_WIDTH` in `extension.js` must match the `.cu-track` / `.cu-track-big` widths in `stylesheet.css`. Fill widths are set from JS (scaled by the theme scale factor for HiDPI) and animated with `ease()`.
- `level()` thresholds (50 / 80) map to the `.cu-low` / `.cu-mid` / `.cu-high` classes in `stylesheet.css`.

## Rules

- Keep it dependency-free: GJS and GNOME platform libraries only.
- The extension must stay read-only with respect to `~/.claude/`, `~/.claude.json` and `~/.codex/` — never write, refresh or copy credentials files (the CLIs own token refresh; an expired token surfaces as `HTTP 401` in the menu).
- Never commit tokens or real API responses.
- Supported shell versions are declared in `metadata.json`.
