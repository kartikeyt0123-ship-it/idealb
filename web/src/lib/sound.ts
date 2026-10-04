/** Tiny synthesized sound cues (no audio assets). Muted by default; toggled with M. */
let muted = (() => {
  try {
    return localStorage.getItem('ab-muted') !== 'false';
  } catch {
    return true;
  }
})();
let ctx: AudioContext | null = null;

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('ab-muted', String(m));
  } catch {
    /* storage unavailable */
  }
}

export function beep(freq = 440, dur = 0.15, vol = 0.025) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.value = vol;
    o.frequency.value = freq;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.start();
    o.stop(ctx.currentTime + dur);
  } catch {
    /* audio unavailable */
  }
}

export const sfx = {
  step: () => beep(100, 0.08, 0.012),
  room: () => beep(280),
  open: () => beep(550),
  good: () => beep(660),
  great: () => beep(880, 0.25),
  bad: () => beep(160, 0.25),
  alarm: () => {
    beep(520, 0.2, 0.03);
    setTimeout(() => beep(390, 0.25, 0.03), 220);
  },
  card: () => beep(700),
};
