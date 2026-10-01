// Kino-Modus: automatische Kamerafahrten zu Landungen, Starts, Abfertigung, Baustellen und Landseite.
// Oberfläche ausgeblendet, Letterbox-Balken und Bildunterschrift. Taste K oder Esc beendet.
import { AC_TYPES, AIRLINES, CITIES, AIRPORT } from '../config.js';
import { PH } from '../sim/aircraft.js';
import { clamp, hourOf, esc } from '../util.js';
import * as LY from '../layout.js';
import { listeners } from '../sim/messages.js';
import { fmtClock, dayOf } from '../util.js';
import { WEATHER } from '../sim/events.js';
import { temperature } from '../sim/winter.js';
import { voice } from '../voice.js';
import { SPECIALS } from '../sim/spotter.js';
import { secState } from '../sim/security.js';
import { fuelState } from '../sim/fuel.js';

// Rundgang: Gebäude und Anlagen mit Live-Zahlen im Kommentar
function tourSpots(s) {
  const B = Object.fromEntries(LY.BUILDINGS.map((b) => [b.id, b]));
  const at = (b, z) => ({ x: b.fx - b.w / 2, y: b.fy - b.d / 2, z });
  const t = s.stats.today;
  const list = [
    { id: 'tour:tower', ...at(B.tower, 2.3), k: 'TOWER', title: 'Kontrollturm', sub: `Betriebsrichtung ${s.rwy}${t.mov ? ` · ${t.mov} Bewegungen heute` : ''}`, lines: ['Der Tower: Von hier oben behalten die Lotsen jede Landung und jeden Start im Blick.', t.mov > 5 ? `Im Kontrollturm laufen die Fäden zusammen – ${t.mov} Bewegungen bisher heute.` : 'Im Kontrollturm beginnt die Schicht – gleich kommt die erste Welle.'] },
    { id: 'tour:fire', ...at(B.fire, 2), k: 'FEUERWACHE', title: 'Flughafenfeuerwehr', sub: 'Drei Großlöschfahrzeuge, rund um die Uhr besetzt', lines: ['Die Flughafenfeuerwehr: In unter drei Minuten muss sie jeden Punkt der Bahn erreichen.', 'Drei Großlöschfahrzeuge stehen bereit – hoffentlich bleibt es heute ruhig.'] },
    { id: 'tour:hall', ...at(B.hall, 1.05), k: 'TERMINAL', title: 'Terminal', sub: t.pax ? `${t.pax.toLocaleString('de-DE')} Reisende heute · Kontrolle ${Math.round(secState(s).wait)} min` : 'Check-in, Sicherheitskontrolle, Gates', lines: [t.pax > 200 ? `Das Terminal: ${t.pax.toLocaleString('de-DE')} Reisende sind heute schon durch diese Türen gegangen.` : 'Das Terminal – hier beginnt und endet jede Reise.', secState(s).wait >= 3 ? `An der Sicherheitskontrolle warten die Reisenden gerade etwa ${Math.round(secState(s).wait)} Minuten.` : 'An der Sicherheitskontrolle geht es gerade zügig voran.'] },
    { id: 'tour:cargo', ...at(B.cargo, 1.4), k: 'FRACHT', title: 'Frachtterminal', sub: 'Umschlag von Luftfracht', lines: ['Im Frachtterminal wird umgeschlagen – von Ersatzteilen bis zu frischem Fisch.', 'Fracht fliegt oft nachts – hier wird schon für die nächste Maschine sortiert.'] },
    { id: 'tour:hangar', ...at(B.hangar, 1.5), k: 'WARTUNG', title: 'Wartungshangar', sub: 'Technik und Instandhaltung', lines: ['Im Wartungshangar werden Flugzeuge gecheckt – Schraube für Schraube.', 'Ohne die Technik im Hangar hebt hier nichts ab.'] },
    { id: 'tour:fuel', ...at(B.fuel, 2), k: 'TANKLAGER', title: 'Tanklager', sub: `${Math.round(fuelState(s).stock)} t Kerosin auf Lager`, lines: [`Das Tanklager: ${Math.round(fuelState(s).stock)} Tonnen Kerosin warten auf ihren Einsatz.`, 'Von hier rollen die Tankwagen zu jeder Maschine auf dem Vorfeld.'] },
    { id: 'tour:parking', ...at(B.parking, 1.7), k: 'LANDSEITE', title: 'Parkhaus', sub: 'Parken direkt am Terminal', lines: ['Das Parkhaus – für viele Reisende der erste Eindruck vom Flughafen.', 'Wer früh kommt, parkt nah am Terminal.'] },
    { id: 'tour:radar', ...at(B.radar, 2.4), k: 'RADAR', title: 'Radaranlage', sub: 'Rundsichtradar für Anflug und Abflug', lines: ['Die Radarantenne dreht sich unermüdlich – jede Umdrehung ein neues Lagebild für die Lotsen.'] },
  ];
  if (s.upgrades.hotel) list.push({ id: 'tour:hotel', ...at(B.hotel, 1.9), k: 'HOTEL', title: 'Flughafenhotel', sub: 'Übernachten mit Blick aufs Vorfeld', lines: ['Das Flughafenhotel – für Crews, Umsteiger und alle, die früh fliegen.'] });
  if (s.upgrades.solar) list.push({ id: 'tour:solar', x: (LY.SOLAR.x0 + LY.SOLAR.x1) / 2, y: (LY.SOLAR.y0 + LY.SOLAR.y1) / 2, z: 1.3, k: 'ENERGIE', title: 'Solarpark', sub: s.weather.kind === 'clear' ? 'volle Sonne, volle Leistung' : 'Strom vom eigenen Dach', lines: ['Der Solarpark liefert Strom für Terminal und Vorfeld – und senkt die Kosten.'] });
  if (s.upgrades.rail) list.push({ id: 'tour:rail', x: (LY.RAIL.station.x0 + LY.RAIL.station.x1) / 2, y: (LY.RAIL.station.y0 + LY.RAIL.station.y1) / 2, z: 1.7, k: 'BAHNHOF', title: 'Flughafenbahnhof', sub: 'Mit dem Zug zum Flug', lines: ['Der Flughafenbahnhof: Mit dem Zug in die Stadt – weniger Autos, mehr Reisende.'] });
  return list;
}

