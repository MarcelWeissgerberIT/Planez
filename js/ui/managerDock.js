// Kompakter Leitstand (Manager/Beobachter): das Wichtigste auf einen Blick, Details in der Management-Zentrale
import { icon } from './icons.js';
import { setHTML } from './dom.js';
import { rivalState } from '../sim/rival.js';
import { boardBadge } from './board.js';
import { motifOf, motifDone } from '../sim/spotter.js';
import { esc, fmtMoney, fmtClock, dayOf } from '../util.js';
import { projects, remainingHours } from '../sim/construction.js';
import { fuelState, FUEL } from '../sim/fuel.js';
import { rwyCond, brakingAction, BRAKE_DE, hasRwy2 } from '../sim/runway.js';
import { goalsState, activeGoals, goalText, goalFraction, RANKS, rankName } from '../sim/goals.js';
import { PH } from '../sim/aircraft.js';
import { forecastInfo } from '../sim/events.js';
import { secState, secLanes } from '../sim/security.js';
import { fmtHours, realMinutes } from './projects.js';
import { isCareer, stageOf } from '../sim/career.js';
import { careerDockHtml, careerHeroHtml, careerClick, stagePic } from './careerUi.js';
import { Spotlight, MiniRadar, sparkPath, todoPic, sitePic } from './dockLive.js';

