// Erfolge: Popup beim Freischalten und Galerie
import { ACHIEVEMENTS, achState } from '../sim/achievements.js';
import { esc, fmtClock } from '../util.js';
import { sfx } from '../audio.js';
import { T } from '../i18n.js';

let host = null;
const queue = [];
let busy = false;

export function showAchievement(a) {
  queue.push(a);
  pump();
}
function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const a = queue.shift();
  host = host || document.getElementById('game');
  const el = document.createElement('div');
  el.className = 'ach-pop';
  el.innerHTML = T`<div class="ach-i">${a.icon}</div><div><div class="ach-k">Erfolg freigeschaltet${a.xp ? ` · +${Math.round(a.xp / 2)} XP` : ''}</div><div class="ach-n">${esc(a.name)}</div><div class="ach-d">${esc(a.desc)}</div></div>`;
  host.appendChild(el);
  host.classList.add('ach-on');
  sfx.cash();
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => {
    el.remove();
    if (!queue.length) host.classList.remove('ach-on');
    busy = false;
    pump();
  }, 4700);
}

export function achievementsHtml(state) {
  const A = achState(state);
  const got = ACHIEVEMENTS.filter((a) => A[a.id]).length;
  return T`<div class="p-sec"><span>🏆 Erfolge</span><span class="cnt">${got} / ${ACHIEVEMENTS.length}</span></div><div class="ach-grid">${ACHIEVEMENTS.map((a) => `<div class="ach ${A[a.id] ? 'on' : ''}" title="${esc(a.desc)}${A[a.id] ? T` – erreicht Tag ${Math.floor(A[a.id] / 86400) + 1}, ${fmtClock(A[a.id])}` : ''}"><span class="ai">${A[a.id] ? a.icon : '🔒'}</span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`).join('')}</div>`;
}