// Phasen eines ankommenden Flugs (ac.arr bleibt über den ganzen Umlauf gesetzt)
const ARR_PH = new Set([PH.INBOUND, PH.HOLD, PH.APPROACH, PH.GOAROUND, PH.FINAL, PH.ROLLOUT, PH.VACATED, PH.TAXI_WAIT, PH.TAXI_IN]);
const PHASE_SHOT = {
  [PH.FINAL]: 'land',
  [PH.ROLLOUT]: 'land',
  [PH.TAKEOFF]: 'dep',
  [PH.LINED]: 'dep',
  [PH.LINEUP]: 'dep',
  [PH.MISSED]: 'goaround',
  [PH.PUSH]: 'push',
  [PH.TAXI_IN]: 'taxi',
  [PH.TAXI_OUT]: 'taxi',
};

export class Cinema {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.shot = null;
    this.t = 0;
    const el = document.createElement('div');
    el.id = 'cinema';
    el.className = 'hidden';
    el.innerHTML = `<div class="cn-bar top"></div><div class="cn-bar bot"></div>
      <div class="cn-cap"><div class="cn-k"></div><div class="cn-t"></div><div class="cn-s"></div><div class="cn-n"></div></div>
      <div class="cn-brand">${esc(AIRPORT.name || 'Planez')} · LIVE</div>
      <div class="cn-help">K / Esc beenden · ← → nächste Szene</div>
      <div class="cn-clock"></div><div class="cn-data"></div><div class="cn-sub"></div>`;
    document.getElementById('game').appendChild(el);
    this.el = el;
    this.cap = { k: el.querySelector('.cn-k'), t: el.querySelector('.cn-t'), s: el.querySelector('.cn-s'), n: el.querySelector('.cn-n') };
    el.addEventListener('click', () => this.next(true));
    this.clockEl = el.querySelector('.cn-clock');
    this.dataEl = el.querySelector('.cn-data');
    this.subEl = el.querySelector('.cn-sub');
    // Funkverkehr als Untertitel
    listeners.radio.push((m) => {
      if (!this.on || (m.kind !== 'atc' && m.kind !== 'pilot')) return;
      this.subEl.innerHTML = `<b>${esc(m.from || '')}</b> ${esc(m.text)}`;
      this.subEl.classList.remove('in');
      void this.subEl.offsetWidth;
      this.subEl.classList.add('in');
    });
  }

  toggle() {
    this.on ? this.stop() : this.start();
  }

  start() {
    const s = this.game.state;
    if (!s) return;
    this.on = true;
    this.prevSpeed = s.speed;
    this.prevZoom = this.game.cam.zoom;
    if (s.speed === 0 || s.speed > 2) s.speed = s.role === 'observer' ? 2 : Math.min(s.speed || 1, 2);
    this.prevLabels = this.game.ui.labels;
    this.game.ui.labels = false;
    document.getElementById('game').classList.add('cinema');
    this.el.classList.remove('hidden');
    this.shot = null;
    this.next(true);
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    const s = this.game.state;
    if (s && this.prevSpeed !== undefined) s.speed = this.prevSpeed;
    this.game.ui.labels = this.prevLabels !== false;
    document.getElementById('game').classList.remove('cinema');
    this.el.classList.add('hidden');
    this.game.cam.tx = null;
    this.shot = null;
  }

  // Szenen-Kandidaten mit Gewicht
  candidates(s) {
    const out = [];
    const recent = this.recent || [];
    for (const ac of s.acs) {
      if (ac.mode !== 'map') continue;
      const kind = PHASE_SHOT[ac.phase];
      if (!kind) continue;
      if (ac.phase === PH.FINAL && ac.z > 3.5) continue;
      let w = { land: 6, dep: 6, goaround: 9, push: 3, taxi: 1.5 }[kind];
      if (ac.emergency) w += 8;
      if (AC_TYPES[ac.type].size === 'L') w *= 1.6;
      if (ac.type === 'A388') w *= 3;
      if (ac.protocol) w *= 3;
      if (recent.includes(ac.id)) w *= 0.15;
      out.push({ kind, id: ac.id, w });
    }
    const turns = s.acs.filter((a) => a.phase === PH.STAND && a.ta);
    if (turns.length) {
      const a = turns[Math.floor(Math.random() * turns.length)];
      out.push({ kind: 'turn', id: a.id, w: recent.includes(a.id) ? 0.4 : 2.2 });
    }
    for (const p of s.projects || []) out.push({ kind: 'site', id: p.id, w: recent.includes(p.id) ? 0.3 : 1.6 });
    out.push({ kind: 'land-side', id: 'curb', w: recent.includes('curb') ? 0.2 : 1 });
    for (const sp of tourSpots(s)) out.push({ kind: 'tour', id: sp.id, w: recent.includes(sp.id) ? 0.05 : 0.32 });
    out.push({ kind: 'wide', id: 'wide', w: recent.includes('wide') ? 0.2 : 1.2 });
    if (hourOf(s.time) > 20 || hourOf(s.time) < 5.5) out.push({ kind: 'night', id: 'night', w: recent.includes('night') ? 0.2 : 1.4 });
    return out;
  }

  next(force = false) {
    const s = this.game.state;
    if (!s) return;
    const c = this.candidates(s);
    let tot = c.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * tot;
    let pick = c[0];
    for (const x of c) {
      r -= x.w;
      if (r <= 0) {
        pick = x;
        break;
      }
    }
    this.recent = [pick.id, ...(this.recent || [])].slice(0, 4);
    this.shot = { ...pick, t: 0, dur: { land: 16, dep: 14, goaround: 16, push: 12, taxi: 10, turn: 12, site: 10, 'land-side': 10, wide: 12, night: 12, tour: 11 }[pick.kind] || 12, drift: Math.random() * Math.PI * 2 };
    const cam = this.game.cam;
    if (force || pick.kind === 'wide') cam.tx = null;
    this.caption(s);
  }

  caption(s) {
    const sh = this.shot;
    const set = (k, t, sub) => {
      this.cap.k.textContent = k;
      this.cap.t.textContent = t;
      this.cap.s.textContent = sub;
      // Kommentar zur Szene (eingeblendet, mit Echter Funk auch gesprochen)
      const line = commentary(s, sh, ac);
      this.cap.n.textContent = line || '';
      if (line && s.settings.tts && voice.on) voice.narrate(line);
      this.el.querySelector('.cn-cap').classList.remove('in');
      void this.el.offsetWidth;
      this.el.querySelector('.cn-cap').classList.add('in');
    };
    const ac = sh.id && s.acs.find((a) => a.id === sh.id);
    const acText = (a) => {
      const al = AIRLINES[a.airline];
      const rot = s.rots[a.rot];
      const city = rot ? CITIES[rot.city]?.name : '';
      return { t: `${al ? al.name : ''} ${a.cs.replace(/^[A-Z]+/, '')}`, sub: `${AC_TYPES[a.type].name}${city ? (ARR_PH.has(a.phase) ? ` · aus ${city}` : ` · nach ${city}`) : ''}` };
    };
    if (ac) {
      const x = acText(ac);
      const K = { land: ac.emergency ? 'NOTLANDUNG' : 'LANDUNG', dep: 'START', goaround: 'DURCHSTARTEN', push: 'PUSHBACK', taxi: 'ROLLVERKEHR', turn: 'ABFERTIGUNG' }[sh.kind];
      return set(K, x.t, x.sub);
    }
    if (sh.kind === 'site') {
      const p = (s.projects || []).find((q) => q.id === sh.id);
      return set('BAUSTELLE', p ? p.name : 'Bauarbeiten', p ? `${Math.floor(p.prog * 100)} % fertig` : '');
    }
    if (sh.kind === 'tour') {
      const sp = tourSpots(s).find((q) => q.id === sh.id);
      if (sp) return set(sp.k, sp.title, sp.sub);
    }
    if (sh.kind === 'land-side') return set('LANDSEITE', 'Terminal-Vorfahrt', 'Taxis, Busse und Reisende');
    if (sh.kind === 'night') return set('NACHT', s.name, 'Befeuerung und Nachtbetrieb');
    return set('ÜBERBLICK', s.name, `${s.acs.filter((a) => a.mode === 'map').length} Flugzeuge am Platz`);
  }

  // jeden Frame: Kamera führen
  update(dt) {
    if (!this.on) return;
    const s = this.game.state;
    const cam = this.game.cam;
    const sh = this.shot;
    if (!s || !sh) return this.next(true);
    sh.t += dt;
    const ac = sh.id && s.acs.find((a) => a.id === sh.id);
    let tx, ty, tz;
    if (['land', 'dep', 'goaround', 'push', 'taxi', 'turn'].includes(sh.kind)) {
      if (!ac || ac.mode !== 'map' || (sh.kind !== 'turn' && ac.z > 5)) return this.next();
      const lead = ['land', 'dep', 'goaround'].includes(sh.kind) ? 2.2 : 0.6;
      tx = ac.x + Math.cos(ac.hdg) * lead;
      ty = ac.y + Math.sin(ac.hdg) * lead - ac.z * 0.4;
      tz = sh.kind === 'turn' ? 2.3 : sh.kind === 'taxi' ? 1.8 : AC_TYPES[ac.type].size === 'L' ? 1.5 : 1.8;
      if (sh.kind === 'turn') {
        tx += Math.cos(sh.drift + sh.t * 0.05) * 1.2;
        ty += Math.sin(sh.drift + sh.t * 0.05) * 1.2;
      }
    } else if (sh.kind === 'site') {
      const g = (this.game.map.sites || []).find((q) => q.p.id === sh.id);
      if (!g) return this.next();
      tx = (g.g.x0 + g.g.x1) / 2 + Math.cos(sh.drift) * sh.t * 0.08;
      ty = (g.g.y0 + g.g.y1) / 2 + Math.sin(sh.drift) * sh.t * 0.08;
      tz = 1.5;
    } else if (sh.kind === 'tour') {
      const sp = sh.spot || (sh.spot = tourSpots(s).find((q) => q.id === sh.id));
      if (!sp) return this.next();
      // langsame Kreisfahrt um das Gebäude
      tx = sp.x + Math.cos(sh.drift + sh.t * 0.06) * 1.6;
      ty = sp.y + Math.sin(sh.drift + sh.t * 0.06) * 1.0;
      tz = sp.z;
    } else if (sh.kind === 'land-side') {
      tx = 30 + sh.t * 0.25;
      ty = 1.8;
      tz = 1.9;
    } else if (sh.kind === 'night') {
      tx = 40 + Math.cos(sh.drift) * sh.t * 0.3;
      ty = 24;
      tz = 0.75;
    } else {
      tx = LY.W / 2 + Math.cos(sh.drift) * (8 + sh.t * 0.4);
      ty = 20 + Math.sin(sh.drift) * 6;
      tz = 0.52 + sh.t * 0.006;
    }
    // weich folgen (Position und Zoom)
    const k = 1 - Math.pow(0.02, dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    const kz = 1 - Math.pow(0.15, dt);
    cam.zoom = clamp(cam.zoom + (tz - cam.zoom) * kz, 0.3, 2.6);
    cam.tx = null;
    if (sh.t > sh.dur) this.next();
    // Einblendungen: Uhr/Wetter und Live-Daten des gezeigten Flugzeugs
    this.infoT = (this.infoT || 0) - dt;
    if (this.infoT <= 0) {
      this.infoT = 0.25;
      const w = WEATHER[s.weather.kind];
      const clock = `TAG ${dayOf(s.time)} · ${fmtClock(s.time)} · ${w.icon} ${Math.round(temperature(s))} °C · WIND ${String(Math.round(s.wind.dir / 10) * 10).padStart(3, '0')}/${Math.round(s.wind.spd)}`;
      if (this.clockEl.textContent !== clock) this.clockEl.textContent = clock;
      let data = '';
      if (ac && ac.mode === 'map') {
        const kt = Math.round((ac.v || 0) * 323); // Kacheln je Spielsekunde -> Knoten (Endanflug 0,42 ≈ 135 kt)
        const alt = Math.round(((ac.z || 0) * 500) / 10) * 10;
        data = `<b>${esc(ac.cs)}</b> ${ac.type} · GS ${kt} kt${alt > 0 ? ` · ALT ${alt} ft` : ''} · HDG ${String(Math.round(((ac.hdg * 180) / Math.PI + 90 + 360) % 360)).padStart(3, '0')}°`;
      }
      if (this.dataEl._h !== data) {
        this.dataEl.innerHTML = data;
        this.dataEl._h = data;
      }
    }
  }
}

