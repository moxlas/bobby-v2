let audioCtx: AudioContext | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let muted = false;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterCompressor = audioCtx.createDynamicsCompressor();
    masterCompressor.threshold.setValueAtTime(-20, audioCtx.currentTime);
    masterCompressor.knee.setValueAtTime(18, audioCtx.currentTime);
    masterCompressor.ratio.setValueAtTime(3, audioCtx.currentTime);
    masterCompressor.attack.setValueAtTime(0.004, audioCtx.currentTime);
    masterCompressor.release.setValueAtTime(0.16, audioCtx.currentTime);
    masterCompressor.connect(audioCtx.destination);
  }

  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => undefined);
  }

  return audioCtx;
}

function connectVoice(gain: GainNode, ac: AudioContext) {
  gain.connect(masterCompressor ?? ac.destination);
}

export function setMuted(value: boolean) {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

export function initAudio() {
  try {
    getAudioContext();
  } catch {
    // Audio is optional when the browser does not support Web Audio.
  }
}

function playTone(
  frequency: number,
  type: OscillatorType,
  startTime: number,
  duration: number,
  gainPeak: number,
  attackFrac = 0.06,
  decayFrac = 0.35,
  filterFrequency = Math.max(900, frequency * 4)
) {
  const ac = getAudioContext();
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);
  osc.detune.setValueAtTime((Math.random() - 0.5) * 4, startTime);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFrequency, startTime);
  filter.Q.setValueAtTime(0.45, startTime);

  const attack = Math.max(0.004, duration * attackFrac);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(gainPeak, startTime + attack);
  gain.gain.setValueAtTime(gainPeak, startTime + duration * (1 - decayFrac));
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(filter);
  filter.connect(gain);
  connectVoice(gain, ac);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
}

