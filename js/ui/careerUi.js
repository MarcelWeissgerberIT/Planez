// Aufbau-Modus in der Oberfläche: Bildkarten in der rechten Leiste (Leitstand) und die Seite „Aufbau“ in der
// Management-Zentrale – aktuelle Ausbaustufe als großes, langsam bewegtes Luftbild, die nächste Stufe mit Bedingungen
// und Bau-Knopf, Marketing-Aktionen (Fest, Anzeige, Fly-In) und Partner als Bildkacheln.
import { STAGES, STAGE_UP, MAX_STAGE, stageOf, stageUpStatus, ACTIONS, actionCost, actionReady, runAction, startStageUp, PARTNERS, partnerContracts, partnerOf, careerState, rotCap, airlineRotations } from '../sim/career.js';
import { AIRLINES } from '../config.js';
import { fmtMoney, esc, fmtClock, dayOf } from '../util.js';
import { remainingHours } from '../sim/construction.js';
import { fmtHours, realMinutes } from './projects.js';

export const stagePic = (i) => `assets/career/stage${Math.min(i, MAX_STAGE)}.webp`;
const ACT_PIC = { fest: 'assets/career/fest.webp', ad: 'assets/career/ad.webp', flyin: 'assets/career/flyin.webp' };
const PARTNER_PIC = { school: 'assets/career/school.webp', scenic: 'assets/career/scenic.webp', skydive: 'assets/career/skydive.webp', taxi: 'assets/career/taxi.webp' };
export const partnerPic = (k) => PARTNER_PIC[k] || '';

const fmtShort = (v) => fmtMoney(v).replace(' €', ' €');

function reqList(S) {
  return `<ul class="cr-reqs">${S.reqs.map((r) => `<li class="${r.ok ? 'ok' : ''}"><i>${r.ok ? '✓' : '○'}</i><span>${esc(r.label)}</span><b>${esc(r.have)}</b></li>`).join('')}<li class="${S.cash ? 'ok' : ''}"><i>${S.cash ? '✓' : '○'}</i><span>Eigenanteil in der Kasse</span><b>${fmtShort(S.def.own)}</b></li></ul>`;
}

function stageBtn(s, S) {
  if (S.building) return `<div class="cr-build"><div class="bar"><i style="width:${S.building.prog * 100}%"></i></div><small>🏗️ Ausbau läuft · ${Math.floor(S.building.prog * 100)} % · noch ${fmtHours(remainingHours(S.building))} (${realMinutes(s, remainingHours(S.building))})</small></div>`;
  return `<button class="btn btn-good cr-go" data-cstage ${S.ready ? '' : 'disabled'}>${S.ready ? `Ausbau starten · ${fmtShort(S.def.own)}` : 'Bedingungen noch offen'}</button>`;
}

function actionTiles(s, compact = false) {
  const st = stageOf(s);
  return Object.keys(ACTIONS)
    .filter((k) => ACTIONS[k].maxStage === undefined || st <= ACTIONS[k].maxStage)
    .map((k) => {
      const a = ACTIONS[k];
      const r = actionReady(s, k);
      const C = careerState(s);
      const live = k === 'fest' && C.fest && s.time < C.fest.until && s.time >= C.fest.from - 86400;
      // in der schmalen Leiste kurze Namen und Wartezeit als „⟳ 6 T“
      const name = compact ? { fest: 'Fest', ad: st <= 1 ? 'Anzeige' : 'Kampagne', flyin: 'Fly-In' }[k] || a.name(st) : a.name(st);
      const why = compact && r.why ? r.why.replace(/^wieder in (\d+) Tag(en)?$/, '⟳ $1 T').replace('zu wenig Geld', 'Geld fehlt') : r.why;
      return `<button class="cr-act${r.ok ? '' : ' off'}" data-cact="${k}" ${r.ok ? '' : 'disabled'} title="${esc(a.name(st))} – ${esc(a.desc)}" style="background-image:url(${ACT_PIC[k]})">
        <span class="cr-act-t"><b>${a.icon} ${esc(name)}</b><small>${r.ok ? fmtShort(actionCost(s, k)) : esc(why)}</small></span>${live ? '<span class="cr-live">● ' + (s.time >= C.fest.from ? 'läuft' : 'geplant') + '</span>' : ''}${compact ? '' : `<span class="cr-act-d">${esc(a.desc)}</span>`}</button>`;
    })
    .join('');
}

// ---------- rechte Leiste (Leitstand) ----------
export function careerDockHtml(s) {
  const st = stageOf(s);
  const S = stageUpStatus(s);
  const C = careerState(s);
  let h = '';
  if (S) {
    h += `<div class="cr-next" data-open="career"><div class="cr-next-pic" style="background-image:url(${stagePic(S.to)})"><span>Nächste Stufe</span><b>${STAGES[S.to].icon} ${esc(STAGES[S.to].name)}</b></div>${reqList(S)}${stageBtn(s, S)}</div>`;
  } else h += `<div class="cr-next done" data-open="career"><div class="cr-next-pic" style="background-image:url(${stagePic(MAX_STAGE)})"><span>Ziel erreicht</span><b>🌐 Drehkreuz</b></div></div>`;
  h += `<div class="p-sec"><span>Aktionen</span><span class="cnt">Bekanntheit ${Math.round(C.fame)}</span></div><div class="cr-acts">${actionTiles(s, true)}</div>`;
  const ps = partnerContracts(s);
  if (ps.length || st <= 1) {
    h += `<div class="p-sec"><span>Partner</span><span class="cnt">${ps.length}</span></div><div class="cr-partners">${
      ps.map((c) => {
        const P = PARTNERS[partnerOf(c)];
        return `<div class="cr-partner" style="background-image:url(${partnerPic(partnerOf(c))})" title="${esc(P.desc)}"><b>${P.icon} ${esc(P.name)}</b><small>${c.perDay}× tägl. · ${c.days} T</small></div>`;
      }).join('') || '<div class="empty">Noch keine Partner – Anfragen kommen, sobald der Platz bekannter wird.</div>'
    }</div>`;
  }
  return h;
}

