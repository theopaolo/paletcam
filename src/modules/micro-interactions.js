const DEFAULT_CAPTURE_POP_MS = 170;
const DEFAULT_CAPTURE_FLASH_MS = 120;

export function createCaptureMicroInteractions({
  captureButton,
  captureContainer,
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

    captureButton.classList.remove('is-pop');
    void captureButton.offsetWidth;
    captureButton.classList.add('is-pop');

    if (capturePopTimeout) {
      window.clearTimeout(capturePopTimeout);
    }

    capturePopTimeout = window.setTimeout(() => {
      captureButton.classList.remove('is-pop');
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

    const nextFlashElement = document.createElement('div');
    nextFlashElement.className = 'capture-flash';
    captureContainer.appendChild(nextFlashElement);
    captureFlashElement = nextFlashElement;

    return captureFlashElement;
  }

  function triggerCaptureFlash() {
    const flashElement = ensureCaptureFlashElement();
    if (!flashElement) {
      return;
    }

    flashElement.classList.remove('is-active');
    void flashElement.offsetWidth;
    flashElement.classList.add('is-active');

    if (captureFlashTimeout) {
      window.clearTimeout(captureFlashTimeout);
    }

    captureFlashTimeout = window.setTimeout(() => {
      flashElement.classList.remove('is-active');
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

    captureButton?.classList.remove('is-pop');
    captureFlashElement?.classList.remove('is-active');
  }

  return {
    cleanup,
    pulseCaptureButton,
    triggerCaptureFlash,
  };
}
