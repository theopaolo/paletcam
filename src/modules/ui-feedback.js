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
 * Higher bands read as small detents, lower ones as heavier parts.
 */
function playClick({ frequency, duration, gain, delay = 0 }) {
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
  filter.frequency.value = frequency;
  filter.Q.value = 1.4;
  const amplifier = audioContext.createGain();
  amplifier.gain.value = gain;
  source.connect(filter).connect(amplifier).connect(audioContext.destination);
  source.start(audioContext.currentTime + delay);
}

function vibrate(pattern) {
  globalThis.navigator?.vibrate?.(pattern);
}

/** One detent crossed: tiny high click + micro vibration. */
export function detentFeedback() {
  playClick({ frequency: 3400, duration: 0.012, gain: 0.5 });
  vibrate(8);
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
