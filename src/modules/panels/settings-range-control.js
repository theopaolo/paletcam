import { getIntlLocale } from "../../i18n.js";

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

export function clampInteger(value, fallbackValue) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallbackValue;
  }

  return Math.round(numericValue);
}

export function formatThousands(value) {
  return new Intl.NumberFormat(getIntlLocale()).format(clampInteger(value, 0));
}

export function formatCompactThousands(value) {
  const safeValue = clampInteger(value, 0);
  if (safeValue >= 1000) {
    return `${Math.round(safeValue / 1000)}k`;
  }

  return String(safeValue);
}

export function formatScaleValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(1);
}

export function updateSliderShellTicks(shell, rangeInput) {
  if (!shell || !rangeInput) {
    return;
  }

  const minValue = Number(rangeInput.min) || 0;
  const maxValue = Number(rangeInput.max) || minValue;
  const stepValue = Number(rangeInput.step) || 1;
  const currentValue = Number(rangeInput.value) || minValue;
  const tickCount =
    Math.max(1, Math.floor((maxValue - minValue) / stepValue + Number.EPSILON) + 1);
  const tickIndex =
    Math.max(0, Math.floor((currentValue - minValue) / stepValue + Number.EPSILON));

  shell.style.setProperty("--tick-count", String(tickCount));
  shell.style.setProperty("--tick-index", String(tickIndex));
  shell.style.setProperty("--tick-intervals", String(Math.max(1, tickCount - 1)));
}

function isRangeInteractionKey(key) {
  return RANGE_INTERACTION_KEYS.has(key);
}

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
  inputValueFromSettings = (value) => value,
  settingValueFromInput = (value) => value,
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
    const settingValue = getValueFromSettings(settings);
    const inputValue = inputValueFromSettings(settingValue);
    input.value = String(inputValue);
    input.setAttribute("aria-label", getAriaLabel(inputValue));
    if (inlineValue) {
      inlineValue.textContent = formatInlineValue(inputValue);
    }
    if (displayValue) {
      displayValue.textContent = formatDisplayValue(inputValue);
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
      onValueInput?.(settingValueFromInput(Number(input.value)));
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
