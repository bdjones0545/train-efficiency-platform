let _ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!_ctx || _ctx.state === "closed") {
      _ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (_ctx.state === "suspended") _ctx.resume();
    return _ctx;
  } catch {
    return null;
  }
}

function playTone(
  frequency: number,
  type: OscillatorType,
  gainPeak: number,
  durationSec: number,
  fadeInSec = 0.01,
  fadeOutSec = 0.08,
) {
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.value = frequency;
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + fadeInSec);
  gain.gain.setValueAtTime(gainPeak, now + durationSec - fadeOutSec);
  gain.gain.linearRampToValueAtTime(0, now + durationSec);
  osc.start(now);
  osc.stop(now + durationSec);
}

export const voiceSoundCues = {
  start() {
    playTone(880, "sine", 0.12, 0.12, 0.01, 0.06);
    setTimeout(() => playTone(1100, "sine", 0.1, 0.1, 0.01, 0.06), 80);
  },
  stop() {
    playTone(660, "sine", 0.1, 0.1, 0.01, 0.07);
  },
  submit() {
    playTone(880, "sine", 0.1, 0.08, 0.01, 0.04);
    setTimeout(() => playTone(1100, "sine", 0.12, 0.1, 0.01, 0.05), 60);
    setTimeout(() => playTone(1320, "sine", 0.1, 0.12, 0.01, 0.06), 130);
  },
  error() {
    playTone(330, "sawtooth", 0.08, 0.18, 0.01, 0.1);
    setTimeout(() => playTone(260, "sawtooth", 0.07, 0.15, 0.01, 0.1), 120);
  },
};
