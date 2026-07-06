export function cloneAlgorithmSettings(settings) {
  return {
    paletteSelector: settings?.paletteSelector ?? "current",
    medianCut: {
      quantizedPoolSize: settings?.medianCut?.quantizedPoolSize ?? 0,
      maxQuantizerPixels: settings?.medianCut?.maxQuantizerPixels ?? 0,
    },
    paletteScoring: {
      chromaWeight: settings?.paletteScoring?.chromaWeight ?? 0,
      lumaSpreadWeight: settings?.paletteScoring?.lumaSpreadWeight ?? 0,
      rarityWeight: settings?.paletteScoring?.rarityWeight ?? 0,
      diversityWeight: settings?.paletteScoring?.diversityWeight ?? 0,
    },
    hybrid: {
      repulsionRadius: settings?.hybrid?.repulsionRadius ?? 0,
      spreadStrength: settings?.hybrid?.spreadStrength ?? 0,
      rarityStrength: settings?.hybrid?.rarityStrength ?? 0,
      tone: settings?.hybrid?.tone ?? 0,
      loyaltyStrength: settings?.hybrid?.loyaltyStrength ?? 0,
    },
  };
}

export function areAlgorithmSettingsEqual(firstSettings, secondSettings) {
  return (
    firstSettings.paletteSelector === secondSettings.paletteSelector &&
    firstSettings.medianCut.quantizedPoolSize === secondSettings.medianCut.quantizedPoolSize &&
    firstSettings.medianCut.maxQuantizerPixels === secondSettings.medianCut.maxQuantizerPixels &&
    firstSettings.paletteScoring.chromaWeight === secondSettings.paletteScoring.chromaWeight &&
    firstSettings.paletteScoring.lumaSpreadWeight ===
      secondSettings.paletteScoring.lumaSpreadWeight &&
    firstSettings.paletteScoring.rarityWeight === secondSettings.paletteScoring.rarityWeight &&
    firstSettings.paletteScoring.diversityWeight ===
      secondSettings.paletteScoring.diversityWeight &&
    firstSettings.hybrid.repulsionRadius === secondSettings.hybrid.repulsionRadius &&
    firstSettings.hybrid.spreadStrength === secondSettings.hybrid.spreadStrength &&
    firstSettings.hybrid.rarityStrength === secondSettings.hybrid.rarityStrength &&
    firstSettings.hybrid.tone === secondSettings.hybrid.tone &&
    firstSettings.hybrid.loyaltyStrength === secondSettings.hybrid.loyaltyStrength
  );
}
