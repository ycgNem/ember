// All sound is synthesized: one-shot blips for effects, a drone per sector, and a
// step-sequenced soundtrack whose layers build with intensity:
// 0 silence, 1 pulse + bass, 2 four-on-the-floor with hats and snare, 3 FEVER (arps, 16th hats).

let audio: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let pad: { oscs: OscillatorNode[]; gain: GainNode } | null = null;
let padRoot = 0;

let noise: AudioBuffer | null = null;
let music: GainNode | null = null;
let intensity = 0;
let step = 0;
let nextStep = 0;
let timer = 0;

const BPM = 124;
// bass line in semitones over 16 eighth notes (minor, driving)
const BASS = [0, 0, 12, 0, 3, 3, 15, 3, 5, 5, 17, 5, 7, 10, 7, 3];
const ARP = [0, 7, 12, 15, 19, 15, 12, 7];

/** Browsers only allow audio after a user gesture, so call this from input handlers. */
export function ensureAudio() {
  if (!audio) {
    try {
      audio = new AudioContext();
      master = audio.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(audio.destination);
    } catch {
      audio = null;
      master = null;
    }
  }
  if (audio?.state === 'suspended') void audio.resume();
  if (padRoot && !pad) setAmbient(padRoot);
  startMusic();
}

export function toggleMute(): boolean {
  muted = !muted;
  if (audio && master) master.gain.setTargetAtTime(muted ? 0 : 1, audio.currentTime, 0.05);
  return muted;
}

export function blip(freq: number, dur = 0.12, type: OscillatorType = 'sine', vol = 0.12, slide = 1, delay = 0) {
  if (!audio || !master) return;
  const t = audio.currentTime + delay;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur);
}

/** A filtered noise burst: whooshes, impacts, cymbal-ish hits. */
export function noiseHit(vol = 0.2, dur = 0.2, freq = 2000, type: BiquadFilterType = 'bandpass', at?: number, out?: AudioNode) {
  if (!audio || !noise || !master) return;
  const t = at ?? audio.currentTime;
  const src = audio.createBufferSource();
  src.buffer = noise;
  const f = audio.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = audio.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out ?? master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur);
}

/** A low drone (root, fifth, octave) under a slowly breathing filter; each sector has its own root. */
export function setAmbient(root: number) {
  padRoot = root;
  const ac = audio;
  if (!ac || !master) return;
  if (!pad) {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 5;
    const lfo = ac.createOscillator();
    const lfoDepth = ac.createGain();
    lfo.frequency.value = 0.06;
    lfoDepth.gain.value = 260;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.035, ac.currentTime, 2.5);
    const oscs = [0, 1, 2].map((i) => {
      const o = ac.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.detune.value = [-7, 8, 0][i];
      o.connect(filter);
      o.start();
      return o;
    });
    filter.connect(gain).connect(master);
    pad = { oscs, gain };
  }
  const ratios = [1, 1.5, 2];
  pad.oscs.forEach((o, i) => o.frequency.setTargetAtTime(root * ratios[i], ac.currentTime, 1.2));
}

export function setMusicIntensity(level: number) {
  intensity = level;
}

// ---------- the sequencer ----------

function startMusic() {
  const ac = audio;
  if (!ac || !master || timer) return;
  noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  music = ac.createGain();
  music.gain.value = 0.55;
  music.connect(master);
  nextStep = ac.currentTime + 0.1;
  // schedule slightly ahead on the audio clock so timing stays tight even if frames hitch
  timer = window.setInterval(() => {
    const sixteenth = 60 / BPM / 4;
    while (nextStep < ac.currentTime + 0.12) {
      playStep(step, nextStep);
      nextStep += sixteenth;
      step = (step + 1) % 32;
    }
  }, 25);
}

function tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, cutoff: number) {
  if (!audio || !music) return;
  const o = audio.createOscillator();
  const f = audio.createBiquadFilter();
  const g = audio.createGain();
  o.type = type;
  o.frequency.value = freq;
  f.type = 'lowpass';
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.3), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(music);
  o.start(t);
  o.stop(t + dur);
}

function kick(t: number) {
  if (!audio || !music) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(0.75, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  o.connect(g).connect(music);
  o.start(t);
  o.stop(t + 0.3);
}

function playStep(s: number, t: number) {
  if (intensity <= 0 || !music) return;
  const root = (padRoot || 55) * 2;
  const note = (semi: number, base = root) => base * Math.pow(2, semi / 12);
  const full = intensity >= 2;
  const fever = intensity >= 3;

  if (s % (full ? 4 : 8) === 0) kick(t);
  if (s % (full ? 2 : 4) === 0) tone(note(BASS[(s >> 1) % 16]), t, 0.2, 'sawtooth', 0.16, fever ? 1400 : 700);
  if (full && s % 8 === 4) {
    noiseHit(0.3, 0.14, 1800, 'bandpass', t, music);
    tone(190, t, 0.08, 'triangle', 0.12, 2000);
  }
  if (full && s % 2 === 1) noiseHit(0.09, 0.03, 8000, 'highpass', t, music);
  if (fever) {
    if (s % 4 === 2) noiseHit(0.1, 0.12, 7000, 'highpass', t, music);
    noiseHit(0.04, 0.02, 10000, 'highpass', t, music);
    tone(note(ARP[s % 8], root * 4), t, 0.1, 'square', 0.035, 3200);
  }
}
