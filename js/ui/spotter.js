// Spotterbuch-Oberfläche: Foto aufnehmen (Ausschnitt der Karte ohne Beschriftungen), Polaroid mit Punkten,
// Sammlung mit Album, Typen, Airlines/Lackierungen und Momenten. Hinweise auf seltene Fotomotive.
import { AC_TYPES, AIRLINES } from '../config.js';
import { HALF_W } from '../render/camera.js';
import { spotAircraft, spotBonus, spotBook, spotStats, spotWorth, momentsOf, SPECIALS, SPECIAL_KEYS, MOMENTS, RARITY, RARITY_DE, assignLook, motifOf, motifDone, MOTIF_PTS } from '../sim/spotter.js';
import { fmtClock, esc, clamp } from '../util.js';
import { toast } from './dom.js';
import { sfx } from '../audio.js';

const TABS = [
  ['album', '🖼️ Album'],
  ['types', '✈️ Typen'],
  ['liv', '🎨 Airlines & Lackierungen'],
  ['mom', '✨ Momente'],
];
// Leitwerk als kleine Grafik (CSS clip-path)
const fin = (c, acc, stripes) => {
  const bg = stripes ? `linear-gradient(180deg,${stripes.map((s, i) => `${s} ${(i / stripes.length) * 100}%,${s} ${((i + 1) / stripes.length) * 100}%`).join(',')})` : `linear-gradient(180deg,${c} 0 50%,${acc} 50% 66%,${c} 66%)`;
  return `<i class="sb-fin" style="background:${bg}"></i>`;
};

