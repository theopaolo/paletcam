/** @typedef {{r: number, g: number, b: number, population?: number}} MarkerColor */
/** @typedef {{x: number, y: number}} MarkerPosition */
/**
 * @typedef {{
 *   x: number,
 *   y: number,
 *   color: MarkerColor,
 *   label: string | number,
 *   slot?: number,
 *   frozen?: boolean,
 *   clamp?: boolean,
 *   rotation?: number,
 *   scale?: number,
 *   alpha?: number,
 * }} OriginMarker
 */
/** @typedef {{color: MarkerColor, position: MarkerPosition | null}} FrozenMarker */
/** @typedef {{slot: number, entry: FrozenMarker}} ReleasedMarker */
/**
 * @typedef {{
 *   x: number,
 *   y: number,
 *   color: MarkerColor,
 *   label: string | number,
 *   horizontalVelocity: number,
 *   startedAt: number,
 * }} FallingBadge
 */

const ORIGIN_MARKER_SMOOTHING_FACTOR = 0.1;
const BADGE_FALL_HOP_VELOCITY = -140;
const BADGE_FALL_GRAVITY = 1400;
const BADGE_FALL_MAX_DURATION_MS = 1400;
const BADGE_POP_DURATION_MS = 350;

/** @param {number} progress */
function easeOutBack(progress) {
  const overshoot = 1.70158;
  const p = progress - 1;
  return 1 + (overshoot + 1) * p * p * p + overshoot * p * p;
}

/**
 * Stateful, browser-free model for live origin badges. It owns normalized
 * positions and animation state, but it does not draw, vibrate, or decide
 * whether frozen pins should be released.
 *
 * @param {{
 *   findNearestColor(
 *     color: MarkerColor,
 *     candidates: MarkerColor[],
 *   ): {index: number} | null,
 *   hitTestMarkers(
 *     markers: OriginMarker[],
 *     tapX: number,
 *     tapY: number,
 *     width: number,
 *     height: number,
 *   ): number,
 *   now(): number,
 *   random(): number,
 * }} dependencies
 */
