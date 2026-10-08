/**
 * Footer variants under test on preprod: the shutter face, the color-count
 * control, the tuning panel in the tray and the look control on its levers. The choice is stored per device; the switches only render in debug
 * builds (see config-panel.js), so production always runs the defaults.
 */

const STORAGE_KEY = "paletcam.footerLab";

export const FOOTER_LAB_OPTIONS = Object.freeze({
  shutter: Object.freeze(["titanium", "flat", "logo"]),
  count: Object.freeze(["dial", "numbered", "adj", "drum", "shutter", "tray"]),
  panel: Object.freeze(["arc", "thin", "rails", "drums"]),
  look: Object.freeze(["lever", "keys", "prism"]),
});

/* Théo's pick after the phone tests: flat iris, M's drums, prism look; the count
   now tried as a sideways drum in the tray, off the shutter. */
const DEFAULT_FOOTER_LAB = Object.freeze({
  shutter: "flat",
  count: "tray",
  panel: "drums",
  look: "prism",
});

/** @typedef {{ shutter: string, count: string, panel: string, look: string }} FooterLab */

/** @param {Partial<FooterLab> | null | undefined} candidate @returns {FooterLab} */
function normalizeFooterLab(candidate) {
  return {
    shutter: FOOTER_LAB_OPTIONS.shutter.includes(candidate?.shutter ?? "")
      ? /** @type {string} */ (candidate?.shutter)
      : DEFAULT_FOOTER_LAB.shutter,
    count: FOOTER_LAB_OPTIONS.count.includes(candidate?.count ?? "")
      ? /** @type {string} */ (candidate?.count)
      : DEFAULT_FOOTER_LAB.count,
    panel: FOOTER_LAB_OPTIONS.panel.includes(candidate?.panel ?? "")
      ? /** @type {string} */ (candidate?.panel)
      : DEFAULT_FOOTER_LAB.panel,
    look: FOOTER_LAB_OPTIONS.look.includes(candidate?.look ?? "")
      ? /** @type {string} */ (candidate?.look)
      : DEFAULT_FOOTER_LAB.look,
  };
}

function loadFooterLab() {
  try {
    return normalizeFooterLab(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_FOOTER_LAB };
  }
}

let currentFooterLab = loadFooterLab();
/** @type {Set<(lab: FooterLab) => void>} */
const listeners = new Set();

/** @returns {FooterLab} */
export function getFooterLab() {
  return currentFooterLab;
}

/** @param {Partial<FooterLab>} patch */
export function setFooterLab(patch) {
  currentFooterLab = normalizeFooterLab({ ...currentFooterLab, ...patch });
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(currentFooterLab));
  } catch {
    /* private mode or full storage: the choice lasts for this session only */
  }
  for (const listener of listeners) {
    listener(currentFooterLab);
  }
}

/** @param {(lab: FooterLab) => void} listener @returns {() => void} */
export function subscribeFooterLab(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
