export function createSwipeController({
  card,
  track,
  leftActionWidth,
  rightActionWidth,
  swipeStartThreshold,
  swipeOpenRatio,
  magneticSnapResetMs,
  triggerHapticTick,
  getActiveController,
  closeActiveController,
  setActiveController,
  clearActiveController,
}) {
  let currentOffset = 0;
  let pointerId;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let gestureAxis;
  let movedHorizontally = false;
  let hasTickedDeleteThreshold = false;
  let magneticSnapTimeout = 0;
  let controller;

  function applyOffset(nextOffset, shouldAnimate) {
    const clampedOffset = Math.min(
      leftActionWidth,
      Math.max(-rightActionWidth, nextOffset),
    );
    currentOffset = clampedOffset;

    track.style.transform = `translateX(${clampedOffset}px)`;
    card.classList.toggle("is-open-left", clampedOffset > 0);
    card.classList.toggle("is-open-right", clampedOffset < 0);
    card.classList.toggle("is-dragging", !shouldAnimate);
  }

  function snapTo(nextOffset) {
    if (magneticSnapTimeout) {
      window.clearTimeout(magneticSnapTimeout);
      magneticSnapTimeout = 0;
    }

    card.classList.toggle("is-snapping-open", nextOffset !== 0);
    applyOffset(nextOffset, true);

    if (nextOffset === 0) {
      clearActiveController(controller);
      return;
    }

    magneticSnapTimeout = window.setTimeout(() => {
      card.classList.remove("is-snapping-open");
      magneticSnapTimeout = 0;
    }, magneticSnapResetMs);

    setActiveController(controller);
  }

  controller = {
    card,
    close() {
      snapTo(0);
    },
    isOpen() {
      return currentOffset !== 0;
    },
  };

  track.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const activeController = getActiveController();
    if (activeController && activeController !== controller) {
      closeActiveController();
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startOffset = currentOffset;
    gestureAxis = undefined;
    movedHorizontally = false;
    hasTickedDeleteThreshold = false;
    track.setPointerCapture(pointerId);
  });

  track.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!gestureAxis) {
      const totalX = Math.abs(deltaX);
      const totalY = Math.abs(deltaY);

      if (totalX < swipeStartThreshold && totalY < swipeStartThreshold) {
        return;
      }

      gestureAxis = totalX > totalY ? "x" : "y";
    }

    if (gestureAxis !== "x") {
      return;
    }

    movedHorizontally = true;
    event.preventDefault();
    applyOffset(startOffset + deltaX, false);

    const openRightThreshold = -rightActionWidth * swipeOpenRatio;
    if (currentOffset <= openRightThreshold && !hasTickedDeleteThreshold) {
      triggerHapticTick();
      hasTickedDeleteThreshold = true;
    }
  });

  function releasePointer(event) {
    if (event.pointerId !== pointerId) {
      return;
    }

    if (track.hasPointerCapture(pointerId)) {
      track.releasePointerCapture(pointerId);
    }

    pointerId = undefined;

    if (gestureAxis !== "x" || !movedHorizontally) {
      card.classList.remove("is-dragging");
      return;
    }

    const openLeftThreshold = leftActionWidth * swipeOpenRatio;
    const openRightThreshold = -rightActionWidth * swipeOpenRatio;

    if (currentOffset >= openLeftThreshold) {
      snapTo(leftActionWidth);
      return;
    }

    if (currentOffset <= openRightThreshold) {
      if (!hasTickedDeleteThreshold) {
        triggerHapticTick();
      }
      snapTo(-rightActionWidth);
      return;
    }

    snapTo(0);
  }

  track.addEventListener("pointerup", releasePointer);
  track.addEventListener("pointercancel", releasePointer);
  track.addEventListener(
    "click",
    (event) => {
      if (!controller.isOpen()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      controller.close();
    },
    true,
  );

  return controller;
}
