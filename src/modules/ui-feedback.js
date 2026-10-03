/**
 * Synthesized mechanical feedback for camera-style controls: short bursts of
 * band-passed noise (clicks, not tones) plus vibration where the platform exposes it (Android; iOS PWAs have
 * no vibration API, so sound is the only channel there and the iOS silent
 * switch may mute it — callers must never rely on feedback for correctness).
 */

let audioContext = null;

function resolveAudioContextClass() {
  return globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
}

/**
 * Create the audio context ahead of the first touch. Creating it costs ~50ms of
 * main thread, which would drop frames from the first drag (the tuning tray's
 * bubble). Outside a gesture it starts suspended; `unlockUiFeedback` resumes it.
 */
export function prepareUiFeedback() {
  const AudioContextClass = resolveAudioContextClass();
  if (AudioContextClass) {
    audioContext ??= new AudioContextClass();
  }
}

/**
 * Create/resume the audio context. Must be called from a user gesture
 * (pointerdown) once, otherwise iOS keeps the context suspended.
 */
export function unlockUiFeedback() {
  const AudioContextClass = resolveAudioContextClass();
  if (!AudioContextClass) {
    return;
  }
  audioContext ??= new AudioContextClass();
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
}

/**
 * One click: white noise with a steep decay, band-passed around `frequency`.
 * Higher bands read as small detents, lower ones as heavier parts; a high `q`
 * rings into a pitched tick. Band and level wander a little on every click so
 * a fast spin does not sound like a loop.
 */
function playClick({ frequency, duration, gain, q = 1.4, delay = 0 }) {
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const length = Math.ceil(audioContext.sampleRate * duration);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 4;
  }
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  const filter = audioContext.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = frequency * (0.94 + Math.random() * 0.12);
  filter.Q.value = q;
  const amplifier = audioContext.createGain();
  amplifier.gain.value = gain * (0.85 + Math.random() * 0.3);
  source.connect(filter).connect(amplifier).connect(audioContext.destination);
  source.start(audioContext.currentTime + delay);
}

function vibrate(pattern) {
  globalThis.navigator?.vibrate?.(pattern);
}

/* Each control clicks in its own voice, so a drum is known by ear: the count
   dial's small high click, a fine ratchet for analyze, a wooden click for
   density, a glassy tick for tone, and a two-part latch for the look. */
const DETENT_VOICES = Object.freeze({
  count: [{ frequency: 3400, duration: 0.012, gain: 0.5 }],
  analyze: [{ frequency: 5200, duration: 0.008, gain: 0.5, q: 2 }],
  density: [{ frequency: 1700, duration: 0.018, gain: 0.5, q: 1 }],
  tone: [{ frequency: 4200, duration: 0.016, gain: 0.8, q: 6 }],
  look: [
    { frequency: 1100, duration: 0.022, gain: 0.7 },
    { frequency: 3000, duration: 0.008, gain: 0.35, delay: 0.03 },
  ],
});

/**
 * One detent crossed: a click in the control's voice + micro vibration. A
 * major detent (a labeled tick, a reset) lands lower and firmer.
 */
export function detentFeedback(voice = "count", major = false) {
  for (const click of DETENT_VOICES[voice] ?? DETENT_VOICES.count) {
    playClick(
      major ? { ...click, frequency: click.frequency * 0.75, gain: click.gain * 1.4 } : click,
    );
  }
  vibrate(major ? 14 : 8);
}

/** Hit an end stop: duller thunk + firmer vibration. */
export function boundaryFeedback() {
  playClick({ frequency: 520, duration: 0.035, gain: 0.8 });
  vibrate(24);
}

/** A button going down: a short, softer click than a detent. */
export function pressFeedback() {
  playClick({ frequency: 2200, duration: 0.01, gain: 0.35 });
}

/** Shutter released: a two-part clack, the curtain opening then closing. */
export function shutterFeedback() {
  playClick({ frequency: 1400, duration: 0.04, gain: 0.9 });
  playClick({ frequency: 2300, duration: 0.03, gain: 0.6, delay: 0.075 });
  vibrate(12);
}
