const HAPTIC_DURATION_MS = 10;

export function clampValue(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

/**
 * Shared value engine for the camera scrubbers (zoom, exposure).
 *
 * Owns what the two overlays used to duplicate: capability clamping and
 * quantization, the optimistic apply flow (display immediately, roll back to
 * the last applied value if the camera rejects it), and boundary-haptic
 * dedup. Presentation stays in the UI module, which receives every value
 * change through onDisplay.
 *
 * @param {object} options
 * @param {number} options.defaultStep Step used when capabilities carry none.
 * @param {{min: number, max: number}} [options.fallbackRange]
 *   Range reported while no capabilities are known (zoom rests at 1x).
 * @param {(range: {min: number, max: number}) => number} options.getDefaultValue
 *   Resting value inside a range (zoom: 1x, exposure: 0 EV).
 * @param {(value: number, step: number) => string | null} options.getBoundaryKey
 *   Names the haptic boundary a value sits on, or null between boundaries.
 * @param {(value: number) => Promise<boolean | undefined>} options.applyToCamera
 * @param {(value: number, meta: {isConfirmed: boolean}) => void} options.onDisplay
 */
export function createScrubberValue({
  defaultStep,
  fallbackRange = { min: 0, max: 0 },
  getDefaultValue,
  getBoundaryKey,
  applyToCamera,
  onDisplay,
}) {
  let capabilities = null;
  let currentValue = 0;
  let lastAppliedValue = null;
  let pendingValue = null;
  let lastBoundaryKey = null;

  function getStep() {
    const stepValue = Number(capabilities?.step);
    return Number.isFinite(stepValue) && stepValue > 0 ? stepValue : defaultStep;
  }

  function getRange() {
    const minValue = Number(capabilities?.min);
    const maxValue = Number(capabilities?.max);

    return {
      min: Number.isFinite(minValue) ? minValue : fallbackRange.min,
      max: Number.isFinite(maxValue) ? maxValue : fallbackRange.max,
    };
  }

  function clampToRange(value) {
    const { min, max } = getRange();
    return clampValue(value, min, max);
  }

  function quantize(value) {
    const { min } = getRange();
    const step = getStep();
    return clampToRange(min + Math.round((value - min) / step) * step);
  }

  function display(value, { isConfirmed = false } = {}) {
    currentValue = clampToRange(value);

    if (isConfirmed) {
      lastAppliedValue = currentValue;
      pendingValue = null;
    }

    onDisplay(currentValue, { isConfirmed });
  }

  function emitBoundaryHaptic(value) {
    const boundaryKey = getBoundaryKey(value, getStep());

    if (!boundaryKey) {
      lastBoundaryKey = null;
      return;
    }

    if (boundaryKey === lastBoundaryKey) {
      return;
    }

    lastBoundaryKey = boundaryKey;
    globalThis.navigator?.vibrate?.(HAPTIC_DURATION_MS);
  }

  async function apply(value) {
    const nextValue = quantize(value);

    if (nextValue === pendingValue) {
      display(nextValue);
      return;
    }

    if (pendingValue === null && nextValue === lastAppliedValue) {
      display(nextValue, { isConfirmed: true });
      return;
    }

    display(nextValue);
    emitBoundaryHaptic(nextValue);
    pendingValue = nextValue;
    let applySucceeded = false;

    try {
      applySucceeded = (await applyToCamera(nextValue)) === true;
    } catch {
      applySucceeded = false;
    }

    if (!applySucceeded && pendingValue === nextValue) {
      display(lastAppliedValue ?? getDefaultValue(getRange()), { isConfirmed: true });
    }
  }

  return {
    apply,
    clampToRange,
    confirm(value) {
      display(value, { isConfirmed: true });
    },
    getDefaultValue: () => getDefaultValue(getRange()),
    getRange,
    getStep,
    quantize,
    reset() {
      pendingValue = null;
    },
    setCapabilities(nextCapabilities) {
      capabilities = nextCapabilities;
      if (!nextCapabilities) {
        pendingValue = null;
      }
    },
    get value() {
      return currentValue;
    },
  };
}
