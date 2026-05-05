const CONFIG_PRESET_DEFINITIONS = [
  {
    id: "balanced",
    labelKey: "config.presets.balanced",
    paletteScoring: {
      chromaWeight: 25,
      lumaSpreadWeight: 15,
      rarityWeight: 20,
      diversityWeight: 40,
    },
  },
  {
    id: "vivid",
    labelKey: "config.presets.vivid",
    paletteScoring: {
      chromaWeight: 55,
      lumaSpreadWeight: 5,
      rarityWeight: 10,
      diversityWeight: 30,
    },
  },
  {
    id: "dynamic",
    labelKey: "config.presets.dynamic",
    paletteScoring: {
      chromaWeight: 35,
      lumaSpreadWeight: 20,
      rarityWeight: 5,
      diversityWeight: 40,
    },
  },
  {
    id: "subtle",
    labelKey: "config.presets.subtle",
    paletteScoring: {
      chromaWeight: 25,
      lumaSpreadWeight: 5,
      rarityWeight: 5,
      diversityWeight: 15,
    },
  },
  {
    id: "rare",
    labelKey: "config.presets.rare",
    paletteScoring: {
      chromaWeight: 20,
      lumaSpreadWeight: 10,
      rarityWeight: 50,
      diversityWeight: 20,
    },
  },
];

export const CONFIG_PANEL_PRESETS = Object.freeze(
  CONFIG_PRESET_DEFINITIONS.map((preset) =>
    Object.freeze({
      ...preset,
      paletteScoring: Object.freeze({ ...preset.paletteScoring }),
    }),
  ),
);

export function findMatchingConfigPresetId(settings) {
  const scoring = settings?.paletteScoring;
  if (!scoring) {
    return null;
  }

  const preset = CONFIG_PANEL_PRESETS.find(
    ({ paletteScoring }) =>
      paletteScoring.chromaWeight === scoring.chromaWeight &&
      paletteScoring.lumaSpreadWeight === scoring.lumaSpreadWeight &&
      paletteScoring.rarityWeight === scoring.rarityWeight &&
      paletteScoring.diversityWeight === scoring.diversityWeight,
  );

  return preset?.id ?? null;
}
