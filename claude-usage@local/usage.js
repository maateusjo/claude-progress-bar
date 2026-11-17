import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

// shortcut: undocumented endpoints (Claude Code's /usage, Codex's /status); may change without notice.
const home = GLib.get_home_dir();
const codexHome = GLib.getenv('CODEX_HOME') ?? GLib.build_filenamev([home, '.codex']);

// Read-only: we never refresh tokens (the CLIs own those files); an expired token just shows an error until the CLI runs again.
export const PROVIDERS = {
    claude: {
        name: 'Claude', icon: '✦', cli: 'Claude Code',
        creds: GLib.build_filenamev([home, '.claude', '.credentials.json']),
        url: 'https://api.anthropic.com/api/oauth/usage',
        headers: c => {
            const token = c.claudeAiOauth?.accessToken;
            if (!token)
                throw new Error('Not logged in to Claude Code with a subscription');
            return {'Authorization': `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20'};
        },
        limits: u => [u.five_hour, u.seven_day],
    },
    codex: {
        name: 'ChatGPT', icon: '◎', cli: 'Codex',
        creds: GLib.build_filenamev([codexHome, 'auth.json']),
        url: 'https://chatgpt.com/backend-api/wham/usage',
        headers: c => {
            const t = c.tokens;
            if (!t?.access_token)
                throw new Error('Not logged in to Codex with ChatGPT');
            const h = {'Authorization': `Bearer ${t.access_token}`, 'User-Agent': 'codex-cli'};
            if (t.account_id)
                h['chatgpt-account-id'] = t.account_id;
            return h;
        },
        limits: codexLimits,
    },
};

// Codex: primary window is the 5h limit, secondary the weekly one; reset_at is Unix seconds.
export function codexLimits(u) {
    const win = w => w && {utilization: w.used_percent, resets_at: new Date(w.reset_at * 1000).toISOString()};
    return [win(u.rate_limit?.primary_window), win(u.rate_limit?.secondary_window)];
}

// Returns [session (5h), weekly] limits as {utilization, resets_at}.
export async function fetchUsage(session, provider, timeoutSeconds = 20) {
    const p = PROVIDERS[provider];
    const [, bytes] = GLib.file_get_contents(p.creds);
    const headers = p.headers(JSON.parse(new TextDecoder().decode(bytes)));
    const msg = Soup.Message.new('GET', p.url);
    for (const [k, v] of Object.entries(headers))
        msg.request_headers.append(k, v);
    // Hard deadline: Soup's own timeout doesn't always fire on a stalled HTTP/2 connection, which left "…" forever.
    const cancellable = new Gio.Cancellable();
    let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
        timer = 0;
        cancellable.cancel();
        return GLib.SOURCE_REMOVE;
    });
    let body;
    try {
        body = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
    } catch (e) {
        if (!cancellable.is_cancelled())
            throw e;
        session.abort(); // drop the stuck connection so the next refresh opens a fresh one
        throw new Error('Request timed out');
    } finally {
        if (timer)
            GLib.source_remove(timer);
    }
    if (msg.status_code !== 200)
        throw new Error(`HTTP ${msg.status_code}`);
    return p.limits(JSON.parse(new TextDecoder().decode(body.get_data())));
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
