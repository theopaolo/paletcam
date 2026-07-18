const RANGE_INTERACTION_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

function queryById(root, id) {
  if (!id) {
    return null;
  }

  return root.querySelector(`#${id}`);
}

export function updateSliderShellTicks(shell, rangeInput) {
  if (!shell || !rangeInput) {
    return;
  }

  const minValue = Number(rangeInput.min) || 0;
  const maxValue = Number(rangeInput.max) || minValue;
  const stepValue = Number(rangeInput.step) || 1;
  const currentValue = Number(rangeInput.value) || minValue;
  const tickCount = Math.max(1, Math.floor((maxValue - minValue) / stepValue + Number.EPSILON) + 1);
  const tickIndex = Math.max(0, Math.floor((currentValue - minValue) / stepValue + Number.EPSILON));

  shell.style.setProperty("--tick-count", String(tickCount));
  shell.style.setProperty("--tick-index", String(tickIndex));
  shell.style.setProperty("--tick-intervals", String(Math.max(1, tickCount - 1)));
}

function isRangeInteractionKey(key) {
  return RANGE_INTERACTION_KEYS.has(key);
}

/**
 * @param {object} options
 * @param {ParentNode} options.root
 * @param {string} options.shellId
 * @param {string} options.inputId
 * @param {string} [options.inlineValueId]
 * @param {string} [options.displaySelector]
 * @param {(settings: AppSettings) => number} options.getValueFromSettings
 * @param {(value: number) => void} options.onValueInput
 * @param {() => void} options.onInteractionStart
 * @param {() => void} options.onInteractionCommit
 * @param {(value: number) => string} options.getAriaLabel
 * @param {(value: number) => string} [options.formatInlineValue]
 * @param {(value: number) => string} [options.formatDisplayValue]
 */
export function createRangeControl({
  root,
  shellId,
  inputId,
  inlineValueId,
  displaySelector,
  getValueFromSettings,
  onValueInput,
  onInteractionStart,
  onInteractionCommit,
  getAriaLabel,
  formatInlineValue = (value) => String(value),
  formatDisplayValue = formatInlineValue,
}) {
  const shell = queryById(root, shellId);
  const input = /** @type {HTMLInputElement | null} */ (queryById(root, inputId));
  const inlineValue = queryById(root, inlineValueId);
  const displayValue = displaySelector ? root.querySelector(displaySelector) : null;

  if (!input) {
    return null;
  }

  function renderFromSettings(settings) {
    const value = getValueFromSettings(settings);
    input.value = String(value);
    input.setAttribute("aria-label", getAriaLabel(value));
    if (inlineValue) {
      inlineValue.textContent = formatInlineValue(value);
    }
    if (displayValue) {
      displayValue.textContent = formatDisplayValue(value);
    }
    updateSliderShellTicks(shell, input);
  }

  function activate() {
    shell?.classList.add("is-active");
  }

  function deactivate() {
    shell?.classList.remove("is-active");
  }

  function bindEvents(on) {
    on(input, "input", () => {
      onValueInput?.(Number(input.value));
    });

    on(input, "pointerdown", () => {
      activate();
      onInteractionStart?.();
    });

    on(input, "pointerup", () => {
      deactivate();
      onInteractionCommit?.();
    });

    on(input, "pointercancel", () => {
      deactivate();
      onInteractionCommit?.();
    });

    on(input, "keydown", (event) => {
      if (!isRangeInteractionKey(event.key)) {
        return;
      }

      activate();
      onInteractionStart?.();
    });

    on(input, "keyup", (event) => {
      if (!isRangeInteractionKey(event.key)) {
        deactivate();
        return;
      }

      deactivate();
      onInteractionCommit?.();
    });

    on(input, "change", () => {
      deactivate();
      onInteractionCommit?.();
    });

    on(input, "blur", () => {
      deactivate();
      onInteractionCommit?.();
    });
  }

  return {
    bindEvents,
    renderFromSettings,
  };
}
