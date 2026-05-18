const DEFAULT_POPOVER_MARGIN = 8;
const DEFAULT_POPOVER_WIDTH = 170;

export function computeRalPopoverPosition(
  anchorRect,
  popoverRect,
  viewportWidth,
  margin = DEFAULT_POPOVER_MARGIN,
) {
  const width = popoverRect?.width || DEFAULT_POPOVER_WIDTH;
  const height = popoverRect?.height || 0;
  let left = anchorRect.left + (anchorRect.width / 2) - (width / 2);
  let top = anchorRect.top - height - margin;

  if (top < margin) {
    top = anchorRect.bottom + margin;
  }

  left = Math.max(margin, Math.min(left, viewportWidth - width - margin));

  return { left, top };
}