export class SpotterUi {
  constructor(game) {
    this.game = game;
    this.tab = 'album';
    this.hinted = new Set();
    const el = document.createElement('div');
    el.id = 'spotbook';
    el.className = 'hidden';
    document.getElementById('game').appendChild(el);
    this.el = el;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-sb-close]') || e.target === el) return this.toggle(false);
      const t = e.target.closest('[data-sbt]');
      if (t) {
        this.tab = t.dataset.sbt;
        this.render();
      }
      const ph = e.target.closest('[data-sbimg]');
      if (ph) ph.classList.toggle('big');
    });
    const pol = document.createElement('div');
    pol.id = 'spot-pol';
    pol.className = 'hidden';
    document.getElementById('game').appendChild(pol);
    pol.addEventListener('click', () => {
      pol.classList.add('hidden');
      this.toggle(true);
    });
    this.pol = pol;
    const fl = document.createElement('div');
    fl.id = 'spot-flash';
    document.getElementById('game').appendChild(fl);
    this.flash = fl;
  }
  isOpen() {
    return !this.el.classList.contains('hidden');
  }
  toggle(on = !this.isOpen()) {
    this.el.classList.toggle('hidden', !on);
    if (on) {
      this.pol.classList.add('hidden');
      this.render();
    }
  }

  // ältere Spielstände: Kennzeichen nachtragen
  ensureLooks(state) {
    for (const ac of state.acs) if (!ac.reg && state.rots[ac.rot]) assignLook(ac, state.rots[ac.rot]);
  }

  // Kartenausschnitt um das Flugzeug als Vorschaubild (ohne Beschriftungen und Auswahl)
  capture(ac) {
    const g = this.game, cam = g.cam, map = g.map;
    // in einer 3D-Ansicht (Mitfliegen, Turmblick, Kino) wird das 3D-Bild fotografiert
    if (g.ride && g.ride.on && g.ride.use3d && g.ride.v3d) {
      const u = g.ride.v3d.snapshot(ac.id);
      if (u) return u;
    }
    const canvas = map.canvas;
    const keep = { x: cam.x, y: cam.y, tx: cam.tx, zoom: cam.zoom };
    const ui = { ...g.ui, labels: false, sel: null, selected: null, hoverStand: null, selStand: null, showStands: false };
    let url = null;
    try {
      // Teleobjektiv: so weit heranzoomen, dass das Flugzeug gut die Hälfte des Bildes füllt
      const len = AC_TYPES[ac.type].len;
      const wCss = Math.min(360, cam.w * 0.9);
      const hCss = wCss * 0.625;
      cam.zoom = clamp((wCss * 0.52) / (len * HALF_W * 1.15), 0.5, 2.6);
      cam.x = ac.x + (ac.z || 0) * 0.5;
      cam.y = ac.y + (ac.z || 0) * 0.5;
      cam.tx = null;
      map.render(g.state, 0, ui);
      const p = cam.toScreen(ac.x, ac.y, ac.z + 0.25);
      const d = cam.dpr;
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 160;
      const x = c.getContext('2d');
      x.fillStyle = '#0b1220';
      x.fillRect(0, 0, 256, 160);
      x.drawImage(canvas, (p.x - wCss / 2) * d, (p.y - hCss / 2) * d, wCss * d, hCss * d, 0, 0, 256, 160);
      // leichte Vignette wie ein Teleobjektiv
      const v = x.createRadialGradient(128, 80, 50, 128, 80, 160);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.35)');
      x.fillStyle = v;
      x.fillRect(0, 0, 256, 160);
      url = c.toDataURL('image/jpeg', 0.74);
    } catch (e) {
      url = null;
    }
    cam.x = keep.x;
    cam.y = keep.y;
    cam.tx = keep.tx;
    cam.zoom = keep.zoom;
    map.render(g.state, 0, g.ui);
    return url;
  }

  shoot(ac) {
    const s = this.game.state;
    if (!s || !ac) return;
    if (ac.mode !== 'map') return toast('📷 Noch zu weit weg – erst im Endanflug oder am Boden fotografieren', 'warn', 2600);
    const pre = ac.spotted ? ac.spotted.slice() : [];
    const fresh = momentsOf(s, ac).filter((k) => !pre.includes(k));
    if (pre.includes('_') && !fresh.length) return toast(`📷 ${ac.reg || ac.cs} ist schon im Kasten – warte auf einen neuen Moment (Start, Landung, Wetter …)`, 'info', 3000);
    const img = this.capture(ac);
    const res = spotAircraft(s, ac, img);
    // 3D-Foto: Bonus für ein formatfüllendes, mittiges Bild
    const q = this.game.ride && this.game.ride.v3d && this.game.ride.v3d.lastShotQ;
    if (q && performance.now() - q.t < 1000 && q.pts >= 10 && !res.dup) {
      const label = q.size > 0.75 && q.center > 0.75 ? '🖼️ Formatfüllend und mittig' : q.size > 0.75 ? '🔭 Schön nah dran' : '🎯 Gut getroffen';
      res.lines.push([label, q.pts]);
      res.pts += q.pts;
      spotBonus(s, q.pts);
    }
    if (s.settings.sound !== false) sfx.shutter();
    this.flash.classList.remove('go');
    void this.flash.offsetWidth;
    this.flash.classList.add('go');
    this.showPolaroid(ac, res, img);
    if (this.isOpen()) this.render();
  }

  showPolaroid(ac, res, img) {
    const t = AC_TYPES[ac.type];
    const al = AIRLINES[ac.airline];
    const lines = res.lines.map(([txt, p]) => `<div class="sp-l"><span>${esc(txt)}</span><b>+${p}</b></div>`).join('');
    this.pol.innerHTML = `<div class="sp-card">${img ? `<img src="${img}" alt="">` : '<div class="sp-noimg">📷</div>'}
      <div class="sp-cap"><b>${esc(ac.reg || ac.cs)}</b> · ${esc(t.name)}<small>${esc(al.name)}${ac.special ? ` · ${SPECIALS[ac.special].icon} ${esc(SPECIALS[ac.special].name)}` : ''}</small></div>
      <div class="sp-lines">${lines}</div><div class="sp-tot">📷 +${res.pts} Spotterpunkte <small>Spotterbuch öffnen (J)</small></div></div>`;
    this.pol.classList.remove('hidden', 'in');
    void this.pol.offsetWidth;
    this.pol.classList.add('in');
    clearTimeout(this.polT);
    this.polT = setTimeout(() => this.pol.classList.add('hidden'), 5200);
  }

  // Hinweis auf lohnende Motive (Beobachter: alle, sonst nur Sonderlackierungen und Superjumbos)
  update(state) {
    if (!state || state.scenario) return;
    // Motiv des Tages ankündigen (Beobachter)
    const mo = motifOf(state);
    if (state.role === 'observer' && this.motifDay !== mo.day && (state.time / 3600) % 24 > 6) {
      this.motifDay = mo.day;
      if (!motifDone(state)) toast(`🎯 Motiv des Tages: ${mo.t} fotografieren (+${MOTIF_PTS} Punkte)`, 'info', 5000);
    }
    // höchstens ein Hinweis alle 15 Sekunden (sonst stapeln sich bei leerem Spotterbuch die Meldungen)
    if (performance.now() - (this.lastHint || 0) < 15000) return;
    for (const ac of state.acs) {
      if (ac.mode !== 'map' || this.hinted.has(ac.id)) continue;
      const w = spotWorth(ac);
      if (!w) continue;
      this.hinted.add(ac.id);
      const big = ac.special || ac.type === 'A388';
      if (state.role !== 'observer' && !big) continue;
      toast(`📷 Fotomotiv: ${w} – ${esc(ac.cs)} anklicken und „Spotten“`, 'info', 4200);
      this.lastHint = performance.now();
      break;
    }
  }

  render() {
    const b = spotBook();
    const st = spotStats();
    const chip = (ic, n, all, lbl) => `<div class="sb-st"><b>${ic} ${n}${all ? `<small>/${all}</small>` : ''}</b><span>${lbl}</span></div>`;
    let body = '';
    if (this.tab === 'album') {
      const list = b.album.slice().reverse();
      body = list.length
        ? `<div class="sb-album">${list
            .map(
              (p) => `<figure class="sb-ph" data-sbimg>${p.img ? `<img src="${p.img}" alt="">` : '<div class="sp-noimg">📷</div>'}<figcaption><b>${esc(p.reg || p.cs)}</b> · ${esc(AC_TYPES[p.type]?.name || p.type)}<small>${esc(AIRLINES[p.al]?.name || '')}${p.sp && SPECIALS[p.sp] ? ` · ${SPECIALS[p.sp].icon}` : ''} · ${fmtClock(p.clock || 0)} ${(p.m || []).map((k) => MOMENTS[k]?.icon || '').join('')}</small><em>+${p.pts}</em></figcaption></figure>`,
            )
            .join('')}</div>`
        : `<div class="sb-empty">Noch keine Fotos. Klicke ein Flugzeug auf der Karte an und drücke <b>📷 Spotten</b> (oder <kbd>F</kbd> außerhalb des Towers). Seltene Typen, Sonderlackierungen und besondere Momente – Landung im Regen, Nachtstart, Enteisung – bringen mehr Punkte.</div>`;
    } else if (this.tab === 'types') {
      body = `<div class="sb-grid">${Object.keys(RARITY)
        .sort((a, c) => RARITY[a] - RARITY[c] || a.localeCompare(c))
        .map((k) => {
          const n = b.types[k] || 0;
          const cov = b.covers[k];
          const t = AC_TYPES[k];
          return `<div class="sb-type r${RARITY[k]} ${n ? '' : 'locked'}">${cov && cov.img ? `<img src="${cov.img}" alt="">` : `<div class="sb-sil" style="background-image:url(assets/sprites/${t.sprite}.webp)"></div>`}<div class="sb-tn"><b>${n ? esc(t.name) : '???'}</b><small>${RARITY_DE[RARITY[k]]}${n ? ` · ${n}×` : ''}</small></div></div>`;
        })
        .join('')}</div>`;
    } else if (this.tab === 'liv') {
      body = `<h4>Airlines</h4><div class="sb-livs">${Object.values(AIRLINES)
        .map((a) => {
          const n = b.airlines[a.code] || 0;
          return `<div class="sb-liv ${n ? '' : 'locked'}">${fin(a.color, a.color2)}<b>${n ? esc(a.name) : '???'}</b><small>${n ? `${n}×` : 'noch nicht gesehen'}</small></div>`;
        })
        .join('')}</div>
        <h4>Sonderlackierungen <small>selten – etwa jede 18. Maschine</small></h4><div class="sb-livs">${SPECIAL_KEYS.map((k) => {
          const sp = SPECIALS[k];
          const n = b.specials[k] || 0;
          return `<div class="sb-liv sp ${n ? '' : 'locked'}">${fin(sp.fin, sp.accent, sp.stripes)}<b>${n ? `${sp.icon} ${esc(sp.name)}` : '???'}</b><small>${n ? `${n}×` : 'noch nicht gesehen'}</small></div>`;
        }).join('')}</div>`;
    } else {
      body = `<div class="sb-moms">${Object.entries(MOMENTS)
        .map(([k, m]) => {
          const n = b.moments[k] || 0;
          return `<div class="sb-mom ${n ? '' : 'locked'}"><i>${n ? m.icon : '🔒'}</i><b>${esc(m.name)}</b><small>${n ? `${n} Foto${n > 1 ? 's' : ''}` : 'noch offen'}</small></div>`;
        })
        .join('')}</div>`;
    }
    this.el.innerHTML = `<div class="sb-box"><div class="sb-head"><div class="sb-title">📷 Spotterbuch <small>gilt für alle Spielstände</small></div>${this.game.state ? `<div class="sb-motif ${motifDone(this.game.state) ? 'done' : ''}">🎯 Motiv des Tages: <b>${esc(motifOf(this.game.state).t)}</b> ${motifDone(this.game.state) ? '✓ erledigt' : `+${MOTIF_PTS}`}</div>` : ''}<button class="icon-btn" data-sb-close aria-label="Schließen">✕</button></div>
      <div class="sb-stats">${chip('⭐', st.pts.toLocaleString('de-DE'), 0, 'Spotterpunkte')}${chip('🖼️', st.shots, 0, 'Fotos')}${chip('✈️', st.types, st.typesAll, 'Typen')}${chip('🏷️', st.airlines, st.airlinesAll, 'Airlines')}${chip('🎨', st.specials, st.specialsAll, 'Sonderlack.')}${chip('✨', st.moments, st.momentsAll, 'Momente')}</div>
      <div class="sb-tabs">${TABS.map(([k, n]) => `<button data-sbt="${k}" class="${this.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="sb-body">${body}</div></div>`;
  }
}
