// Lokalzeitung („Velmarauer Kurier“, nach der Heimatstadt): Zeitungsseite im Tagesbericht – Schlagzeile aus dem Tagesgeschehen (Zwischenfälle, Rekorde,
// Notlandung, Superjumbo, Ausweichlandungen, Wetter, Pünktlichkeit), Vorspann mit den Zahlen des Tages,
// Kurzmeldungen aus dem Nachrichtenticker, eine Leserstimme und der Wetterausblick.
import { newsState } from '../sim/news.js';
import { forecastInfo } from '../sim/events.js';
import { fmtMoney, esc } from '../util.js';
import { AIRLINES, CITIES } from '../config.js';
import { paperName } from '../sim/city.js';
import { T, LOCALE } from '../i18n.js';

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
  if (rec.incidents >= 2) [kick, head, tone] = [T('Luftaufsicht ermittelt'), T`Turbulenter Tag: ${rec.incidents} Zwischenfälle am Flughafen`, 'bad'];
  else if ((used = has('🏆'))) [kick, head, tone] = [T('Rekord'), T`${rec.pax.toLocaleString(LOCALE)} Passagiere – so viele wie nie`, 'good'];
  else if (d('emgLanded') > 0) [kick, head, tone] = [T('Glück im Unglück'), T`Notlandung in ${name} – alle an Bord wohlauf`, 'good'];
  else if (d('stateVisit') > 0 && state.sv) [kick, head, tone] = [T('Hoher Besuch'), state.sv.arrOk && state.sv.depOk ? T`${state.sv.guest} zu Gast – Staatsbesuch in ${name} wie am Schnürchen` : T`Staatsbesuch in ${name}: ${state.sv.guest} landet mit allen Ehren`, state.sv.arrOk && state.sv.depOk ? 'good' : 'info'];
  else if (d('salutes') > 0 && state.saluteLast) [kick, head, tone] = [T('Neue Verbindung'), T`Erstflug aus ${CITIES[state.saluteLast.city] ? CITIES[state.saluteLast.city].name : T('der Ferne')}: ${AIRLINES[state.saluteLast.airline].name} landet mit Wassertaufe`, 'good'];
  else if (d('a380') > 0) [kick, head, tone] = [T('Riese zu Besuch'), T`Die Superjumbo AV-38 landet in ${name}`, 'good'];
  else if (rec.diversions > 0) [kick, head, tone] = [T('Ärger für Reisende'), rec.diversions > 1 ? T`${rec.diversions} Maschinen mussten ausweichen` : T`${rec.diversions} Maschine musste ausweichen`, 'bad'];
  else if ((used = has('⛈️') || has('🌫️') || has('🌨️'))) [kick, head, tone] = [T('Wetter'), used.icon === '⛈️' ? T('Gewitter legt das Vorfeld lahm') : used.icon === '🌫️' ? T('Nebel: Flughafen landet im Blindflug') : T('Schneechaos? Nicht hier – Räumdienst im Dauereinsatz'), 'info'];
  else if (rec.onTime >= 95 && (rec.depN || 0) > 10) [kick, head, tone] = [T('Pünktlichkeit'), T`Wie ein Uhrwerk: ${rec.onTime} % der Flüge pünktlich`, 'good'];
  else if (rec.onTime < 70 && (rec.depN || 0) > 10) [kick, head, tone] = [T('Verspätungen'), T`Geduldsprobe: nur ${rec.onTime} % pünktlich`, 'bad'];
  else [kick, head] = [T('Lokales'), T`Ein Tag am Flughafen: ${rec.mov} Flüge, ${rec.pax.toLocaleString(LOCALE)} Reisende`];
  const profit = rec.rev - rec.cost;
  const lead = T`${rec.mov} Starts und Landungen, ${rec.pax.toLocaleString(LOCALE)} Reisende, ${rec.onTime} Prozent pünktlich – ${profit >= 0 ? T`der Flughafen verdiente am Tag ${fmtMoney(profit)}` : T`der Tag endete mit einem Minus von ${fmtMoney(-profit)}`}.${rec.incidents ? (rec.incidents > 1 ? T` ${rec.incidents} Zwischenfälle beschäftigen die Aufsicht.` : T` ${rec.incidents} Zwischenfall beschäftigt die Aufsicht.`) : T(' Ohne Zwischenfälle.')}`;
  const seen = new Set();
  const shorts = items.filter((i) => i !== used && !seen.has(i.icon) && seen.add(i.icon)).slice(0, 3); // je Thema eine Meldung
  const q = N.quotes.find((x) => x.t >= dayStart - 600);
  const fc = forecastInfo(state);
  return T`<div class="paper ${tone}"><div class="pp-mast"><span>Ausgabe Tag ${rec.day + 1}</span><b>${esc(paperName(state))}</b><span>2,50 €</span></div>
    <div class="pp-grid"><div class="pp-main"><small>${esc(kick)}</small><h3>${esc(head)}</h3><p>${esc(lead)}</p></div>
    <div class="pp-side">${shorts.map((i) => `<div>${i.icon} ${esc(i.text)}</div>`).join('') || T('<div>Keine besonderen Vorkommnisse.</div>')}
    ${q ? `<div class="pp-q">„${esc(q.text)}“<i>– ${esc(q.who)}</i></div>` : ''}
    <div class="pp-wx">Wetter: ${fc.icon} ${esc(fc.name)}${fc.change ? T(' erwartet') : ''}</div></div></div></div>`;
}
