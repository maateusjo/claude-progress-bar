// Run: gjs -m test.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';
import Soup from 'gi://Soup?version=3.0';
import {PROVIDERS, pct, level, until, codexLimits, fetchUsage} from './claude-usage@local/usage.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
assert(pct({utilization: 37.6}) === 38, 'pct rounds');
assert(pct({utilization: 150}) === 100, 'pct clamps high');
assert(pct(null) === 0, 'pct missing limit');
const now = Date.parse('2026-11-17T10:00:00Z');
assert(until('2026-11-17T12:14:30Z', now) === 'in 2h 14m', 'until hours');
assert(until('2026-11-17T10:45:00Z', now) === 'in 45m', 'until minutes');
assert(until('2026-11-17T09:00:00Z', now) === 'now', 'until past');
assert(until(null, now) === '—', 'until missing');
assert(!until('2026-11-20T10:00:00Z', now).startsWith('in '), 'until far uses weekday');
assert(level(49) === 'low' && level(50) === 'mid' && level(80) === 'high', 'level thresholds');
const [s, w] = codexLimits({rate_limit: {primary_window: {used_percent: 42, reset_at: now / 1000 + 3600}, secondary_window: null}});
assert(pct(s) === 42 && until(s.resets_at, now) === 'in 1h 0m', 'codex primary window');
assert(w == null && pct(w) === 0, 'codex missing window');
assert(codexLimits({}).every(l => l == null), 'codex missing rate_limit');

// One live fetch per provider whose CLI is logged in on this machine.
const loop = new GLib.MainLoop(null, false);
let failed = false;
const live = Object.entries(PROVIDERS).map(([id, p]) => {
    if (!GLib.file_test(p.creds, GLib.FileTest.EXISTS))
        return print(`live ${id}: skipped (${p.cli} not logged in)`);
    return fetchUsage(new Soup.Session({timeout: 15}), id)
        .then(([a, b]) => print(`live ${id}: 5h ${pct(a)}% (${level(pct(a))}), weekly ${pct(b)}%`))
        .catch(e => { print(`live ${id}: fetch failed:`, e.message); failed = true; });
});
// A server that accepts but never answers must surface as an error, not hang forever.
const silent = new Gio.SocketService();
const port = silent.add_any_inet_port(null);
silent.connect('incoming', () => true); // accept, never reply
const fakeCreds = GLib.build_filenamev([GLib.get_tmp_dir(), 'cu-test-creds.json']);
GLib.file_set_contents(fakeCreds, '{}');
PROVIDERS.hang = {creds: fakeCreds, url: `http://127.0.0.1:${port}/`, headers: () => ({}), limits: () => []};
live.push(fetchUsage(new Soup.Session(), 'hang', 1).then(
    () => { print('hang: resolved?!'); failed = true; },
    e => { if (e.message !== 'Request timed out') { print('hang:', e.message); failed = true; } }));
Promise.all(live).finally(() => loop.quit());
loop.run();
if (failed)
    System.exit(1);
print('ok');
