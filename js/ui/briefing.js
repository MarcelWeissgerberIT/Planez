// Schichtbriefing zum Tagesbeginn: Wetter und Vorhersage, geplanter Verkehr je Stunde, besondere Flüge,
// rollenspezifische Lage (Tower / Vorfeld / Management) und die Ziele der Schicht.
import { AC_TYPES, AIRLINES, CITIES } from '../config.js';
import { WEATHER, forecastInfo } from '../sim/events.js';
import { temperature, season } from '../sim/winter.js';
import { preferredRunway } from '../sim/atc.js';
import { activeGoals, goalText } from '../sim/goals.js';
import { fuelState, FUEL } from '../sim/fuel.js';
import { rivalState } from '../sim/rival.js';
import { projects, remainingHours } from '../sim/construction.js';
import { rwyCond } from '../sim/runway.js';
import { fmtClock, fmtMoney, esc, dayOf } from '../util.js';
import { ROLES } from '../state.js';

const H = 3600, D = 86400;
const TIPS = {
  tower: ['Heavys möglichst hintereinander starten lassen – das spart Wirbelschleppen-Wartezeit.', 'Hör auf die Rücklesungen: Ein falscher Readback lässt sich mit Q korrigieren.', 'In der Spitzenstunde Starts in die Lücken vor der nächsten Landung setzen – das bringt Kombo-Punkte.', 'Bei Rückenwind über 5 kt rechtzeitig die Betriebsrichtung wechseln.'],
  ground: ['Tankwagen früh losschicken – leere Wagen müssen erst zum Tanklager.', 'Der Positionsplan (G) zeigt Engpässe schon Stunden vorher.', 'Boxenstopp: Turnaround in der Mindestzeit bringt 100 Extrapunkte.', 'Schlepper rechtzeitig bereitstellen, dann klappt der Pushback auf die Minute.'],
  manager: ['Nordhafen beobachtet dich – Ansehen und Pünktlichkeit zählen am meisten für den Marktanteil.', 'Auslaufende Verträge verlängern sich eher, wenn die Airline zufrieden ist.', 'Kerosin günstig einkaufen, wenn der Preis unter dem Schnitt liegt.', 'Baustellen blockieren Positionen – Ausbau lieber vor der Hauptsaison.'],
};

function trafficOf(state, day0) {
  const arrH = new Array(24).fill(0), depH = new Array(24).fill(0);
  let heavy = 0, cargo = 0;
  const specials = [];
  for (const r of Object.values(state.rots)) {
    const inA = r.sta >= day0 && r.sta < day0 + D && r.status !== 'cancelled';
    const inD = r.std >= day0 && r.std < day0 + D && r.status !== 'cancelled';
    if (inA) arrH[Math.floor((r.sta - day0) / H)]++;
    if (inD) depH[Math.floor((r.std - day0) / H)]++;
    if (!inA && !inD) continue;
    const t = AC_TYPES[r.type];
    if (t && t.wake === 'H') heavy++;
    if (t && t.cargo) cargo++;
    if (r.type === 'A388') specials.push(`🐋 A380 ${esc(r.arrNo)} aus ${esc(CITIES[r.city]?.name || r.city)} · ${fmtClock(r.sta)}`);
    else if (r.special === 'vip') specials.push(`🕴️ VIP-Flug ${esc(r.arrNo)} · ${fmtClock(r.sta)}`);
  }
  return { arrH, depH, heavy, cargo, specials };
}

