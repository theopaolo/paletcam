/**
 * Synthesized mechanical feedback for camera-style controls: short WebAudio
 * blips plus vibration where the platform exposes it (Android; iOS PWAs have
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

function playBlip({ frequency, duration, peakGain, type }) {
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function vibrate(pattern) {
  globalThis.navigator?.vibrate?.(pattern);
}

/** One detent crossed: tiny high click + micro vibration. */
export function detentFeedback() {
  playBlip({ frequency: 2100, duration: 0.016, peakGain: 0.06, type: "square" });
  vibrate(8);
}

/** Hit an end stop: duller thunk + firmer vibration. */
export function boundaryFeedback() {
  playBlip({ frequency: 140, duration: 0.05, peakGain: 0.1, type: "sine" });
  vibrate(24);
}

/** Shutter pressed: a slightly rounder blip than the detent tick. */
export function shutterFeedback() {
  playBlip({ frequency: 1300, duration: 0.035, peakGain: 0.16, type: "triangle" });
  vibrate(12);
}