export function createLivePreviewOriginMarkerModel({
  findNearestColor,
  hitTestMarkers,
  now,
  random,
}) {
  /** @type {Array<MarkerPosition | null>} */
  let smoothedMarkerPositions = [];
  /** @type {OriginMarker[]} */
  let lastRenderedMarkers = [];
  /** @type {number[]} */
  let markerBornAt = [];
  /** @type {FallingBadge[]} */
  let fallingBadges = [];

  function reset() {
    smoothedMarkerPositions = [];
    lastRenderedMarkers = [];
    markerBornAt = [];
    fallingBadges = [];
  }

  function hasActivity() {
    return lastRenderedMarkers.length > 0 || fallingBadges.length > 0;
  }

  /**
   * @param {ReleasedMarker[]} released
   * @param {{animate?: boolean}} [options]
   */
  function handleReleased(released, { animate = false } = {}) {
    for (const { slot, entry } of released) {
      if (animate && entry.position) {
        fallingBadges.push({
          x: entry.position.x,
          y: entry.position.y,
          color: entry.color,
          label: slot + 1,
          horizontalVelocity: (random() - 0.5) * 160,
          startedAt: now(),
        });
      }
      smoothedMarkerPositions[slot] = null;
      markerBornAt[slot] = 0;
    }
  }

  /**
   * @param {number} frameNow
   * @param {number} frameWidth
   * @param {number} frameHeight
   * @returns {OriginMarker[]}
   */
  function buildFallingBadgeMarkers(frameNow, frameWidth, frameHeight) {
    if (fallingBadges.length === 0) {
      return [];
    }

    /** @type {OriginMarker[]} */
    const markers = [];
    fallingBadges = fallingBadges.filter((badge) => {
      const elapsedSeconds = (frameNow - badge.startedAt) / 1000;
      if (frameNow - badge.startedAt > BADGE_FALL_MAX_DURATION_MS) {
        return false;
      }

      const dropPx =
        BADGE_FALL_HOP_VELOCITY * elapsedSeconds +
        0.5 * BADGE_FALL_GRAVITY * elapsedSeconds * elapsedSeconds;
      const y = badge.y + dropPx / frameHeight;
      if (y * frameHeight > frameHeight + 24) {
        return false;
      }

      markers.push({
        x: badge.x + (badge.horizontalVelocity * elapsedSeconds) / frameWidth,
        y,
        color: badge.color,
        label: badge.label,
        frozen: true,
        clamp: false,
        rotation: badge.horizontalVelocity * elapsedSeconds * 0.02,
        alpha: 1 - (frameNow - badge.startedAt) / BADGE_FALL_MAX_DURATION_MS,
      });
      return true;
    });

    return markers;
  }

  /**
   * @param {{
   *   displayColors: MarkerColor[],
   *   rawColors: MarkerColor[],
   *   origins: Array<MarkerPosition | null>,
   *   frozenBySlot: Array<FrozenMarker | null | undefined>,
   *   frameWidth: number,
   *   frameHeight: number,
   * }} frame
   * @returns {OriginMarker[]}
   */
  function build({ displayColors, rawColors, origins, frozenBySlot, frameWidth, frameHeight }) {
    const frameNow = now();
    /** @type {OriginMarker[]} */
    const markers = [];

    for (let slot = 0; slot < displayColors.length; slot += 1) {
      const displayColor = displayColors[slot];
      const frozenEntry = frozenBySlot[slot];

      if (frozenEntry) {
        smoothedMarkerPositions[slot] = frozenEntry.position ? { ...frozenEntry.position } : null;
        if (frozenEntry.position) {
          markers.push({
            x: frozenEntry.position.x,
            y: frozenEntry.position.y,
            color: frozenEntry.color,
            label: slot + 1,
            slot,
            frozen: true,
          });
        }
        continue;
      }

      const nearestRaw = findNearestColor(displayColor, rawColors);
      const targetOrigin = nearestRaw ? origins[nearestRaw.index] : null;
      if (!targetOrigin) {
        smoothedMarkerPositions[slot] = null;
        continue;
      }

      const previousPosition = smoothedMarkerPositions[slot];
      if (!previousPosition) {
        markerBornAt[slot] = frameNow;
      }
      const nextPosition = previousPosition
        ? {
            x:
              previousPosition.x +
              (targetOrigin.x - previousPosition.x) * ORIGIN_MARKER_SMOOTHING_FACTOR,
            y:
              previousPosition.y +
              (targetOrigin.y - previousPosition.y) * ORIGIN_MARKER_SMOOTHING_FACTOR,
          }
        : { x: targetOrigin.x, y: targetOrigin.y };

      const popProgress = Math.min(
        1,
        (frameNow - (markerBornAt[slot] ?? 0)) / BADGE_POP_DURATION_MS,
      );

      smoothedMarkerPositions[slot] = nextPosition;
      markers.push({
        x: nextPosition.x,
        y: nextPosition.y,
        color: displayColor,
        label: slot + 1,
        slot,
        scale: popProgress < 1 ? easeOutBack(popProgress) : 1,
      });
    }

    smoothedMarkerPositions.length = displayColors.length;
    markerBornAt.length = displayColors.length;
    lastRenderedMarkers = markers;

    return [...markers, ...buildFallingBadgeMarkers(frameNow, frameWidth, frameHeight)];
  }

  /** @param {number} slot @returns {MarkerPosition | null} */
  function getPosition(slot) {
    const position = smoothedMarkerPositions[slot];
    return position ? { ...position } : null;
  }

  /**
   * @param {{
   *   normalizedX: number,
   *   normalizedY: number,
   *   frameWidth: number,
   *   frameHeight: number,
   * }} point
   */
  function hitTestAt({ normalizedX, normalizedY, frameWidth, frameHeight }) {
    if (lastRenderedMarkers.length === 0) {
      return -1;
    }

    return hitTestMarkers(
      lastRenderedMarkers,
      normalizedX * frameWidth,
      normalizedY * frameHeight,
      frameWidth,
      frameHeight,
    );
  }

  return {
    build,
    getPosition,
    handleReleased,
    hasActivity,
    hitTestAt,
    reset,
  };
}
