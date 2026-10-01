// Sprechtaste (Push-to-Talk): V gedrückt halten oder 🎙 drücken und auf Englisch funken.
// Die Spracherkennung des Browsers (Chrome/Edge) liefert den Text, voiceCmd erkennt Rufzeichen und Freigabe.
import { parseVoice, parseSide } from '../voiceCmd.js';
import { approveHeli, holdHeli } from '../sim/heli.js';
import { clearVfr, extendVfr, vfrTel } from '../sim/vfr.js';
import { approveInspection, deferInspection } from '../sim/inspect.js';
import { CMDS, command } from '../sim/atc.js';
import { voice, micClick } from '../voice.js';
import { toast } from './dom.js';
import { sfx } from '../audio.js';
import { radio } from '../sim/messages.js';
import { tel } from '../sim/aircraft.js';
import { correctReadback } from '../sim/readback.js';
import { callNordo } from '../sim/nordo.js';

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export function initPTT(game) {
  const box = document.getElementById('ptt');
  const txt = box.querySelector('.ptt-t');
  let rec = null;
  let active = false;
  let final = '';
  let interim = '';

  const show = (t, cls = '') => {
    box.className = cls;
    txt.textContent = t;
  };
  const hide = (delay = 0) => setTimeout(() => {
    if (!active) box.className = 'hidden';
  }, delay);

  function start() {
    const s = game.state;
    if (!s || active) return;
    if (s.role !== 'tower') return toast('Sprechtaste gibt es in der Tower-Rolle', 'info', 2000);
    if (!SR) return toast('Spracherkennung wird von diesem Browser nicht unterstützt – bitte Chrome oder Edge nutzen', 'warn', 4200);
    active = true;
    final = '';
    interim = '';
    micClick(voice.vol);
    // eigener Funkspruch hat Vorrang: laufende Ansage abbrechen
    if (window.speechSynthesis) speechSynthesis.cancel();
    show('Sprich jetzt … (z. B. „Aurora five four two, cleared to land“)', 'on');
    try {
      rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 3;
      rec.onresult = (e) => {
        interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) final += ' ' + e.results[i][0].transcript;
          else interim += ' ' + e.results[i][0].transcript;
        }
        show(`„${(final + interim).trim()}“`, 'on');
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed') toast('Mikrofon nicht freigegeben – im Browser erlauben', 'warn', 4000);
        else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Spracherkennung: ' + e.error, 'warn', 2500);
      };
      rec.onend = () => {
        if (!active) finish();
      };
      rec.start();
    } catch (e) {
      active = false;
      hide();
    }
  }

  function stop() {
    if (!active) return;
    active = false;
    micClick(voice.vol);
    try {
      rec && rec.stop();
    } catch (e) {
      finish();
    }
    // manche Browser melden das Ende verspätet
    setTimeout(finish, 900);
  }

  let handled = '';
  function finish() {
    const said = (final + ' ' + interim).trim();
    if (said && said === handled) return;
    if (!said) return hide(600);
    handled = said;
    const s = game.state;
    // Nebenverkehr: Rettungshubschrauber, Cessna in der Platzrunde, Pistenkontrolle
    const sd = parseSide(s, said);
    if (sd) return sideCmd(s, sd, said);
    const r = parseVoice(s, said);
    // „Negative …“: falschen Readback korrigieren (ohne erkanntes Rufzeichen den einzigen offenen)
    if (r.cmd === 'rbfix') {
      const tgt = r.ac && r.ac.rbErr ? r.ac : s.acs.find((a) => a.rbErr);
      if (tgt) {
        voice.muteAtcUntil = performance.now() + 2500;
        const res = correctReadback(s, tgt);
        show(`✓ ${tgt.cs} · Readback korrigiert`, 'ok');
        s.life = s.life || {};
        s.life.voiceCmd = (s.life.voiceCmd || 0) + 1;
        if (res.ok) game.select(tgt.id, false);
        return hide(2200);
      }
      if (!r.ac) {
        show(`„${said}“ – kein falscher Readback offen`, 'bad');
        return hide(2400);
      }
    }
    if (!r.ac) {
      show(`„${said}“ – Rufzeichen nicht erkannt`, 'bad');
      // wie im echten Funk: irgendwer hat etwas gehört, aber nicht verstanden
      const near = s.acs.find((a) => a.mode === 'air' || a.mode === 'map');
      if (near) radio(s, '', 'Station calling Tower, say again.', 'pilot');
      return hide(2600);
    }
    if (!r.cmd) {
      show(`„${said}“ – ${r.ac.cs}: Freigabe nicht erkannt`, 'bad');
      radio(s, r.ac.cs, `Say again, ${tel(r.ac)}.`, 'pilot');
      return hide(2600);
    }
    if (!CMDS[r.cmd]) return hide();
    // Funkausfall: keine Antwort – nur Lichtsignale helfen
    if (r.ac.nordo) {
      callNordo(s, r.ac);
      show(`📻✖ ${r.ac.cs} antwortet nicht (7600) – Lichtsignal auf dem Streifen benutzen`, 'bad');
      return hide(3000);
    }
    // eigene Ansage nicht noch einmal vorlesen, nur die Rücklesung des Piloten
    voice.muteAtcUntil = performance.now() + 2500;
    const res = command(s, r.ac, r.cmd);
    if (!res.ok) {
      show(`${r.ac.cs}: ${res.msg}`, 'bad');
      radio(s, r.ac.cs, `Unable, ${tel(r.ac)}.`, 'pilot');
    } else {
      show(`✓ ${r.ac.cs} · ${CMDS[r.cmd].label}`, 'ok');
      s.life = s.life || {};
      s.life.voiceCmd = (s.life.voiceCmd || 0) + 1;
      game.select(r.ac.id, false);
    }
    hide(2200);
  }

  function sideCmd(s, sd, said) {
    const name = { heli: 'Rescue 7', vfr: s.vfr && s.vfr.p ? s.vfr.p.cs : 'Cessna', insp: 'Check 1' }[sd.side];
    if (!sd.cmd) {
      show(`„${said}“ – ${name}: Freigabe nicht erkannt`, 'bad');
      const who = { heli: 'Rescue 7', vfr: s.vfr && s.vfr.p ? vfrTel(s.vfr.p.cs) : 'Cessna', insp: 'Check 1' }[sd.side];
      radio(s, sd.side === 'heli' ? 'RESCUE7' : sd.side === 'insp' ? 'CHECK1' : s.vfr.p.cs, `Say again, ${who}.`, 'pilot');
      return hide(2600);
    }
    voice.muteAtcUntil = performance.now() + 2500;
    const ok = sd.cmd === 'ok';
    const r = sd.side === 'heli' ? (ok ? approveHeli(s) : holdHeli(s)) : sd.side === 'vfr' ? (ok ? clearVfr(s) : extendVfr(s)) : ok ? approveInspection(s) : deferInspection(s);
    if (!r.ok) {
      show(`${name}: ${ok ? 'nichts freizugeben' : 'wartet bereits'}`, 'info');
      return hide(2200);
    }
    const label = { heli: ok ? 'Querung frei' : 'warten südlich', vfr: ok ? 'Touch and Go frei' : 'Gegenanflug verlängern', insp: ok ? 'Bahn frei zur Kontrolle' : 'vor der Bahn warten' }[sd.side];
    if (r.bad) show(`⚠ ${name} · ${label} – Konflikt mit dem Linienverkehr!`, 'bad');
    else show(`✓ ${name} · ${label}${r.soft ? ` – knapp, ${r.soft.ac.cs} ist ${r.soft.why}` : ''}`, 'ok');
    s.life = s.life || {};
    s.life.voiceCmd = (s.life.voiceCmd || 0) + 1;
    game.refreshUi && game.refreshUi();
    hide(2400);
  }

  const typing = (e) => e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.key === 'v' || e.key === 'V') && !e.repeat && !typing(e) && game.state && game.state.role === 'tower') {
        e.preventDefault();
        e.stopImmediatePropagation();
        start();
      }
    },
    true
  );
  window.addEventListener(
    'keyup',
    (e) => {
      if ((e.key === 'v' || e.key === 'V') && active) {
        e.preventDefault();
        stop();
      }
    },
    true
  );
  const btn = document.getElementById('ptt-btn');
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    start();
  });
  window.addEventListener('pointerup', () => active && stop());
  return { supported: !!SR };
}