// Kopfbild der Leiste: aktuelle Stufe, langsam bewegt (Ken Burns); wird nur bei Stufenwechsel neu gesetzt
export function careerHeroHtml(s) {
  const st = stageOf(s);
  return `<div class="cr-hero" data-open="career"><div class="cr-hero-img kb${st % 2}" style="background-image:url(${stagePic(st)})"></div><div class="cr-hero-shade"></div><div class="cr-hero-t"><small>Ausbaustufe ${st + 1} von ${MAX_STAGE + 1}</small><b>${STAGES[st].icon} ${esc(STAGES[st].name)}</b></div></div>`;
}

// ---------- Management-Zentrale › Aufbau ----------
export function careerPageHtml(s) {
  const st = stageOf(s);
  const S = stageUpStatus(s);
  const C = careerState(s);
  // Zeitleiste der Stufen
  let h = `<div class="cr-line">${STAGES.map((g, i) => `<div class="cr-step ${i < st ? 'done' : i === st ? 'now' : ''}" style="background-image:url(${stagePic(i)})"><span>${i + 1}</span><b>${g.icon} ${esc(g.name)}</b></div>`).join('')}</div>`;
  // aktuelle Stufe
  const cap = rotCap(s);
  const last = (s.history || []).slice(-1)[0];
  h += `<div class="cr-now"><div class="cr-now-pic kb0" style="background-image:url(${stagePic(st)})"></div><div class="cr-now-b"><small>Jetzt</small><h3>${STAGES[st].icon} ${esc(STAGES[st].name)}</h3><p>${esc(STAGES[st].desc)}</p>
    <div class="kpis"><div class="k"><span>Bekanntheit</span><b>${Math.round(C.fame)}/100</b></div><div class="k"><span>Bewegungen gestern</span><b>${last ? last.mov : '—'}</b></div><div class="k"><span>Partner</span><b>${partnerContracts(s).length}</b></div>${cap > 0 && cap < Infinity ? `<div class="k"><span>Linienflüge/Tag</span><b>${airlineRotations(s)} / ${cap}</b></div>` : ''}</div></div></div>`;
  // nächste Stufe
  if (S) {
    const D = S.def;
    h += `<div class="p-sec"><span>Nächste Ausbaustufe</span></div><div class="cr-up"><div class="cr-up-pic" style="background-image:url(${stagePic(S.to)})"><b>${STAGES[S.to].icon} ${esc(STAGES[S.to].name)}</b></div><div class="cr-up-b">
      <p>${esc(D.what)}.</p>
      <div class="cr-money"><span>Gesamtkosten <b>${fmtShort(D.total)}</b></span><span>Land, Kreis &amp; Investoren <b>${fmtShort(D.total - D.own)}</b></span><span>Dein Eigenanteil <b>${fmtShort(D.own)}</b></span><span>Bauzeit <b>${D.hours} h</b></span></div>
      <p class="cr-hint">Die Förderung gibt es nur, wenn alle Bedingungen erfüllt sind – der Platz muss zeigen, dass er den Ausbau braucht.</p>
      ${reqList(S)}${stageBtn(s, S)}</div></div>`;
  } else h += `<div class="empty">🌐 Höchste Ausbaustufe erreicht – ${esc(s.name)} ist ein Drehkreuz. Weiter ausbauen kannst du in Terminal, Parkpositionen und Pisten.</div>`;
  // Aktionen
  h += `<div class="p-sec"><span>Marketing &amp; Aktionen</span><span class="cnt">mehr Gäste, Partner und Ansehen</span></div><div class="cr-acts big">${actionTiles(s)}</div>`;
  // Partner
  const ps = partnerContracts(s);
  const open = s.offers.filter((o) => o.partner);
  h += `<div class="p-sec"><span>Partner am Platz</span><span class="cnt">${ps.length}</span></div><div class="cr-partners big">`;
  for (const [k, P] of Object.entries(PARTNERS)) {
    if (P.stage > Math.max(st, 1)) continue;
    const c = ps.find((x) => partnerOf(x) === k);
    const o = open.find((x) => x.partner === k);
    const al = AIRLINES[P.al];
    const status = c ? `✓ Partner · ${c.perDay} Flüge täglich · noch ${c.days} Tage` : o ? '📨 Anfrage liegt vor – unter Airlines &amp; Verträge annehmen' : C.fame >= P.fame && P.stage <= st ? 'Anfrage kommt bald' : `ab Bekanntheit ${P.fame}${P.stage > st ? ' und ' + STAGES[P.stage].name : ''}`;
    h += `<div class="cr-partner${c ? ' on' : ''}" style="background-image:url(${partnerPic(k)})"><b>${P.icon} ${esc(al.name)}</b><small>${status}</small><span class="cr-p-d">${esc(P.desc)} Pacht ${P.rent} €/Tag + ${P.perFlight} € je Flug.</span></div>`;
  }
  h += '</div>';
  return h;
}

// Klicks aus Leiste und Zentrale
export function careerClick(game, e) {
  const s = game.state;
  const a = e.target.closest('[data-cact]');
  if (a && !a.disabled) {
    runAction(s, a.dataset.cact);
    return true;
  }
  const g = e.target.closest('[data-cstage]');
  if (g && !g.disabled) {
    startStageUp(s);
    return true;
  }
  return false;
}
