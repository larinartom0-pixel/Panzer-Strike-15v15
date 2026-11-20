/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOscSub: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private isMuted: boolean = false;
  private isInitialized: boolean = false;
  private voiceEnabled: boolean = true;

  init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      this.initEngineAudio();
      this.isInitialized = true;
    } catch (e) {
      console.warn('AudioContext failed to start:', e);
    }
  }

  private initEngineAudio() {
    if (!this.ctx || !this.masterGain) return;
    try {
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(0.001, this.ctx.currentTime);

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.setValueAtTime(220, this.ctx.currentTime);

      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(38, this.ctx.currentTime);

      this.engineOscSub = this.ctx.createOscillator();
      this.engineOscSub.type = 'triangle';
      this.engineOscSub.frequency.setValueAtTime(19, this.ctx.currentTime);

      this.engineOsc.connect(this.engineFilter);
      this.engineOscSub.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOsc.start();
      this.engineOscSub.start();
    } catch {
      // Audio engine setup fallback
    }
  }

  updateEngineSound(speedNorm: number, isMoving: boolean) {
    if (!this.ctx || !this.engineGain || !this.engineOsc || !this.engineOscSub || !this.engineFilter || this.isMuted) return;
    const now = this.ctx.currentTime;
    const absSpeed = Math.abs(speedNorm);
    const targetGain = isMoving ? 0.22 : 0.08;
    const baseFreq = isMoving ? 45 + absSpeed * 40 : 32;
    const filterFreq = isMoving ? 280 + absSpeed * 350 : 180;

    this.engineGain.gain.setTargetAtTime(targetGain, now, 0.1);
    this.engineOsc.frequency.setTargetAtTime(baseFreq, now, 0.08);
    this.engineOscSub.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(filterFreq, now, 0.12);
  }

  playCannonShot(isHeavy: boolean = false) {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    // Sub-bass thump
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(isHeavy ? 110 : 150, now);
    subOsc.frequency.exponentialRampToValueAtTime(25, now + 0.35);

    subGain.gain.setValueAtTime(1.0, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.46);

    // Muzzle blast noise crack
    const bufferSize = this.ctx.sampleRate * 0.25;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.04));
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(800, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(200, now + 0.2);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.85, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    whiteNoise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    whiteNoise.start(now);
    whiteNoise.stop(now + 0.26);
  }

  playPenetration() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    // Heavy metallic clang
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(320, now);
    osc1.frequency.exponentialRampToValueAtTime(90, now + 0.3);

    osc2.type = 'square';
    osc2.frequency.setValueAtTime(540, now);
    osc2.frequency.exponentialRampToValueAtTime(120, now + 0.25);

    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.41);
    osc2.stop(now + 0.41);
  }

  playRicochet() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    // High pitched metal deflection "PING!"
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1600, now);
    osc.frequency.exponentialRampToValueAtTime(2400, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.4);

    gain.gain.setValueAtTime(0.65, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.43);
  }

  playExplosion() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    // Deep detonation rumble
    const bufferSize = this.ctx.sampleRate * 1.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.25));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);
    filter.frequency.exponentialRampToValueAtTime(60, now + 1.1);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(now);
    noise.stop(now + 1.21);
  }

  playReloadFinish() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.setValueAtTime(950, now + 0.07);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  playTrackBreak() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.linearRampToValueAtTime(40, now + 0.2);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  playBaseAlarm() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(700, now);
    osc.frequency.linearRampToValueAtTime(880, now + 0.18);
    osc.frequency.linearRampToValueAtTime(700, now + 0.36);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.42);
  }

  playRadioCue(cue: 'penetration' | 'kill' | 'ricochet' | 'track_damaged' | 'base_capture') {
    if (!this.voiceEnabled) return;
    // We play distinct radio comm chirps and if browser SpeechSynthesis is available, a brief tactical cue in Ukrainian
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    // Radio squelch beep
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1100, now + 0.04);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.11);

    // Optional synthesized tactical voice announcement
    try {
      if ('speechSynthesis' in window && !this.isMuted) {
        window.speechSynthesis.cancel();
        const phrases: Record<string, string[]> = {
          penetration: ['Є пробиття!', 'Броня пробита!', 'Влучання!'],
          kill: ['Ворог знищений!', 'Готовий!', 'Техніку ліквідовано!'],
          ricochet: ['Рикошет!', 'Не пробив!', 'Броня витримала!'],
          track_damaged: ['Збили гусеницю!', 'Рух неможливий!'],
          base_capture: ['Увага, базу захоплюють!']
        };
        const list = phrases[cue];
        if (list && list.length > 0) {
          const phrase = list[Math.floor(Math.random() * list.length)];
          const utter = new SpeechSynthesisUtterance(phrase);
          utter.lang = 'uk-UA';
          utter.rate = 1.15;
          utter.pitch = 0.9;
          utter.volume = 0.6;
          window.speechSynthesis.speak(utter);
        }
      }
    } catch {
      // Speech synthesis fallback
    }
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.7, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  private ensureContext() {
    if (!this.ctx) {
      this.init();
    } else if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
}

export const soundEngine = new SoundEngine();