function chart(arrH, depH, nowH) {
  const tot = arrH.map((a, i) => a + depH[i]);
  const max = Math.max(1, ...tot);
  const W = 480, Hh = 80, bw = W / 24;
  let s = '';
  for (let i = 0; i < 24; i++) {
    const ha = (arrH[i] / max) * (Hh - 14), hd = (depH[i] / max) * (Hh - 14);
    s += `<rect x="${i * bw + 2}" y="${Hh - 12 - ha}" width="${bw - 4}" height="${ha}" rx="2" fill="#2dd4bf"/><rect x="${i * bw + 2}" y="${Hh - 12 - ha - hd}" width="${bw - 4}" height="${hd}" rx="2" fill="#fbbf24"/>`;
    if (i % 3 === 0) s += `<text x="${i * bw + bw / 2}" y="${Hh - 1}" text-anchor="middle" font-size="9" fill="#94a3b8">${String(i).padStart(2, '0')}</text>`;
  }
  if (nowH >= 0) s += `<line x1="${nowH * bw}" x2="${nowH * bw}" y1="0" y2="${Hh - 12}" stroke="#f8fafc" stroke-dasharray="3 3" opacity=".5"/>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">${s}</svg>`;
}

export function briefingHtml(state) {
  const role = state.role;
  const day = dayOf(state.time);
  const day0 = (day - 1) * D;
  const T = trafficOf(state, day0);
  const tot = T.arrH.map((a, i) => a + T.depH[i]);
  const peak = tot.indexOf(Math.max(...tot));
  const sum = tot.reduce((a, b) => a + b, 0);
  const w = WEATHER[state.weather.kind];
  const fc = forecastInfo(state);
  const temp = Math.round(temperature(state));
  const pref = preferredRunway(state);
  const item = (ic, txt, cls = '') => `<li class="${cls}"><i>${ic}</i><span>${txt}</span></li>`;
  // Lage je Rolle
  const L = [];
  if (role === 'tower') {
    L.push(item('🛬', `Betriebsrichtung <b>${state.rwy}</b>${pref !== state.rwy ? ` – der Wind spricht für <b>${pref}</b>, Wechsel einplanen` : ' – passt zum Wind'}`));
    if (T.heavy) L.push(item('🌀', `<b>${T.heavy}</b> Heavys heute – Wirbelschleppen-Abstände beachten`));
    if (fc.kind === 'fog' && !state.upgrades.ils3) L.push(item('🌫️', `Nebel ab ${fmtClock(fc.at)} vorhergesagt – ohne ILS CAT III drohen Ausweichlandungen`, 'warn'));
    if (fc.kind === 'storm') L.push(item('⛈️', `Gewitter ab ${fmtClock(fc.at)} – Windscherung im kurzen Endanflug möglich`, 'warn'));
    const cond = Math.round(rwyCond(state));
    if (cond < 55) L.push(item('🛠️', `Pistenzustand nur ${cond} % – Bremswirkung kann nachlassen`, 'warn'));
  } else if (role === 'ground') {
    const built = state.stands.filter((s) => s.built && !s.closed).length;
    L.push(item('🅿️', `${built} Positionen verfügbar · Spitzenstunde ${String(peak).padStart(2, '0')}:00 mit ${tot[peak]} Bewegungen`));
    const fu = fuelState(state);
    L.push(item('⛽', `Tanklager ${Math.round(fu.stock)} t von ${FUEL.cap} t${fu.stock < FUEL.cap * 0.25 ? ' – knapp, Management informieren' : ''}`, fu.stock < FUEL.cap * 0.25 ? 'warn' : ''));
    const broken = state.vehicles.filter((v) => v.brokenUntil > state.time);
    if (broken.length) L.push(item('🔧', `In der Werkstatt: ${broken.map((v) => esc(v.name)).join(', ')}`, 'warn'));
    if (temp <= 3 && ['snow', 'rain', 'fog'].includes(fc.kind)) L.push(item('🧊', `${temp} °C und ${esc(fc.name)} erwartet – Enteisung wahrscheinlich`, 'warn'));
    if (T.cargo) L.push(item('📦', `${T.cargo} Frachtfl${T.cargo > 1 ? 'üge' : 'ug'} – Frachtposition freihalten`));
  } else if (role === 'manager') {
    L.push(item('💶', `Kasse ${fmtMoney(state.cash)} · Ansehen ${Math.round(state.reputation)}/100`, state.cash < 0 ? 'warn' : ''));
    const exp = state.contracts.filter((c) => c.days <= 3);
    if (exp.length) L.push(item('✍️', `${exp.length} Vertr${exp.length > 1 ? 'äge laufen' : 'ag läuft'} in den nächsten 3 Tagen aus: ${exp.slice(0, 3).map((c) => `${esc(AIRLINES[c.airline].name)} → ${esc(CITIES[c.city]?.name || c.city)} (Zufr. ${Math.round(c.sat ?? 50)})`).join(', ')}`, 'warn'));
    if (state.offers.length) L.push(item('📨', `${state.offers.length} Vertragsangebot${state.offers.length > 1 ? 'e' : ''} warten auf Antwort`));
    const R = rivalState(state);
    L.push(item('🏢', `Marktanteil gegen Nordhafen: <b>${Math.round(R.share)} %</b>${R.feeCutUntil > state.time ? ' – Nordhafen lockt gerade mit Rabatten' : ''}`, R.share < 45 ? 'warn' : ''));
    const ps = projects(state).filter((p) => p.status !== 'waiting' && remainingHours(p) <= 24);
    if (ps.length) L.push(item('🏗️', `Heute fertig: ${ps.map((p) => esc(p.name)).join(', ')}`));
  }
  const goals = activeGoals(state).map((g) => `<li><i>🎯</i><span>${esc(goalText(g))}</span></li>`).join('');
  const tips = TIPS[role] || [];
  const tip = tips.length ? tips[day % tips.length] : '';
  const nowH = Math.floor((state.time - day0) / H);
  return `<div class="brief">
    <div class="br-top"><div class="br-kick">${ROLES[role].icon} Schichtbriefing · ${esc(ROLES[role].name)}</div><h2>Tag ${day} · ${esc(season(state).name || '')}</h2><div class="br-stamp">${esc(state.name)}</div></div>
    <div class="br-cols">
      <div class="br-wx"><div class="br-h">Wetter</div><div class="br-now"><span class="ic">${w.icon}</span><div><b>${esc(w.name)} · ${temp} °C</b><small>Wind ${String(Math.round(state.wind.dir)).padStart(3, '0')}° / ${Math.round(state.wind.spd)} kt</small></div></div>
        ${fc.change ? `<div class="br-fc">${fc.icon} ab ${fmtClock(fc.at)}: <b>${esc(fc.name)}</b>${fc.rvr ? ` · RVR ${fc.rvr} m` : ''}</div>` : '<div class="br-fc">keine Wetteränderung in Sicht</div>'}</div>
      <div class="br-traffic"><div class="br-h">Verkehr heute <span>${sum} Bewegungen · Spitze ${String(peak).padStart(2, '0')}:00</span></div>${chart(T.arrH, T.depH, nowH)}<div class="br-leg"><span><i style="background:#2dd4bf"></i>Landungen</span><span><i style="background:#fbbf24"></i>Starts</span></div></div>
    </div>
    ${T.specials.length ? `<div class="br-sp">${T.specials.slice(0, 3).map((x) => `<span>${x}</span>`).join('')}</div>` : ''}
    <div class="br-cols">
      <div><div class="br-h">Lage</div><ul class="br-list">${L.join('') || item('✅', 'Keine Besonderheiten – ruhiger Start in den Tag')}</ul></div>
      <div><div class="br-h">Ziele der Schicht</div><ul class="br-list">${goals}</ul>${tip ? `<div class="br-tip">💡 ${esc(tip)}</div>` : ''}</div>
    </div>
    <div class="modal-acts"><label class="br-off"><input type="checkbox" data-brief-off> nicht mehr anzeigen</label><button class="btn btn-primary" data-close-modal>Schicht beginnen ▶</button></div>
  </div>`;
}
