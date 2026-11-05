import { getCommunityAccessToken, subscribeCommunitySession } from "../../community-session.js";

/**
 * Keeps an element's `is-signed-in` class in step with the community session,
 * so a small LED on it can report "you are connected" (see buttons.css).
 *
 * @param {Element | null} element
 * @param {object} [options]
 * @param {() => string} [options.getToken]
 * @param {(listener: () => void) => () => void} [options.subscribeSession]
 * @returns {() => void} Stops following the session.
 */
export function bindSignedInIndicator(
  element,
  { getToken = getCommunityAccessToken, subscribeSession = subscribeCommunitySession } = {},
) {
  if (!element) {
    return () => {};
  }

  const paint = () => element.classList.toggle("is-signed-in", Boolean(getToken()));
  paint();
  return subscribeSession(paint);
}
