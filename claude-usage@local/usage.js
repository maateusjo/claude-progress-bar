import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

// shortcut: undocumented endpoint used by Claude Code's /usage; may change without notice.
const URL = 'https://api.anthropic.com/api/oauth/usage';
const CREDS = GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);

// Read-only: we never refresh the token (Claude Code owns that file); an expired token just shows an error until Claude Code runs again.
export async function fetchUsage(session) {
    const [, bytes] = GLib.file_get_contents(CREDS);
    const token = JSON.parse(new TextDecoder().decode(bytes)).claudeAiOauth?.accessToken;
    if (!token)
        throw new Error('Not logged in to Claude Code with a subscription');
    const msg = Soup.Message.new('GET', URL);
    msg.request_headers.append('Authorization', `Bearer ${token}`);
    msg.request_headers.append('anthropic-beta', 'oauth-2025-04-20');
    const body = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
    if (msg.status_code !== 200)
        throw new Error(`HTTP ${msg.status_code}`);
    return JSON.parse(new TextDecoder().decode(body.get_data()));
}

export function pct(limit) {
    return Math.round(Math.min(Math.max(limit?.utilization ?? 0, 0), 100));
}

// Matches the .cu-low/.cu-mid/.cu-high colors in stylesheet.css.
export function level(p) {
    return p >= 80 ? 'high' : p >= 50 ? 'mid' : 'low';
}

// Countdown when under a day away, otherwise the weekday and time.
export function until(iso, now = Date.now()) {
    if (!iso)
        return '—';
    const ms = new Date(iso).getTime() - now;
    if (ms <= 0)
        return 'now';
    if (ms >= 24 * 3600e3)
        return new Date(iso).toLocaleString([], {weekday: 'short', hour: '2-digit', minute: '2-digit'});
    const h = Math.floor(ms / 3600e3);
    const m = Math.floor(ms % 3600e3 / 60e3);
    return h ? `in ${h}h ${m}m` : `in ${m}m`;
}
