/**
 * A catch from the community feed, dressed as a palette so the gallery cards,
 * the views and the viewer that draw the personal collection draw it too.
 * Everything a card reads is there (`id`, `timestamp`, `colors`); what only
 * the feed knows rides along under `community`.
 *
 * @param {CommunityFeedItem} item
 * @returns {Palette}
 */
export function toCommunityPalette(item) {
  return /** @type {Palette} */ (
    /** @type {unknown} */ ({
      id: item.id,
      timestamp: item.caughtAt,
      colors: item.colors.map(hexToRgb),
      community: {
        userName: item.userName,
        polaroidUrl: item.polaroidUrl,
        squareUrl: item.squareUrl,
        url: item.url,
      },
    })
  );
}

/** @param {string} hex `#rrggbb`, which the feed contract guarantees. */
export function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/**
 * The preview the cards and the viewer ask for: the feed hands over a URL the
 * browser fetches, never pixels.
 * @param {Palette} palette
 */
export function getCommunityPreviewAsset(palette) {
  const url = /** @type {{ community?: { polaroidUrl?: string } }} */ (palette).community
    ?.polaroidUrl;
  return url ? Promise.resolve({ url }) : Promise.reject(new Error("Missing community picture"));
}
