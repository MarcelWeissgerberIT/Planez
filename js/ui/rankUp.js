// Rang-Aufstieg: große Einblendung mit Medaille, neuen Möglichkeiten, Konfetti und Fanfare
import { RANKS } from '../sim/goals.js';
import { esc } from '../util.js';
import { sfx } from '../audio.js';

const MEDAL = ['🥉', '🥈', '🥇', '🏆', '🌍'];
const PERKS = [
  [],
  ['Airlines melden sich öfter mit Angeboten', 'Größere Ziele mit höheren Prämien', 'Bessere Chancen bei Vertragsverhandlungen', '+3 Ansehen'],
  ['Noch mehr Airline-Interesse, auch für Langstrecke', 'Ziele der dritten Stufe', 'Verhandlungen werden leichter', '+3 Ansehen'],
  ['Drehkreuz-Status: Airlines suchen dich aktiv', 'Höchste Ziel-Stufe mit Top-Prämien', '+3 Ansehen'],
  ['Weltflughafen – der Gipfel!', 'Maximale Anziehungskraft auf Airlines', '+3 Ansehen'],
];

export class RankUp {
  constructor(game) {
    this.game = game;
    const el = document.createElement('div');
    el.id = 'rankup';
    el.className = 'hidden';
    document.getElementById('game').appendChild(el);
    this.el = el;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-ru]')) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (this.el.classList.contains('hidden')) return;
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      }
    }, true);
  }

  show(state, rank) {
    const r = RANKS[rank];
    const next = RANKS[rank + 1];
    this.speed = state.speed || 1;
    state.speed = 0;
    const conf = Array.from({ length: 70 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:hsl(${(i * 47) % 360},90%,60%);animation-delay:${((i * 13) % 20) / 10}s;animation-duration:${2.6 + ((i * 7) % 10) / 6}s;--r:${(i * 53) % 360}deg"></i>`).join('');
    this.el.innerHTML = `<div class="ru-conf">${conf}</div><div class="ru-box">
      <div class="ru-k">Aufstieg · ${esc(state.name)}</div>
      <div class="ru-medal">${MEDAL[Math.min(MEDAL.length - 1, rank)]}</div>
      <h2>${esc(r.name)}</h2>
      <div class="ru-steps">${RANKS.map((x, i) => `<span class="${i < rank ? 'done' : i === rank ? 'cur' : ''}" title="${esc(x.name)}"></span>`).join('')}</div>
      <ul>${(PERKS[rank] || []).map((p) => `<li>✦ ${esc(p)}</li>`).join('')}</ul>
      <p class="ru-next">${next ? `Nächster Rang: <b>${esc(next.name)}</b> ab ${next.xp.toLocaleString('de-DE')} XP` : 'Höchster Rang erreicht.'}</p>
      <button class="btn btn-primary" data-ru>Weiter ▶</button></div>`;
    this.el.classList.remove('hidden');
    sfx.fanfare();
  }

  close() {
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
    const s = this.game.state;
    if (s && !s.speed) s.speed = this.speed || 1;
  }
}
