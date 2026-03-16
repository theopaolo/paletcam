const VISIBLE_SLIDE_AHEAD_COUNT = 2;
const PRELOAD_SLIDE_BEHIND_COUNT = 1;
const PRELOAD_SLIDE_AHEAD_COUNT = 2;
const EDGE_RESISTANCE_FACTOR = 0.35;
const GESTURE_LOCK_THRESHOLD = 12;

function isValidIndex(index, totalSlides) {
  return Number.isInteger(index) && index >= 0 && index < totalSlides;
}

function toSortedUniqueIndices(indices, totalSlides) {
  return [...new Set(indices.filter((index) => isValidIndex(index, totalSlides)))].sort(
    (leftIndex, rightIndex) => leftIndex - rightIndex,
  );
}

export function getViewerRenderIndices(activeIndex, totalSlides, previouslyRenderedIndices = []) {
  const indices = [...previouslyRenderedIndices];

  for (let offset = 0; offset <= VISIBLE_SLIDE_AHEAD_COUNT; offset += 1) {
    indices.push(activeIndex + offset);
  }

  return toSortedUniqueIndices(indices, totalSlides);
}

export function getViewerPreloadIndices(activeIndex, totalSlides) {
  const indices = [];

  for (
    let index = activeIndex - PRELOAD_SLIDE_BEHIND_COUNT;
    index <= activeIndex + PRELOAD_SLIDE_AHEAD_COUNT;
    index += 1
  ) {
    indices.push(index);
  }

  return toSortedUniqueIndices(indices, totalSlides);
}

export function getViewerGestureAxis(deltaX, deltaY) {
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);

  if (Math.max(absDeltaX, absDeltaY) < GESTURE_LOCK_THRESHOLD) {
    return "pending";
  }

  return absDeltaX >= absDeltaY ? "horizontal" : "vertical";
}

export function getViewerDragDelta(deltaX, activeIndex, totalSlides) {
  if (totalSlides <= 1) {
    return deltaX * EDGE_RESISTANCE_FACTOR;
  }

  if (activeIndex <= 0 && deltaX > 0) {
    return deltaX * EDGE_RESISTANCE_FACTOR;
  }

  if (activeIndex >= totalSlides - 1 && deltaX < 0) {
    return deltaX * EDGE_RESISTANCE_FACTOR;
  }

  return deltaX;
}

export function getViewerSlideLayout(relativeIndex, slideState, dragDelta = 0) {
  const { offsetX = 0, offsetY = 0, rotation = 0 } = slideState ?? {};

  if (relativeIndex === 0) {
    const dragRotation = dragDelta === 0 ? 0 : Number(((dragDelta / 200) * 3).toFixed(3));
    return {
      pointerEvents: "auto",
      rotate: `${dragRotation}deg`,
      transform: `translate3d(${dragDelta + offsetX}px, ${offsetY}px, 0) scale(1)`,
      zIndex: "100",
    };
  }

  if (relativeIndex === 1) {
    return {
      pointerEvents: "none",
      rotate: `${rotation}deg`,
      transform: `translate3d(${offsetX}px, ${6 + offsetY}px, 0) scale(0.97)`,
      zIndex: "90",
    };
  }

  if (relativeIndex === 2) {
    return {
      pointerEvents: "none",
      rotate: `${rotation}deg`,
      transform: `translate3d(${offsetX}px, ${12 + offsetY}px, 0) scale(0.94)`,
      zIndex: "80",
    };
  }

  return {
    pointerEvents: "none",
    rotate: `${rotation}deg`,
    transform: `translate3d(${offsetX}px, ${20 + offsetY}px, 0) scale(0.90)`,
    zIndex: "0",
  };
}
