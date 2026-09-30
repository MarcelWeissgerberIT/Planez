// Entscheidungskarte: aktuelles Ereignis der Spielerrolle mit Optionen und Restzeit
import { activeDecision, describe, choose } from '../sim/decisions.js';
import { esc } from '../util.js';
import { setHTML } from './dom.js';
import { sfx } from '../audio.js';

export class DecisionCard {
  constructor(game) {
    this.game = game;
    const el = document.createElement('section');
    el.id = 'decision';
    el.className = 'hidden';
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.cur = null;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-opt]');
      if (!b || !this.cur) return;
      const s = this.game.state;
      if (choose(s, this.cur, Number(b.dataset.opt), true)) sfx.click();
      this.cur = null;
      this.update(s);
    });
  }

  update(s) {
    const d = s && activeDecision(s);
    if (!d) {
      if (!this.el.classList.contains('hidden')) this.el.classList.add('hidden');
      this.cur = null;
      return;
    }
    const c = describe(s, d);
    if (!c) return;
    if (this.cur !== d.id) {
      this.cur = d.id;
      this.el._html = null;
      sfx.request();
    }
    const left = Math.max(0, d.expires - s.time);
    const frac = left / Math.max(1, d.expires - d.t);
    const mins = Math.ceil(left / 60);
    setHTML(
      this.el,
      `<div class="dc-head"><span class="dc-i">${c.icon}</span><div><div class="dc-k">Entscheidung</div><div class="dc-t">${esc(c.title)}</div></div></div>
      <p class="dc-x">${esc(c.text)}</p>
      <div class="dc-opts">${c.options.map((o, i) => `<button class="dc-o${i === 0 ? ' def' : ''}" data-opt="${i}"><b>${esc(o.label)}</b><small>${esc(o.detail || '')}</small></button>`).join('')}</div>
      <div class="dc-time"><i style="width:${(frac * 100).toFixed(1)}%"></i><span>${mins >= 60 ? Math.round(mins / 60) + ' h' : mins + ' min'} Spielzeit · sonst „${esc(c.options[0].label)}“</span></div>`
    );
    this.el.classList.remove('hidden');
  }
}
