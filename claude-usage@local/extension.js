import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {fetchUsage, pct, level, until} from './usage.js';

const REFRESH_SECONDS = 120;
// Keep in sync with .cu-track / .cu-track-big widths in stylesheet.css.
const PANEL_WIDTH = 48;
const MENU_WIDTH = 240;
const CENTER = Clutter.ActorAlign.CENTER;

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._session = new Soup.Session({timeout: 15});
        this._usage = this._error = this._updated = null;
        this._button = new PanelMenu.Button(0.0, 'Claude usage', false);

        const panel = new St.BoxLayout({style_class: 'cu-panel', y_align: CENTER});
        panel.add_child(new St.Label({text: '✦', style_class: 'cu-icon', y_align: CENTER}));
        const rows = new St.BoxLayout({vertical: true, style_class: 'cu-rows', y_align: CENTER});
        this._rows = [this._panelRow(rows), this._panelRow(rows)];
        panel.add_child(rows);
        this._button.add_child(panel);

        this._sections = [this._section('Session (5h)'), this._section('Weekly')];
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._refreshItem = new PopupMenu.PopupMenuItem('⟳ Refresh');
        this._refreshItem.connect('activate', () => this._refresh());
        this._button.menu.addMenuItem(this._refreshItem);
        // Countdowns only change with time, so recompute them whenever the menu opens.
        this._button.menu.connect('open-state-changed', (_m, open) => open && this._render());

        Main.panel.addToStatusArea(this.uuid, this._button);
        this._refresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
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
        const limits = [this._usage?.five_hour, this._usage?.seven_day];
        limits.forEach((limit, i) => {
            const p = pct(limit);
            const row = this._rows[i], sec = this._sections[i];
            this._setFill(row.fill, PANEL_WIDTH, p);
            this._setFill(sec.fill, MENU_WIDTH, p);
            row.value.text = this._error ? '⚠' : `${p}%`;
            sec.value.text = `${p}%`;
            sec.reset.text = `resets ${until(limit?.resets_at)}`;
        });
        if (this._error) {
            this._sections[0].reset.text = `⚠ ${this._error}`;
            this._sections[1].reset.text = this._error.startsWith('HTTP 401') ? 'Token expired? Run Claude Code once to refresh it.' : '';
        }
        const at = this._updated?.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        this._refreshItem.label.text = at ? `⟳ Refresh · updated ${at}` : '⟳ Refresh';
    }

    async _refresh() {
        try {
            this._usage = await fetchUsage(this._session);
            this._updated = new Date();
            this._error = null;
        } catch (e) {
            this._error = e.message;
        }
        if (this._button) // may have been disabled while the request was in flight
            this._render();
    }

    disable() {
        GLib.source_remove(this._timer);
        this._session.abort();
        this._button.destroy();
        this._button = this._rows = this._sections = this._refreshItem = this._session = this._usage = null;
    }
}
