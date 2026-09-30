// Schwierigkeitsgrad: Faktoren für Treibstoffreserven, Zwischenfälle und Strafen
export const DIFFICULTY = {
  easy: { name: 'Entspannt', fuel: 1.5, events: 1.7, penalty: 0.5, breakdowns: false, desc: 'mehr Treibstoffreserve, seltener Zwischenfälle, milde Strafen, keine Fahrzeugdefekte' },
  normal: { name: 'Normal', fuel: 1, events: 1, penalty: 1, breakdowns: true, desc: 'ausgewogen' },
  hard: { name: 'Profi', fuel: 0.8, events: 0.65, penalty: 1.4, breakdowns: true, desc: 'knappe Reserven, häufige Zwischenfälle, harte Strafen' },
};
export const diff = (state) => DIFFICULTY[(state.settings && state.settings.difficulty) || 'normal'] || DIFFICULTY.normal;
