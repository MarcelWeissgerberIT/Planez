// „Planezer Kurier“: Zeitungsseite im Tagesbericht – Schlagzeile aus dem Tagesgeschehen (Zwischenfälle, Rekorde,
// Notlandung, Superjumbo, Ausweichlandungen, Wetter, Pünktlichkeit), Vorspann mit den Zahlen des Tages,
// Kurzmeldungen aus dem Nachrichtenticker, eine Leserstimme und der Wetterausblick.
import { newsState } from '../sim/news.js';
import { forecastInfo } from '../sim/events.js';
import { fmtMoney, esc } from '../util.js';

const DAY = 86400;

export function newspaperHtml(state, rec) {
  const N = newsState(state);
  const dayStart = (rec.day - 1) * DAY;
  const items = N.items.filter((i) => i.t >= dayStart - 600);
  const L = state.life || {};
  const P = state.paperLife || {};
  const d = (k) => (L[k] || 0) - (P[k] || 0);
  state.paperLife = { ...L };
  const has = (icon) => items.find((i) => i.icon === icon);
  const name = state.name;
  let head, kick, tone = 'info', used = null;
  if (rec.incidents >= 2) [kick, head, tone] = ['Luftaufsicht ermittelt', `Turbulenter Tag: ${rec.incidents} Zwischenfälle am Flughafen`, 'bad'];
  else if ((used = has('🏆'))) [kick, head, tone] = ['Rekord', `${rec.pax.toLocaleString('de-DE')} Passagiere – so viele wie nie`, 'good'];
  else if (d('emgLanded') > 0) [kick, head, tone] = ['Glück im Unglück', 'Notlandung in ' + name + ' – alle an Bord wohlauf', 'good'];
  else if (d('a380') > 0) [kick, head, tone] = ['Riese zu Besuch', `Der Superjumbo A380 landet in ${name}`, 'good'];
  else if (rec.diversions > 0) [kick, head, tone] = ['Ärger für Reisende', `${rec.diversions} Maschine${rec.diversions > 1 ? 'n mussten' : ' musste'} ausweichen`, 'bad'];
  else if ((used = has('⛈️') || has('🌫️') || has('🌨️'))) [kick, head, tone] = ['Wetter', used.icon === '⛈️' ? 'Gewitter legt das Vorfeld lahm' : used.icon === '🌫️' ? 'Nebel: Flughafen landet im Blindflug' : 'Schneechaos? Nicht hier – Räumdienst im Dauereinsatz', 'info'];
  else if (rec.onTime >= 95 && (rec.depN || 0) > 10) [kick, head, tone] = ['Pünktlichkeit', `Wie ein Uhrwerk: ${rec.onTime} % der Flüge pünktlich`, 'good'];
  else if (rec.onTime < 70 && (rec.depN || 0) > 10) [kick, head, tone] = ['Verspätungen', `Geduldsprobe: nur ${rec.onTime} % pünktlich`, 'bad'];
  else [kick, head] = ['Lokales', `Ein Tag am Flughafen: ${rec.mov} Flüge, ${rec.pax.toLocaleString('de-DE')} Reisende`];
  const profit = rec.rev - rec.cost;
  const lead = `${rec.mov} Starts und Landungen, ${rec.pax.toLocaleString('de-DE')} Reisende, ${rec.onTime} Prozent pünktlich – ${profit >= 0 ? `der Flughafen verdiente am Tag ${fmtMoney(profit)}` : `der Tag endete mit einem Minus von ${fmtMoney(-profit)}`}.${rec.incidents ? ` ${rec.incidents} Zwischenf${rec.incidents > 1 ? 'älle beschäftigen' : 'all beschäftigt'} die Aufsicht.` : ' Ohne Zwischenfälle.'}`;
  const seen = new Set();
  const shorts = items.filter((i) => i !== used && !seen.has(i.icon) && seen.add(i.icon)).slice(0, 3); // je Thema eine Meldung
  const q = N.quotes.find((x) => x.t >= dayStart - 600);
  const fc = forecastInfo(state);
  return `<div class="paper ${tone}"><div class="pp-mast"><span>Ausgabe Tag ${rec.day + 1}</span><b>Planezer Kurier</b><span>2,50 €</span></div>
    <div class="pp-grid"><div class="pp-main"><small>${esc(kick)}</small><h3>${esc(head)}</h3><p>${esc(lead)}</p></div>
    <div class="pp-side">${shorts.map((i) => `<div>${i.icon} ${esc(i.text)}</div>`).join('') || '<div>Keine besonderen Vorkommnisse.</div>'}
    ${q ? `<div class="pp-q">„${esc(q.text)}“<i>– ${esc(q.who)}</i></div>` : ''}
    <div class="pp-wx">Wetter: ${fc.icon} ${esc(fc.name)}${fc.change ? ' erwartet' : ''}</div></div></div></div>`;
}
