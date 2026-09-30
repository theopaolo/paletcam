const DEFAULT_CAPTURE_POP_MS = 170;
const DEFAULT_CAPTURE_FLASH_MS = 250;
const PALETTE_FLIGHT_MS = 460;
const THUMBNAIL_POP_MS = 220;

/**
 * @param {object} [options]
 * @param {HTMLElement | null} [options.captureButton]
 * @param {HTMLElement | null} [options.captureContainer]
 * @param {HTMLElement | null} [options.paletteSource] The live palette strip the flight starts from.
 * @param {HTMLElement | null} [options.thumbnailTarget] The last-catch thumbnail it lands in.
 * @param {number} [options.capturePopMs]
 * @param {number} [options.captureFlashMs]
 * @returns {CaptureMicroInteractions}
 */
export function createCaptureMicroInteractions({
  captureButton,
  captureContainer,
  paletteSource = null,
  thumbnailTarget = null,
  capturePopMs = DEFAULT_CAPTURE_POP_MS,
  captureFlashMs = DEFAULT_CAPTURE_FLASH_MS,
} = {}) {
  let captureFlashElement = null;
  let capturePopTimeout = 0;
  let captureFlashTimeout = 0;

  function pulseCaptureButton() {
    if (!captureButton) {
      return;
    }

    captureButton.classList.remove("is-pop");
    void captureButton.offsetWidth;
    captureButton.classList.add("is-pop");

    if (capturePopTimeout) {
      window.clearTimeout(capturePopTimeout);
    }

    capturePopTimeout = window.setTimeout(() => {
      captureButton.classList.remove("is-pop");
      capturePopTimeout = 0;
    }, capturePopMs);
  }

  function ensureCaptureFlashElement() {
    if (!captureContainer) {
      return null;
    }

    if (captureFlashElement?.isConnected) {
      return captureFlashElement;
    }

    const nextFlashElement = document.createElement("div");
    nextFlashElement.className = "capture-flash";
    captureContainer.appendChild(nextFlashElement);
    captureFlashElement = nextFlashElement;

    return captureFlashElement;
  }

  function triggerCaptureFlash() {
    const flashElement = ensureCaptureFlashElement();
    if (!flashElement) {
      return;
    }

    flashElement.classList.remove("is-active");
    void flashElement.offsetWidth;
    flashElement.classList.add("is-active");

    if (captureFlashTimeout) {
      window.clearTimeout(captureFlashTimeout);
    }

    captureFlashTimeout = window.setTimeout(() => {
      flashElement.classList.remove("is-active");
      captureFlashTimeout = 0;
    }, captureFlashMs);
  }

  function cleanup() {
    if (capturePopTimeout) {
      window.clearTimeout(capturePopTimeout);
      capturePopTimeout = 0;
    }

    if (captureFlashTimeout) {
      window.clearTimeout(captureFlashTimeout);
      captureFlashTimeout = 0;
    }

    captureButton?.classList.remove("is-pop");
    captureFlashElement?.classList.remove("is-active");
  }

  /**
   * The caught palette shrinks from the strip into the thumbnail. Skipped when
   * either end is hidden (RAL mode hides the strip) or motion is reduced.
   * @param {{ r: number, g: number, b: number }[]} colors
   */
  function flyPaletteToThumbnail(colors) {
    const from = paletteSource?.getBoundingClientRect();
    const to = thumbnailTarget?.getBoundingClientRect();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!from || !to || from.width <= 0 || to.width <= 0 || colors.length === 0 || reduced) {
      return;
    }

    const flight = document.createElement("div");
    flight.className = "palette-flight";
    for (const { r, g, b } of colors) {
      const swatch = document.createElement("i");
      swatch.style.backgroundColor = `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
      flight.append(swatch);
    }
    Object.assign(flight.style, {
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
    });
    document.body.append(flight);

    const target = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`;
    const animation = flight.animate([{ transform: "none" }, { transform: target }], {
      duration: PALETTE_FLIGHT_MS,
      easing: "cubic-bezier(0.55, 0, 0.2, 1)",
    });
    animation.onfinish = () => {
      flight.remove();
      thumbnailTarget?.animate?.(
        [{ transform: "scale(1)" }, { transform: "scale(1.1)" }, { transform: "scale(1)" }],
        { duration: THUMBNAIL_POP_MS, easing: "ease-out" },
      );
    };
    animation.oncancel = () => flight.remove();
  }

  return {
    cleanup,
    flyPaletteToThumbnail,
    pulseCaptureButton,
    triggerCaptureFlash,
  };
}