function playFreqSweep(
  freqStart: number,
  freqEnd: number,
  type: OscillatorType,
  startTime: number,
  duration: number,
  gainPeak: number,
  filterFrequency = Math.max(freqStart, freqEnd) * 3
) {
  const ac = getAudioContext();
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, startTime);
  osc.frequency.exponentialRampToValueAtTime(freqEnd, startTime + duration);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFrequency, startTime);
  filter.frequency.exponentialRampToValueAtTime(Math.max(500, filterFrequency * 0.45), startTime + duration);
  filter.Q.setValueAtTime(0.35, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(gainPeak, startTime + Math.min(0.012, duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(filter);
  filter.connect(gain);
  connectVoice(gain, ac);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
}

function playNoise(
  startTime: number,
  duration: number,
  gainPeak: number,
  cutoff = 2400,
  filterType: BiquadFilterType = 'lowpass',
  resonance = 0.45
) {
  const ac = getAudioContext();
  const bufferSize = Math.ceil(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ac.createBufferSource();
  source.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(cutoff, startTime);
  filter.frequency.exponentialRampToValueAtTime(Math.max(450, cutoff * 0.35), startTime + duration);
  filter.Q.setValueAtTime(resonance, startTime);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(gainPeak, startTime + Math.min(0.008, duration * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  source.connect(filter);
  filter.connect(gain);
  connectVoice(gain, ac);
  source.start(startTime);
  source.stop(startTime + duration + 0.01);
}

export function playCardSound(cardCount = 1) {
  if (muted) return;
  try {
    const ac = getAudioContext();
    const now = ac.currentTime;
    const pitch = 1 + (Math.random() - 0.5) * 0.035;

    // A close paper flick, a soft table tap, and a short settling rustle.
    playNoise(now, 0.045, 0.09, 5200, 'highpass', 0.25);
    playNoise(now + 0.006, 0.08, 0.028, 1450, 'bandpass', 0.55);
    playFreqSweep(620 * pitch, 285 * pitch, 'sine', now, 0.075, 0.032, 2100);
    playTone(155 * pitch, 'sine', now + 0.008, 0.12, 0.105, 0.05, 0.75, 700);
    playNoise(now + 0.025, 0.07, 0.035, 2600, 'lowpass');

    // Multi-card plays get a light flutter for each extra card in the stack.
    const extraCards = Math.min(3, Math.max(0, Math.floor(cardCount) - 1));
    for (let index = 0; index < extraCards; index++) {
      const offset = 0.035 + index * 0.026;
      playNoise(now + offset, 0.045, 0.036 - index * 0.006, 3900 - index * 450, 'highpass', 0.3);
      playTone(205 * pitch + index * 18, 'sine', now + offset, 0.065, 0.025, 0.05, 0.82, 900);
    }
  } catch { /* unavailable */ }
}

export function playCardSelectSound(isSelecting = true) {
  if (muted) return;
  try {
    const ac = getAudioContext();
    const now = ac.currentTime;
    const startPitch = isSelecting ? 280 : 390;
    const endPitch = isSelecting ? 410 : 285;
    playNoise(now, 0.04, 0.024, 4200, 'highpass', 0.25);
    playNoise(now + 0.006, 0.055, 0.018, 1250, 'bandpass', 0.5);
    playFreqSweep(startPitch, endPitch, 'sine', now, 0.075, 0.022, 1450);
  } catch { /* unavailable */ }
}

export function playCardPickupSound() {
  if (muted) return;
  try {
    const ac = getAudioContext();
    const now = ac.currentTime;
    playNoise(now, 0.11, 0.04, 1800);
    playFreqSweep(230, 440, 'sine', now, 0.13, 0.035, 1500);
  } catch { /* unavailable */ }
}

export function playTakeSound() {
  if (muted) return;
  try {
    const ac = getAudioContext();
    const now = ac.currentTime;

    // A low, airy pull with a few light card edges fluttering past.
    playFreqSweep(430, 125, 'sine', now, 0.31, 0.065, 1700);
    playNoise(now, 0.28, 0.052, 1900);
    [0.04, 0.115, 0.19].forEach((offset, index) => {
      playNoise(now + offset, 0.045, 0.022 - index * 0.003, 3000 - index * 400);
    });
    playTone(165, 'sine', now + 0.08, 0.22, 0.045, 0.08, 0.8, 700);
  } catch { /* unavailable */ }
}

export function playComboSound() {
  if (muted) return;
  try {
    const ac = getAudioContext();
    const now = ac.currentTime;
    const notes = [523, 659, 784, 1047];

    playTone(262, 'sine', now, 0.55, 0.035, 0.12, 0.65, 1000);
    playTone(392, 'sine', now + 0.025, 0.48, 0.025, 0.12, 0.7, 1500);
    notes.forEach((freq, index) => {
      const start = now + index * 0.085;
      playTone(freq, 'triangle', start, 0.25, 0.06, 0.045, 0.65, 3200);
      playTone(freq * 2, 'sine', start + 0.012, 0.18, 0.014, 0.04, 0.8, 5200);
    });
  } catch { /* unavailable */ }
}

export function playWinSound() {
  if (muted) return;
  try {
    const ac = getAudioContext();
    const now = ac.currentTime;
    const chord = [261.63, 329.63, 392, 523.25];
    chord.forEach((frequency, index) => {
      playTone(frequency, 'sine', now + 0.34, 0.72, 0.045, 0.12, 0.58, 2200);
      if (index < 3) {
        playTone(frequency * 2, 'triangle', now + 0.16 + index * 0.07, 0.48, 0.055, 0.035, 0.62, 4000);
      }
    });

    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((frequency, index) => {
      const start = now + index * 0.11;
      playTone(frequency, 'triangle', start, 0.3, 0.075, 0.035, 0.72, 5000);
      playTone(frequency * 2, 'sine', start + 0.018, 0.24, 0.018, 0.03, 0.8, 7000);
    });
    playTone(130.81, 'sine', now + 0.34, 0.82, 0.095, 0.1, 0.62, 650);
  } catch { /* unavailable */ }
}

export function playLoseSound() {
  if (muted) return;
  try {
    const ac = getAudioContext();
    const now = ac.currentTime;
    const melody = [392, 349.23, 293.66, 261.63];

    melody.forEach((frequency, index) => {
      const start = now + index * 0.17;
      playTone(frequency, 'triangle', start, 0.29, 0.07, 0.08, 0.7, 1800);
      playTone(frequency / 2, 'sine', start + 0.015, 0.32, 0.035, 0.1, 0.75, 700);
    });
    playTone(130.81, 'sine', now + 0.55, 0.65, 0.045, 0.12, 0.72, 600);
  } catch { /* unavailable */ }
}

export function playYourTurnSound() {
  if (muted) return;
  try {
    const ac = getAudioContext();
    const now = ac.currentTime;
    [659.25, 880].forEach((frequency, index) => {
      const start = now + index * 0.13;
      playTone(frequency, 'sine', start, 0.19, 0.045, 0.025, 0.78, 3600);
      playTone(frequency * 2.76, 'sine', start + 0.012, 0.14, 0.012, 0.025, 0.82, 5600);
    });
  } catch { /* unavailable */ }
}

export function playClickSound() {
  if (muted) return;
  try {
    const ac = getAudioContext();
    const now = ac.currentTime;
    playNoise(now, 0.022, 0.035, 3800, 'highpass', 0.25);
    playNoise(now + 0.002, 0.032, 0.018, 900, 'bandpass', 0.65);
    playTone(190, 'sine', now + 0.002, 0.045, 0.025, 0.04, 0.85, 620);
  } catch { /* unavailable */ }
}