// ---------- Kommentar ----------
let nComm = 0;
const pickC = (list) => list[(nComm++ * 7 + list.length) % list.length];
const CAT = { short: 'Kurzstrecke', mid: 'Mittelstrecke', long: 'Langstrecke' };
function commentary(s, sh, ac) {
  if (ac) {
    const al = AIRLINES[ac.airline];
    const rot = s.rots[ac.rot];
    const city = rot ? CITIES[rot.city] : null;
    const cn = city ? city.name : 'unbekannt';
    const t = AC_TYPES[ac.type];
    const who = `${al ? al.name : ''} ${ac.cs.replace(/^[A-Z]+/, '')}`;
    const arriving = ARR_PH.has(ac.phase);
    const pax = rot ? (arriving ? rot.paxIn : rot.paxOut) : 0;
    const wet = ['rain', 'storm', 'snow'].includes(s.weather.kind);
    if (ac.emergency) return pickC([`Hier läuft ein Notfall: ${who} landet, die Feuerwehr steht bereit.`, `Spannung am Platz – ${who} hat einen Notfall gemeldet und bekommt Vorrang.`]);
    if (ac.protocol && s.sv) return pickC([`Staatsbesuch! ${s.sv.guest} an Bord der Regierungsmaschine – ${sh.kind === 'land' ? 'unten wartet schon der rote Teppich' : sh.kind === 'dep' ? 'die Delegation verabschiedet sich' : 'die Kolonne steht bereit'}.`, `Protokoll auf die Minute: ${who} mit ${s.sv.guest} – heute schaut das ganze Land auf ${s.name}.`]);
    if (ac.nordo) return `Ohne Funk unterwegs: ${who} bekommt vom Tower nur Lichtsignale.`;
    if (ac.type === 'A388' && (sh.kind === 'land' || sh.kind === 'dep')) return pickC([`Der Superjumbo! Die A380 von ${al.name} – über 500 Tonnen ${sh.kind === 'land' ? 'auf dem Weg zur Bahn' : 'heben gleich ab'}.`, `Das größte Passagierflugzeug der Welt – ${who} mit ${pax || 'über 500'} Menschen an Bord.`]);
    if (ac.special && SPECIALS[ac.special]) return pickC([`Ein echter Hingucker: ${al.name} in der Sonderlackierung „${SPECIALS[ac.special].name}“!`, `Spotter aufgepasst – ${who} trägt heute „${SPECIALS[ac.special].name}“.`]);
    if (sh.kind === 'land') return pickC([`Und da kommt ${who} rein – eine ${t.name} aus ${cn}.`, `${t.name} von ${al.name} im kurzen Endanflug${pax ? `, an Bord ${pax} Passagiere` : ''} aus ${cn}.`, wet ? `Bei diesem Wetter keine leichte Landung für ${who} – die Bahn ist nass.` : `Bilderbuchanflug: ${who} setzt gleich auf.`]);
    if (sh.kind === 'dep') return pickC([`Startlauf für ${who} – ${city ? CAT[city.cat] + ' nach ' + cn : 'auf dem Weg'}.`, `Volle Schubkraft: die ${t.name} von ${al.name} hebt gleich ab Richtung ${cn}.`, `${who} rollt an – ${pax ? pax + ' Reisende' : 'die Crew'} auf dem Weg nach ${cn}.`]);
    if (sh.kind === 'goaround') return pickC([`Durchstarten! ${who} bricht den Anflug ab und kommt noch einmal herum.`, `Da passt etwas nicht – ${who} startet durch.`]);
    if (sh.kind === 'push') return pickC([`Pushback an Position ${ac.stand || '—'}: ${who} nach ${cn} macht sich auf den Weg.`, `Der Schlepper schiebt ${who} zurück – gleich geht es nach ${cn}.`]);
    if (sh.kind === 'taxi') return pickC([`Auf dem Rollweg: ${who} ${arriving ? `rollt nach der Landung aus ${cn} zur Position` : `rollt zur Startbahn, Ziel ${cn}`}.`, `Rollverkehr – ${t.name} von ${al.name} ${arriving ? 'kommt gerade von der Bahn' : 'auf dem Weg zum Rollhalt'}.`]);
    if (sh.kind === 'turn' && ac.ta) {
      const tk = Object.values(ac.ta.tasks);
      const done = tk.filter((x) => x.st === 'done').length;
      return pickC([`Boxenstopp an Position ${ac.stand}: ${done} von ${tk.length} Arbeiten erledigt.`, `Tanken, Catering, Gepäck – die Crews wuseln um ${who}.`]);
    }
    return '';
  }
  if (sh.kind === 'site') {
    const p = (s.projects || []).find((q) => q.id === sh.id);
    return p ? `Hier wird gebaut: ${p.name} – ${Math.floor(p.prog * 100)} Prozent fertig.` : '';
  }
  if (sh.kind === 'tour') {
    const sp = tourSpots(s).find((q) => q.id === sh.id);
    if (sp) return pickC(sp.lines);
  }
  if (sh.kind === 'land-side') return pickC([`Vor dem Terminal ist Betrieb – heute schon ${s.stats.today.pax.toLocaleString('de-DE')} Reisende.`, 'Taxis, Busse, Koffer – die Landseite erwacht.']);
  if (sh.kind === 'night') return pickC([`Nachtbetrieb in ${s.name} – die Befeuerung weist den Weg.`, 'Ruhige Stunden am Flughafen, nur die Lichter blinken.']);
  const t = s.stats.today;
  const d = t.onTime + t.delayed;
  return pickC([`Ein Blick über ${s.name}: ${s.acs.filter((a) => a.mode === 'map').length} Flugzeuge am Platz.`, `${t.mov} Bewegungen bisher heute${d ? `, ${Math.round((t.onTime / d) * 100)} Prozent pünktlich` : ''}.`]);
}
