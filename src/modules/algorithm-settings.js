export function cloneAlgorithmSettings(settings) {
  return {
    medianCut: {
      quantizedPoolSize: settings?.medianCut?.quantizedPoolSize ?? 0,
      maxQuantizerPixels: settings?.medianCut?.maxQuantizerPixels ?? 0,
    },
    hybrid: {
      repulsionRadius: settings?.hybrid?.repulsionRadius ?? 0,
      spreadStrength: settings?.hybrid?.spreadStrength ?? 0,
      rarityStrength: settings?.hybrid?.rarityStrength ?? 0,
      tone: settings?.hybrid?.tone ?? 0,
      neutralBalance: settings?.hybrid?.neutralBalance ?? "balanced",
      loyaltyStrength: settings?.hybrid?.loyaltyStrength ?? 0,
    },
  };
}

export function areAlgorithmSettingsEqual(firstSettings, secondSettings) {
  return (
    firstSettings.medianCut.quantizedPoolSize === secondSettings.medianCut.quantizedPoolSize &&
    firstSettings.medianCut.maxQuantizerPixels === secondSettings.medianCut.maxQuantizerPixels &&
    firstSettings.hybrid.repulsionRadius === secondSettings.hybrid.repulsionRadius &&
    firstSettings.hybrid.spreadStrength === secondSettings.hybrid.spreadStrength &&
    firstSettings.hybrid.rarityStrength === secondSettings.hybrid.rarityStrength &&
    firstSettings.hybrid.tone === secondSettings.hybrid.tone &&
    firstSettings.hybrid.neutralBalance === secondSettings.hybrid.neutralBalance &&
    firstSettings.hybrid.loyaltyStrength === secondSettings.hybrid.loyaltyStrength
  );
}
