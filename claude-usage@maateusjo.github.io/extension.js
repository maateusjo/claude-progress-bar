import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {PROVIDERS, fetchUsage, accountName, readText, pct, level, until} from './usage.js';

const REFRESH_SECONDS = 120;
// Keep in sync with .cu-track / .cu-track-big widths in stylesheet.css.
const PANEL_WIDTH = 48;
const MENU_WIDTH = 240;
const CENTER = Clutter.ActorAlign.CENTER;
// Remembers the chosen provider across restarts; outside ~/.claude so we stay read-only there.
const CHOICE_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'claude-usage-provider']);

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._session = new Soup.Session({timeout: 15});
        this._usage = this._error = this._updated = this._account = null;
        this._provider = 'claude'; // until _start() has read the saved choice
        this._button = new PanelMenu.Button(0.0, 'Claude usage', false);

        const panel = new St.BoxLayout({style_class: 'cu-panel', y_align: CENTER});
        this._accountLabel = new St.Label({style_class: 'cu-account', y_align: CENTER, visible: false});
        panel.add_child(this._accountLabel);
        this._icon = new St.Label({style_class: 'cu-icon', y_align: CENTER});
        panel.add_child(this._icon);
        const rows = new St.BoxLayout({vertical: true, style_class: 'cu-rows', y_align: CENTER});
        this._rows = [this._panelRow(rows), this._panelRow(rows)];
        panel.add_child(rows);
        this._button.add_child(panel);

        this._sections = [this._section('Session (5h)'), this._section('Weekly')];
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._providerItems = Object.entries(PROVIDERS).map(([id, p]) => {
            const item = new PopupMenu.PopupMenuItem(`${p.icon}  ${p.name} (${p.cli})`);
            item.connect('activate', () => this._select(id));
            this._button.menu.addMenuItem(item);
            return [id, item];
        });
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._refreshItem = new PopupMenu.PopupMenuItem('⟳ Refresh');
        this._refreshItem.connect('activate', () => this._refresh());
        this._button.menu.addMenuItem(this._refreshItem);
        // Countdowns only change with time, so recompute them whenever the menu opens.
        this._menuOpenId = this._button.menu.connect('open-state-changed', (_m, open) => open && this._render());

        Main.panel.addToStatusArea(this.uuid, this._button);
        this._render();
        this._start();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _start() {
        try {
            const id = (await readText(CHOICE_FILE)).trim();
            if (PROVIDERS[id])
                this._provider = id;
        } catch {} // no saved choice yet
        if (this._button) // may have been disabled while reading
            this._refresh();
    }

    _meter(trackClass) {
        // A box packs from the left edge; St.Bin centered the fill on GNOME 46.
        const track = new St.BoxLayout({style_class: trackClass, y_align: CENTER});
        const fill = new St.Widget({style_class: 'cu-fill cu-low', width: 0});
        track.add_child(fill);
        return {track, fill};
    }

    _panelRow(parent) {
        const row = new St.BoxLayout({style_class: 'cu-row'});
        const {track, fill} = this._meter('cu-track');
        const value = new St.Label({text: '…', style_class: 'cu-row-value', y_align: CENTER});
        row.add_child(track);
        row.add_child(value);
        parent.add_child(row);
        return {fill, value};
    }

    _section(title) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false});
        const box = new St.BoxLayout({vertical: true, style_class: 'cu-section', x_expand: true});
        const header = new St.BoxLayout();
        header.add_child(new St.Label({text: title, style_class: 'cu-section-title', x_expand: true}));
        const value = new St.Label({text: '…', style_class: 'cu-section-value'});
        header.add_child(value);
        const {track, fill} = this._meter('cu-track-big');
        const reset = new St.Label({text: '', style_class: 'cu-reset'});
        box.add_child(header);
        box.add_child(track);
        box.add_child(reset);
        item.add_child(box);
        this._button.menu.addMenuItem(item);
        return {fill, value, reset};
    }

    _setFill(fill, width, p) {
        // CSS px are scaled on HiDPI, JS widths are not.
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        fill.ease({width: Math.round(width * scale * p / 100), duration: 600, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        fill.style_class = `cu-fill cu-${level(p)}`; // color fade comes from transition-duration in CSS
    }

    _render() {
        const p = PROVIDERS[this._provider];
        this._accountLabel.text = this._account ?? '';
        this._accountLabel.visible = !!this._account;
        this._icon.text = p.icon;
        this._icon.style_class = `cu-icon cu-icon-${this._provider}`;
        for (const [id, item] of this._providerItems)
            item.setOrnament(id === this._provider ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        // Placeholders until the selected provider's first fetch, so a switch never shows stale numbers.
        const limits = this._usage ?? [null, null];
        limits.forEach((limit, i) => {
            const p = pct(limit);
            const row = this._rows[i], sec = this._sections[i];
            this._setFill(row.fill, PANEL_WIDTH, p);
            this._setFill(sec.fill, MENU_WIDTH, p);
            row.value.text = this._error ? '⚠' : limit ? `${p}%` : '…';
            sec.value.text = limit ? `${p}%` : '…';
            sec.reset.text = limit ? `resets ${until(limit.resets_at)}` : '';
        });
        if (this._error) {
            this._sections[0].reset.text = `⚠ ${this._error}`;
            this._sections[1].reset.text = this._error.startsWith('HTTP 401') ? `Token expired? Run ${p.cli} once to refresh it.`
                : this._error.startsWith('HTTP 429') ? 'Rate limited by the server; retrying automatically.' : '';
        }
        const at = this._updated?.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        this._refreshItem.label.text = at ? `⟳ Refresh · updated ${at}` : '⟳ Refresh';
    }

    _select(id) {
        if (id === this._provider)
            return;
        this._provider = id;
        try {
            GLib.file_set_contents(CHOICE_FILE, id);
        } catch (e) {
            console.warn(`AI Usage Meter: could not save provider choice: ${e.message}`);
        }
        this._usage = this._error = this._updated = this._account = null;
        this._render();
        this._refresh();
    }

    async _refresh() {
        const provider = this._provider;
        let usage, error = null;
        try {
            usage = await fetchUsage(this._session, provider);
        } catch (e) {
            error = e.message;
        }
        const account = await accountName(provider); // re-read each time so a CLI re-login shows up
        if (provider !== this._provider) // switched while the request was in flight
            return;
        this._account = account;
        if (error) {
            this._error = error;
        } else {
            this._usage = usage;
            this._updated = new Date();
            this._error = null;
        }
        if (this._button) // may have been disabled while the request was in flight
            this._render();
    }

    disable() {
        GLib.source_remove(this._timer);
        this._session.abort();
        this._button.menu.disconnect(this._menuOpenId);
        // Destroying the button also destroys these children; explicit calls keep the review checker happy.
        this._accountLabel.destroy();
        this._icon.destroy();
        this._refreshItem.destroy();
        this._button.destroy();
        this._button = null;
        this._accountLabel = null;
        this._icon = null;
        this._refreshItem = null;
        this._session = null;
        this._rows = this._sections = this._providerItems = this._usage = null;
    }
}