export class ManagerDock {
  constructor(root, game, observer = false) {
    this.root = root;
    this.game = game;
    root.innerHTML = `
      <div class="p-head"><div class="p-title">${observer ? icon('eye') + ' Beobachter' : icon('briefcase') + ' Leitstand'} <small id="mp-sub"></small></div></div>
      <div class="p-body dock-body">
        <div id="dk-hero"></div>
        <button class="dock-open" data-open="over"><span>${icon('briefcase')}</span><b>Management-Zentrale</b><kbd>O</kbd></button>
        ${observer ? '<button class="dock-open cine" data-cine><span>' + icon('cinema') + '</span><b>Kino-Modus</b><kbd>K</kbd></button><button class="dock-open spot" data-spotbook><span>' + icon('spotbook') + '</span><b>Spotterbuch</b><kbd>J</kbd></button><button class="dock-open stream" data-stream><span>' + icon('stream') + '</span><b>Livestream</b><kbd>L</kbd></button><div class="dock-spot-tip">Flugzeug anklicken, dann <kbd>F</kbd> oder 📷 Spotten: seltene Typen, Sonderlackierungen und besondere Momente sammeln.</div><div class="dock-motif" id="dk-motif"></div>' : ''}
        <div class="p-sec live"><span><i class="live-dot"></i>Live am Platz</span><span class="cnt" id="dk-rc"></span></div>
        <div class="sl" id="dk-spot" title="Anklicken: Flugzeug auf der Karte zeigen"></div>
        <div class="dk-radar"><canvas id="dk-radar"></canvas><span class="dk-radar-l">Luftlage</span></div>
        <div id="dk-career"></div>
        <div id="dk-kpi"></div>
        <div class="p-sec"><span>Jetzt wichtig</span></div>
        <div id="dk-todo"></div>
        <div class="p-sec"><span>Baustellen</span><span class="cnt" id="dk-cnt">0</span></div>
        <div id="dk-sites"></div>
        <div class="p-sec"><span>Ziele</span></div>
        <div id="dk-goals"></div>
      </div>`;
    root.classList.add('dock');
    this.spot = new Spotlight(root.querySelector('#dk-spot'), game);
    this.radar = new MiniRadar(root.querySelector('#dk-radar'));
    this.hist = [];
    // Radar und Spotlight laufen flüssig, solange die Leiste sichtbar ist
    let lastSpot = 0, lastDraw = 0;
    const loop = (t) => {
      requestAnimationFrame(loop);
      const s = this.game.state;
      if (!s || document.hidden || !this.root.offsetParent) return;
      if (t - lastDraw > 33) {
        lastDraw = t;
        this.radar.draw(s, t);
      }
      if (t - lastSpot > 500) {
        lastSpot = t;
        this.spot.update(s, t);
        const c = this.radar.counts;
        if (c) setHTML(this.root.querySelector('#dk-rc'), `<b class="in">↓ ${c.nArr}</b> <b class="out">↑ ${c.nDep}</b>`);
      }
    };
    requestAnimationFrame(loop);
    root.addEventListener('click', (e) => {
      if (careerClick(this.game, e)) return this.update(this.game.state);
      if (e.target.closest('[data-cine]')) return window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
      if (e.target.closest('[data-spotbook]')) return window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      if (e.target.closest('[data-stream]')) return window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }));
      const o = e.target.closest('[data-open]');
      if (o) return this.game.mgmt && this.game.mgmt.open(o.dataset.open);
      const sh = e.target.closest('[data-site]');
      if (sh) this.game.showSite && this.game.showSite(sh.dataset.site);
    });
  }

  update(s) {
    // Kopfbild: aktuelle Ausbaustufe (Aufbau) bzw. ein Luftbild passend zum Flughafen-Rang
    const career = isCareer(s);
    const heroKey = career ? 'c' + stageOf(s) : 'r' + Math.min(2, goalsState(s).rank);
    if (this.heroKey !== heroKey) {
      this.heroKey = heroKey;
      const hero = this.root.querySelector('#dk-hero');
      if (career) hero.innerHTML = careerHeroHtml(s);
      else hero.innerHTML = `<div class="cr-hero" data-open="over"><div class="cr-hero-img kb0" style="background-image:url(${stagePic(2 + Math.min(2, goalsState(s).rank))})"></div><div class="cr-hero-shade"></div><div class="cr-hero-t"><small>Flughafen-Rang</small><b>🏅 ${esc(RANKS[goalsState(s).rank].name)}</b></div></div>`;
    }
    setHTML(this.root.querySelector('#dk-career'), career ? careerDockHtml(s) : '');
    const small = career && stageOf(s) < 2;
    const mt = this.root.querySelector('#dk-motif');
    if (mt) setHTML(mt, `🎯 Motiv des Tages: <b>${esc(motifOf(s).t)}</b>${motifDone(s) ? ' <span class="ok">✓</span>' : ' · +150'}`);
    const t = s.stats.today;
    const L = s.ledger;
    const rev = Object.values(L.rev).reduce((a, b) => a + b, 0);
    const cost = Object.values(L.cost).reduce((a, b) => a + b, 0);
    const deps = t.onTime + t.delayed;
    const fu = fuelState(s);
    const cond = Math.round(rwyCond(s));
    // Verlauf: alle 10 Spielminuten eine Probe (Ergebnis und Bewegungen nur vom laufenden Tag)
    const day = dayOf(s.time);
    const slot = Math.floor(s.time / 600);
    if (this.lastSlot !== slot) {
      this.lastSlot = slot;
      this.hist.push({ day, res: Object.values(s.ledger.rev).reduce((a, b) => a + b, 0) - Object.values(s.ledger.cost).reduce((a, b) => a + b, 0), rep: s.reputation, mov: s.stats.today.mov, cash: s.cash });
      if (this.hist.length > 72) this.hist.shift();
    }
    const today = this.hist.filter((h) => h.day === day);
    const SPK = { res: today.map((h) => h.res), rep: this.hist.map((h) => h.rep), mov: today.map((h) => h.mov), cash: this.hist.map((h) => h.cash) };
    const tile = (k, v, cls = '', open = '', sp = '') => `<div class="k${open ? ' link' : ''}${sp ? ' has-spark' : ''}" ${open ? `data-open="${open}"` : ''}>${sp ? sparkPath(SPK[sp]) : ''}<span>${k}</span><b class="${cls}">${v}</b></div>`;
    setHTML(
      this.root.querySelector('#dk-kpi'),
      `<div class="kpis dock-kpis">${tile('Ergebnis heute', fmtMoney(rev - cost), rev - cost >= 0 ? 'pos' : 'neg', 'fin', 'res')}${tile('Ansehen', `${Math.round(s.reputation)}/100`, '', 'over', 'rep')}${tile('Pünktlich', deps ? Math.round((t.onTime / deps) * 100) + ' %' : '—', '', 'over')}${tile('Bewegungen', t.mov, '', 'over', 'mov')}${small ? '' : tile('Tanklager', `${Math.round(fu.stock)} t`, fu.stock < FUEL.cap * 0.15 ? 'neg' : '', 'fuel')}${tile('Piste', `${cond} % · ${BRAKE_DE[brakingAction(s)]}`, cond < 45 ? 'neg' : '', 'runways')}${small ? '' : tile('Sicherheitskontrolle', `${Math.round(secState(s).wait)} min Wartezeit`, secState(s).wait > 15 ? 'neg' : '', 'terminal')}${small ? '' : tile('Marktanteil', `${Math.round(rivalState(s).share)} % vs. Nordhafen`, rivalState(s).share < 45 ? 'neg' : rivalState(s).share > 55 ? 'pos' : '', 'rival')}${!small && s.board && s.board.targets ? tile('Aufsichtsrat', boardBadge(s), s.board.conf < 40 ? 'neg' : s.board.conf >= 75 ? 'pos' : '', 'board') : ''}</div>`
    );
    // Aufgaben
    const todo = [];
    if (s.offers.length) todo.push(['contracts', '📨', `${s.offers.length} Vertragsangebot${s.offers.length > 1 ? 'e' : ''} prüfen`, 'warn']);
    const waiting = s.acs.filter((a) => (a.phase === PH.VACATED || a.phase === PH.TAXI_WAIT) && !a.stand).length;
    if (waiting) todo.push(['stands', '🅿️', `${waiting} Flugzeug${waiting > 1 ? 'e warten' : ' wartet'} auf eine Position`, 'bad']);
    if (!small && fu.stock < FUEL.cap * 0.25) todo.push(['fuel', '⛽', `Tanklager bei ${Math.round((fu.stock / FUEL.cap) * 100)} % – Kerosin kaufen`, fu.stock < FUEL.cap * 0.12 ? 'bad' : 'warn']);
    if (s.cash < 0) todo.push(['fin', '🏦', 'Kasse im Minus – Kredit oder Kosten senken', 'bad']);
    if (cond < 55 && !projects(s).some((p) => p.kind === 'rwy')) todo.push(['runways', '🛬', `Pistenzustand ${cond} % – Wartung beauftragen`, 'warn']);
    if (!hasRwy2(s) && s.cash > 9500000 && !projects(s).some((p) => p.target === 'rwy2')) todo.push(['runways', '🛫', 'Genug Geld für die Parallelbahn', 'info']);
    if ((t.complaints || 0) > 25 && !s.settings.curfew) todo.push(['fees', '📢', `${t.complaints} Lärmbeschwerden heute`, 'warn']);
    const sw = secState(s).wait;
    if (sw > 15) todo.push(['terminal', '🚶', `Schlange an der Sicherheitskontrolle ≈ ${Math.round(sw)} min – ${s.upgrades.security < 3 ? 'weitere Spuren bauen' : 'Kapazität am Limit'}`, sw > 25 ? 'bad' : 'warn']);
    const fc = forecastInfo(s);
    if (fc.change && ['storm', 'fog', 'snow'].includes(fc.kind) && fc.at - s.time < 5400) todo.push(['over', fc.icon, `Vorhersage: ab ${fmtClock(fc.at)} ${fc.name}${fc.kind === 'fog' && !s.upgrades.ils3 && (fc.rvr || 999) < 550 ? ' unter CAT-I-Minimum' : ''}`, 'warn', fc.kind]);
    if (!todo.length) todo.push(['over', '✅', 'Alles im grünen Bereich', 'good', '', 'good']);
    setHTML(
      this.root.querySelector('#dk-todo'),
      todo
        .map(([k, i, txt, cls, extra = '', picKey = k]) => {
          const pic = todoPic(s, picKey, extra);
          return `<button class="dock-todo ${cls}${pic ? ' has-pic' : ''}" data-open="${k}">${pic ? `<span class="tp" style="background-image:url(${pic})"><em>${i}</em></span>` : `<span>${i}</span>`}<span>${esc(txt)}</span><i>›</i></button>`;
        })
        .join('')
    );
    // Baustellen
    const ps = projects(s);
    setHTML(this.root.querySelector('#dk-cnt'), String(ps.length));
    setHTML(
      this.root.querySelector('#dk-sites'),
      ps.length
        ? ps.map((p) => `<div class="dock-site has-pic" data-site="${p.id}" title="Baustelle zeigen"><span class="tp" style="background-image:url(${sitePic(p)})"></span><div class="ds-b"><div class="row"><span>🏗️ ${esc(p.name)}</span></div><small>${p.status === 'waiting' ? 'wartet' : Math.floor(p.prog * 100) + ' % · ' + fmtHours(remainingHours(p)) + ' · ' + realMinutes(s, remainingHours(p))}</small><div class="bar stripes"><i style="width:${p.prog * 100}%"></i></div></div></div>`).join('')
        : '<div class="empty">Keine Baustelle – Ausbau in der Zentrale starten.</div>'
    );
    const G = goalsState(s);
    setHTML(
      this.root.querySelector('#dk-goals'),
      `<div class="dock-rank" data-open="goals">🏅 ${rankName(s, G.rank)} · ${G.xp} XP</div>` + activeGoals(s).map((g) => `<div class="dock-goal"><small>${esc(goalText(g))}</small><div class="bar"><i style="width:${goalFraction(s, g) * 100}%;background:var(--manager)"></i></div></div>`).join('')
    );
    setHTML(this.root.querySelector('#mp-sub'), `${fmtClock(s.time)} · ${fmtMoney(s.cash)}`);
  }
}
