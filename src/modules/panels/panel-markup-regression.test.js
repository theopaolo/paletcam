import { describe, expect, test } from "bun:test";

describe("panel markup regression", () => {
  test("settings panel keeps app-level controls and drops algorithm sliders", async () => {
    const source = await Bun.file(new URL("./settings-panel.js", import.meta.url)).text();

    expect(source).toContain("settingsPolaroidFooterLabelInput");
    expect(source).toContain("settingsPolaroidColorNamesToggle");
    expect(source).toContain("settingsFlushDataButton");
    expect(source).not.toContain("data-settings-capture-mode");
    expect(source).not.toContain("data-settings-one-more-color");
    expect(source).not.toContain("settingsMedianCutPoolRange");
    expect(source).not.toContain("settingsMedianCutPixelsRange");
    expect(source).not.toContain("settingsScoringVibrancyRange");
    expect(source).not.toContain("settingsScoringContrastRange");
    expect(source).not.toContain("settingsScoringRarityRange");
    expect(source).not.toContain("settingsScoringDiversityRange");
    expect(source).not.toContain("settingsResetButton");
  });

  test("config panel owns the tabbed algorithm drawer controls", async () => {
    const source = await Bun.file(new URL("./config-panel.js", import.meta.url)).text();
    const analysisStart = source.indexOf('id="configPanelAnalysis"');
    const colorsStart = source.indexOf('id="configPanelColors"');
    const balanceStart = source.indexOf('id="configPanelBalance"');
    const presetsStart = source.indexOf('id="configPanelPresets"');
    const analysisMarkup = source.slice(analysisStart, colorsStart);
    const colorsMarkup = source.slice(colorsStart, balanceStart);
    const balanceMarkup = source.slice(balanceStart, presetsStart);
    const presetsMarkup = source.slice(presetsStart);

    expect(source).toContain('data-config-tab="analysis"');
    expect(source).toContain('data-config-tab="colors"');
    expect(source).toContain('data-config-tab="balance"');
    expect(source).toContain('data-config-tab="presets"');
    expect(source).toContain("CONFIG_PANEL_PRESETS.map");
    expect(source).toContain("data-config-preset=${preset.id}");
    expect(source).toContain("configScoringDiversityRange");
    expect(source).toContain("configScoringContrastRange");
    expect(source).toContain("configScoringVibrancyRange");
    expect(source).toContain("configScoringRarityRange");
    expect(source).toContain("configOneMoreColorToggle");
    expect(source).toContain("configMedianCutPoolRange");
    expect(source).toContain("configMedianCutPixelsRange");
    expect(source).toContain("configUndoButton");
    expect(source).toContain("configRedoButton");
    expect(source).toContain("configResetButton");
    expect(analysisMarkup).toContain("configMedianCutPoolRange");
    expect(analysisMarkup).toContain("configMedianCutPixelsRange");
    expect(analysisMarkup).not.toContain("configScoringDiversityRange");
    expect(colorsMarkup).toContain("configScoringVibrancyRange");
    expect(colorsMarkup).toContain("configScoringRarityRange");
    expect(balanceMarkup).toContain("configScoringDiversityRange");
    expect(balanceMarkup).toContain("configScoringContrastRange");
    expect(balanceMarkup).not.toContain("configMedianCutPoolRange");
    expect(presetsMarkup).toContain("data-config-preset=${preset.id}");
  });
});
