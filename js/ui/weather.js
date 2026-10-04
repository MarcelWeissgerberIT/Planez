// Wettermenü: Tipp auf die Wetteranzeige in der Kopfleiste öffnet die Wetterlage am Platz – Wind mit Böen und
// Windrose (Bahn, Gewitter- und Schauerzellen im Umkreis), Gegen-/Rücken- und Seitenwind je Betriebsrichtung,
// Seitenwindgrenzen je Flugzeugklasse, Sicht, QNH, Bahnzustand, Vorhersage und ATIS. Aktualisiert sich, solange es offen ist.
// Dazwischen „Wetter bestimmen“: Lage per Knopf, Sicht im Nebel, Wind per Schieberegler – gilt, bis „Automatisch“
// gedrückt wird (nicht in Herausforderungen).
import { WEATHER, forecastInfo, lvp, belowMinima, holdWeather, holdWind, autoWeather, weatherLocked } from '../sim/events.js';
import { gustPeak, windShort } from '../sim/gusts.js';
import { tailwind, preferredRunway } from '../sim/atc.js';
import { qnh, atisText } from '../sim/atis.js';
import { atis } from '../sim/aircraft.js';
import { season, temperature, snowBraking } from '../sim/winter.js';
import { rwyName } from '../sim/runway.js';
import { fmtClock, esc, degNorm } from '../util.js';
import { icon } from './icons.js';
import { openModal, closeModal, setHTML, modalOpen } from './dom.js';
import { T } from '../i18n.js';

const WX_ICO = { clear: 'sun', clouds: 'clouds', rain: 'rain', fog: 'fog', storm: 'storm', snow: 'snow' };
const VIS = { clear: T('über 10 km'), clouds: T('10 km, bewölkt'), rain: T('6 km, leichter Regen'), storm: T('4 km, Gewitter'), snow: T('2 km, Schnee') };
// Seitenwindgrenzen mit Böen (wie js/sim/gusts.js)
const LIMITS = [
  { name: T('Sportflugzeug'), kt: 15 },
  { name: T('Turboprop & Regionaljet'), kt: 32 },
  { name: T('Mittelstrecke'), kt: 38 },
  { name: T('Großraum'), kt: 40 },
];

// Komponenten für eine Betriebsrichtung: Gegenwind (+) bzw. Rückenwind (−), Seitenwind im Mittel und in Böen
function components(s, rwy) {
  const hdg = rwy === '27' ? 270 : 90;
  const w = s.wind, a = ((w.dir - hdg) * Math.PI) / 180;
  return { head: -tailwind(s, rwy), xw: Math.abs(w.spd * Math.sin(a)), xg: Math.abs((w.spd + (w.gk || 0)) * Math.sin(a)) };
}

