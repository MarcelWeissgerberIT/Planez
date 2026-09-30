// Sprechtaste (Push-to-Talk): V gedrückt halten oder 🎙 drücken und auf Englisch funken.
// Die Spracherkennung des Browsers (Chrome/Edge) liefert den Text, voiceCmd erkennt Rufzeichen und Freigabe.
import { parseVoice } from '../voiceCmd.js';
import { CMDS, command } from '../sim/atc.js';
import { voice, micClick } from '../voice.js';
import { toast } from './dom.js';
import { sfx } from '../audio.js';
import { radio } from '../sim/messages.js';
import { tel } from '../sim/aircraft.js';

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
    const r = parseVoice(s, said);
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
