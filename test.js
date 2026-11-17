// Run: gjs -m test.js
import GLib from 'gi://GLib';
import System from 'system';
import Soup from 'gi://Soup?version=3.0';
import {pct, level, until, fetchUsage} from './claude-usage@local/usage.js';

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

if (GLib.file_test(GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']), GLib.FileTest.EXISTS)) {
    const loop = new GLib.MainLoop(null, false);
    fetchUsage(new Soup.Session({timeout: 15}))
        .then(u => print(`live: 5h ${pct(u.five_hour)}% (${level(pct(u.five_hour))}), 7d ${pct(u.seven_day)}%`))
        .catch(e => { print('fetch failed:', e.message); System.exit(1); })
        .finally(() => loop.quit());
    loop.run();
} else {
    print('live: skipped (Claude Code not logged in)');
}
print('ok');