// Windrose: Norden oben, Bahn 09/27 waagerecht, Windpfeil aus der Windrichtung, Zellen bis 40 NM (Luftraum: y nach Süden)
function roseSvg(s) {
  const R = 64, C = 74, k = R / 40, w = s.wind;
  const p = (deg, r) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)];
  let g = '';
  for (const r of [R, R / 2]) g += `<circle cx="${C}" cy="${C}" r="${r}" class="wr-ring"/>`;
  for (let d = 0; d < 360; d += 30) {
    const [x1, y1] = p(d, R - (d % 90 ? 4 : 8)), [x2, y2] = p(d, R);
    g += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="wr-tick"/>`;
  }
  for (const [d, l] of [[0, 'N'], [90, 'O'], [180, 'S'], [270, 'W']]) {
    const [x, y] = p(d, R + 8);
    g += `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" class="wr-l">${d === 90 ? T('O') : l}</text>`;
  }
  for (const c of s.weather.cells || []) {
    const x = C + c.x * k, y = C + c.y * k, r = Math.max(2.5, c.r * k);
    if (Math.hypot(x - C, y - C) < R + r) g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" class="${c.shower ? 'wr-shower' : 'wr-cell'}"/>`;
  }
  // Bahn: 09 im Westen (Landung Richtung Osten), 27 im Osten
  const act = s.rwy;
  g += `<rect x="${C - 30}" y="${C - 4}" width="60" height="8" rx="1.5" class="wr-rwy"/><line x1="${C - 24}" y1="${C}" x2="${C + 24}" y2="${C}" class="wr-cl"/>`;
  g += `<text x="${C - 40}" y="${C + 3.5}" class="wr-rn${act === '09' ? ' on' : ''}">09</text><text x="${C + 40}" y="${C + 3.5}" class="wr-rn${act === '27' ? ' on' : ''}">27</text>`;
  // Windpfeil: kommt aus der Windrichtung, Spitze zur Mitte; Länge nach Stärke
  if (w.spd >= 1) {
    const len = Math.min(R - 6, 16 + w.spd * 2.2);
    const [x1, y1] = p(w.dir, R - 2), [x2, y2] = p(w.dir, R - 2 - len);
    const [hx1, hy1] = p(w.dir + 8, R - 2 - len + 9), [hx2, hy2] = p(w.dir - 8, R - 2 - len + 9);
    g += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="wr-arrow"/><path d="M${x2.toFixed(1)} ${y2.toFixed(1)} L${hx1.toFixed(1)} ${hy1.toFixed(1)} L${hx2.toFixed(1)} ${hy2.toFixed(1)}Z" class="wr-head"/>`;
  }
  return `<svg class="wr" viewBox="0 0 148 148" role="img" aria-label="${T('Windrose')}">${g}</svg>`;
}

const kt = (v) => `${Math.round(v)} kt`;

// Live-Teile: oben die Lage (mit Windrose und Warnungen), unten Bahn, Grenzen, Sicht, Vorhersage, ATIS
export function weatherParts(s) {
  const wx = s.weather, w = s.wind;
  const name = WEATHER[wx.kind].name;
  const se = season(s);
  const gp = gustPeak(s);
  const fc = forecastInfo(s);
  const pref = preferredRunway(s);
  // Winddrehung: Wind treibt langsam auf seinen Zielwert zu
  const ddir = Math.abs(((degNorm((w.tDir ?? w.dir) - w.dir) + 540) % 360) - 180);
  const trend = w.tDir !== undefined && (ddir >= 20 || Math.abs((w.tSpd ?? w.spd) - w.spd) >= 4) ? T`Wind dreht langsam auf ${Math.round(w.tDir / 10) * 10}° mit etwa ${Math.round(w.tSpd)} kt` : '';
  const warn = [];
  if (s.gustFront) warn.push(T`<b>Böenfront</b> bis etwa ${fmtClock(s.gustFront.until)} – Starts warten, Anflüge können durchstarten`);
  if (s.windshear) warn.push(T`<b>Windscherung</b> im Endanflug ${esc(s.rwy)}`);
  if (lvp(s)) warn.push(belowMinima(s) ? T`<b>Nebel unter CAT-I-Minimum</b> (RVR ${wx.rvr} m) – ohne ILS CAT III weichen Anflüge aus` : T`<b>LVP aktiv</b> – Sichtflugbetrieb eingeschränkt, mehr Abstand im Anflug`);
  const br = snowBraking(s, 'N');
  if (br) warn.push(br === 2 ? T('<b>Bremswirkung schlecht</b> – Bahn mit Schnee/Eis belegt, Räumdienst nötig') : T('<b>Bremswirkung mittel</b> – Schnee auf der Bahn'));
  if (pref !== s.rwy && tailwind(s, s.rwy) > 3) warn.push(T`<b>Rückenwind</b> auf ${esc(s.rwy)} – Betriebsrichtung ${pref} wäre günstiger`);
  const cells = (wx.cells || []).filter((c) => !c.shower);
  let near = null;
  for (const c of cells) {
    const d = Math.max(0, Math.hypot(c.x, c.y) - c.r);
    if (!near || d < near.d) near = { d, brg: degNorm((Math.atan2(c.x, -c.y) * 180) / Math.PI) };
  }
  const rows = ['27', '09'].map((r) => {
    const c = components(s, r);
    return `<tr class="${r === s.rwy ? 'on' : ''}"><td><b>${esc(rwyName(s, 'N', r))}</b>${r === s.rwy ? T(' <small>in Betrieb</small>') : ''}</td><td class="${c.head < -3 ? 'bad' : ''}">${c.head >= 0 ? T`Gegenwind ${kt(c.head)}` : T`Rückenwind ${kt(-c.head)}`}</td><td>${kt(c.xw)}${c.xg - c.xw >= 2 ? T`, Böen ${Math.round(c.xg)}` : ''}</td></tr>`;
  });
  const act = components(s, s.rwy);
  const lim = LIMITS.map((l) => {
    const st = act.xg > l.kt ? 'bad' : act.xg > l.kt * 0.8 ? 'warn' : 'good';
    return `<div class="wxm-lim ${st}"><span>${l.name}</span><b>${l.kt} kt</b><i>${st === 'bad' ? T('über Limit') : st === 'warn' ? T('knapp') : T('ok')}</i></div>`;
  });
  const top = `<div class="wxm">
    <div class="wxm-top">
      <div class="wxm-now">${icon(WX_ICO[wx.kind] || 'sun', 'wxm-ico')}<div><b>${name}</b><span>${temperature(s).toFixed(0)} °C · ${se.icon} ${se.name}</span><small>${wx.hold ? T('von Hand festgelegt') : T`Lage bis etwa ${fmtClock(wx.until)}`}</small></div></div>
      <div class="wxm-wind">${roseSvg(s)}<div><b>${windShort(s)}</b><span>${T`Wind aus ${Math.round(w.dir / 10) * 10}°, ${Math.round(w.spd)} kt`}${gp ? T`, Böen bis ${gp} kt` : ''}</span>${trend ? `<small>${trend}</small>` : ''}${cells.length ? `<small class="wxm-cells">${T`⛈ ${cells.length} Gewitterzelle(n)`}${near ? (near.d < 1 ? T(' – über dem Platz') : T` – nächste ${near.d.toFixed(0)} NM in ${Math.round(near.brg / 10) * 10}°`) : ''}</small>` : ''}</div></div>
    </div>
    ${warn.length ? `<div class="wxm-warn">${warn.map((x) => `<div>⚠ ${x}</div>`).join('')}</div>` : ''}
  </div>`;
  const rest = `<div class="wxm">
    <h3>${T('Wind auf der Bahn')}</h3>
    <table class="wxm-tab"><tr><th>${T('Richtung')}</th><th>${T('Längs')}</th><th>${T('Seitenwind')}</th></tr>${rows.join('')}</table>
    <h3>${T`Seitenwindgrenzen mit Böen · ${esc(s.rwy)}`}</h3>
    <div class="wxm-lims">${lim.join('')}</div>
    <h3>${T('Sicht, Luftdruck, Vorhersage')}</h3>
    <div class="wxm-grid">
      <div><span>${T('Sicht')}</span><b>${wx.kind === 'fog' ? T`RVR ${wx.rvr ?? 600} m` : VIS[wx.kind] || '—'}</b></div>
      <div><span>QNH</span><b>${qnh(s)} hPa</b></div>
      <div class="wide"><span>${T('Vorhersage')}</span><b>${wx.hold ? T('keine – Wetter von Hand festgelegt') : fc.change ? T`ab ${fmtClock(fc.at)} ${fc.icon} ${fc.name}${fc.rvr ? ` (RVR ${fc.rvr} m)` : ''} bis etwa ${fmtClock(fc.until)}` : T`${name} hält an`}</b></div>
    </div>
    <h3>ATIS ${atis(s)}</h3>
    <p class="wxm-atis">${esc(atisText(s))}</p>
  </div>`;
  return { top, rest };
}

// Kopfzeile: automatisch oder von Hand, dann mit Knopf zurück zum Wetterdienst
function headHtml(s) {
  const manual = s.weather.hold || s.wind.hold;
  return `<div class="wxc-h"><b>${T('Wetter bestimmen')}</b><span class="wxc-mode${manual ? ' man' : ''}">${manual ? T('von Hand') : T('automatisch')}</span>${manual ? `<button class="mini" data-wauto>${T('Automatisch')}</button>` : ''}</div>`;
}
// Wetter bestimmen: Lage, Sicht im Nebel, Windrichtung und -stärke
function controlsHtml(s) {
  const wx = s.weather, w = s.wind;
  if (weatherLocked(s)) return `<div class="wxc locked">${T('🔒 In Herausforderungen gehört das Wetter zum Drehbuch – hier lässt es sich nicht ändern.')}</div>`;
  const kinds = Object.keys(WEATHER).map((k) => `<button class="wxc-k${wx.hold && wx.kind === k ? ' on' : ''}" data-wk="${k}">${icon(WX_ICO[k])}<span>${WEATHER[k].name}</span></button>`).join('');
  const rvr = wx.hold && wx.kind === 'fog' ? `<div class="wxc-rvr"><span>${T('Sicht im Nebel')}</span>${[300, 600, 1000].map((v) => `<button class="mini${wx.rvr === v ? ' on' : ''}" data-wrvr="${v}">RVR ${v} m</button>`).join('')}</div>` : '';
  const dir = (Math.round(w.dir / 10) * 10) % 360, spd = Math.round(w.spd);
  return `<div class="wxc">
    ${headHtml(s)}
    <div class="wxc-kinds">${kinds}</div>${rvr}
    <label class="wxc-row"><span>${T('Wind aus')}</span><input type="range" min="0" max="350" step="10" value="${dir}" data-wdir aria-label="${T('Windrichtung')}" /><b data-wdirv>${String(dir).padStart(3, '0')}°</b></label>
    <label class="wxc-row"><span>${T('Stärke')}</span><input type="range" min="0" max="40" step="1" value="${spd}" data-wspd aria-label="${T('Windstärke')}" /><b data-wspdv>${spd} kt</b></label>
    <small>${T('Gilt, bis du „Automatisch“ drückst. Böen, Gewitterzellen und Böenfronten ergeben sich aus Wetter und Wind.')}</small>
  </div>`;
}

let timer = 0;
export function showWeather(game) {
  const s = game.state;
  if (!s) return;
  clearInterval(timer);
  const parts = weatherParts(s);
  const live = () => {
    const st = game.state, p = weatherParts(st);
    setHTML(document.getElementById('wxm-top'), p.top);
    setHTML(document.getElementById('wxm-rest'), p.rest);
  };
  openModal(`<h2>${T('Wetter am Platz')}</h2><div id="wxm-top">${parts.top}</div><div id="wxm-ctl">${controlsHtml(s)}</div><div id="wxm-rest">${parts.rest}</div><div class="modal-acts"><button class="btn" data-x>${T('Schließen')}</button></div>`, (box) => {
    box.querySelector('[data-x]').addEventListener('click', closeModal);
    const ctl = box.querySelector('#wxm-ctl');
    const redo = () => {
      ctl.innerHTML = controlsHtml(game.state);
      live();
    };
    ctl.addEventListener('click', (e) => {
      const st = game.state;
      const k = e.target.closest('[data-wk]'), r = e.target.closest('[data-wrvr]');
      if (k) holdWeather(st, k.dataset.wk);
      else if (r) holdWeather(st, 'fog', Number(r.dataset.wrvr));
      else if (e.target.closest('[data-wauto]')) autoWeather(st);
      else return;
      redo();
    });
    // Schieberegler: Wind sofort setzen, Anzeige mitziehen (der Regler selbst wird dabei nicht neu gezeichnet)
    ctl.addEventListener('input', (e) => {
      if (!e.target.matches('[data-wdir], [data-wspd]')) return;
      const dir = Number(ctl.querySelector('[data-wdir]').value), spd = Number(ctl.querySelector('[data-wspd]').value);
      holdWind(game.state, dir, spd);
      ctl.querySelector('[data-wdirv]').textContent = `${String(dir).padStart(3, '0')}°`;
      ctl.querySelector('[data-wspdv]').textContent = `${spd} kt`;
      ctl.querySelector('.wxc-h').outerHTML = headHtml(game.state);
      live();
    });
  });
  // offen halten und live nachführen, bis ein anderes Fenster den Inhalt ersetzt oder es geschlossen wird
  timer = setInterval(() => {
    if (!document.getElementById('wxm-top') || !modalOpen() || !game.state) return clearInterval(timer);
    live();
  }, 1000);
}
