import { describe, expect, test } from "bun:test";

import { createAlgorithmSettingsHistory } from "./algorithm-settings-history.js";

function createSnapshot(overrides = {}) {
  return {
    medianCut: {
      colorSpace: "rgb",
      maxQuantizerPixels: 12000,
      quantizedPoolSize: 16,
      ...(overrides.medianCut ?? {}),
    },
    paletteScoring: {
      chromaWeight: 25,
      diversityWeight: 40,
      lumaSpreadWeight: 15,
      rarityWeight: 20,
      ...(overrides.paletteScoring ?? {}),
    },
  };
}

describe("createAlgorithmSettingsHistory", () => {
  test("commits one undo snapshot when an interaction changes the value", () => {
    const history = createAlgorithmSettingsHistory({
      initialSnapshot: createSnapshot(),
    });

    history.beginInteraction();
    history.setCurrentSnapshot(
      createSnapshot({
        paletteScoring: {
          diversityWeight: 55,
        },
      }),
    );

    expect(
      history.commitInteraction(
        createSnapshot({
          paletteScoring: {
            diversityWeight: 55,
          },
        }),
      ),
    ).toBe(true);

    expect(history.getState().canUndo).toBe(true);
    expect(history.getState().canRedo).toBe(false);
    expect(history.undo()?.paletteScoring.diversityWeight).toBe(40);
  });

  test("does not create history when the interaction ends without a change", () => {
    const history = createAlgorithmSettingsHistory({
      initialSnapshot: createSnapshot(),
    });

    history.beginInteraction();

    expect(history.commitInteraction(createSnapshot())).toBe(false);
    expect(history.getState().canUndo).toBe(false);
    expect(history.getState().canRedo).toBe(false);
  });

  test("clears redo when a new snapshot is applied after undo", () => {
    const history = createAlgorithmSettingsHistory({
      initialSnapshot: createSnapshot(),
    });

    history.applySnapshot(
      createSnapshot({
        paletteScoring: {
          chromaWeight: 33,
        },
      }),
    );
    history.undo();

    expect(history.getState().canRedo).toBe(true);

    history.applySnapshot(
      createSnapshot({
        paletteScoring: {
          rarityWeight: 42,
        },
      }),
    );

    expect(history.getState().canRedo).toBe(false);
    expect(history.redo()).toBeNull();
  });

  test("treats reset like an undoable snapshot change", () => {
    const history = createAlgorithmSettingsHistory({
      initialSnapshot: createSnapshot({
        paletteScoring: {
          diversityWeight: 62,
        },
      }),
    });

    history.reset(createSnapshot());

    expect(history.getState().canUndo).toBe(true);
    expect(history.getState().currentSnapshot.paletteScoring.diversityWeight).toBe(40);
    expect(history.undo()?.paletteScoring.diversityWeight).toBe(62);
  });
});
