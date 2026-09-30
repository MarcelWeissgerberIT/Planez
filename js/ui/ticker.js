// Nachrichten-Ticker am unteren Rand (Manager und Beobachter)
import { newsState } from '../sim/news.js';
import { esc, fmtClock } from '../util.js';
import { glossify } from './glossary.js';

export class NewsTicker {
  constructor(game) {
    this.game = game;
    const el = document.createElement('div');
    el.id = 'ticker';
    el.innerHTML = '<span class="tk-l">📰 NEWS</span><div class="tk-w"><div class="tk-r"></div></div>';
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.row = el.querySelector('.tk-r');
    this.key = '';
    el.addEventListener('click', () => this.game.mgmt && this.game.mgmt.open('over'));
  }
  update(s) {
    const show = s && (s.role === 'manager' || s.role === 'observer');
    this.el.classList.toggle('hidden', !show);
    if (!show) return;
    const N = newsState(s);
    const items = N.items.slice(0, 8);
    const key = items.map((i) => i.t + i.text).join('|');
    if (key === this.key) return;
    this.key = key;
    if (!items.length) {
      this.row.innerHTML = `<span class="tk-i">Willkommen am ${esc(s.name)} – die ersten Nachrichten folgen in Kürze.</span>`;
      return;
    }
    const html = items.map((i) => `<span class="tk-i ${i.tone}"><b>${fmtClock(i.t)}</b> ${i.icon} ${esc(i.text)}</span>`).join('<span class="tk-s">◆</span>');
    // zweimal hintereinander für nahtloses Laufen
    this.row.innerHTML = html + '<span class="tk-s">◆</span>' + html + '<span class="tk-s">◆</span>';
    glossify(this.row);
    const w = this.row.scrollWidth / 2;
    this.row.style.setProperty('--tk-d', `${Math.max(30, w / 55)}s`);
    this.row.style.animation = 'none';
    void this.row.offsetWidth;
    this.row.style.animation = '';
  }
}
