import { describe, expect, test } from "bun:test";

import { createAlgorithmSettingsHistory } from "./algorithm-settings-history.js";

function createSnapshot(overrides = {}) {
  return {
    medianCut: {
      maxQuantizerPixels: 12000,
      quantizedPoolSize: 16,
      ...(overrides.medianCut ?? {}),
    },
    hybrid: {
      repulsionRadius: 0.08,
      spreadStrength: 0.6,
      rarityStrength: 0.2,
      tone: 0.85,
      loyaltyStrength: 0.3,
      ...(overrides.hybrid ?? {}),
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
        hybrid: {
          spreadStrength: 0.9,
        },
      }),
    );

    expect(
      history.commitInteraction(
        createSnapshot({
          hybrid: {
            spreadStrength: 0.9,
          },
        }),
      ),
    ).toBe(true);

    expect(history.getState().canUndo).toBe(true);
    expect(history.getState().canRedo).toBe(false);
    expect(history.undo()?.hybrid.spreadStrength).toBe(0.6);
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
        hybrid: {
          tone: 0.5,
        },
      }),
    );
    history.undo();

    expect(history.getState().canRedo).toBe(true);

    history.applySnapshot(
      createSnapshot({
        hybrid: {
          rarityStrength: 0.42,
        },
      }),
    );

    expect(history.getState().canRedo).toBe(false);
    expect(history.redo()).toBeNull();
  });

  test("treats reset like an undoable snapshot change", () => {
    const history = createAlgorithmSettingsHistory({
      initialSnapshot: createSnapshot({
        hybrid: {
          spreadStrength: 0.62,
        },
      }),
    });

    history.reset(createSnapshot());

    expect(history.getState().canUndo).toBe(true);
    expect(history.getState().currentSnapshot.hybrid.spreadStrength).toBe(0.6);
    expect(history.undo()?.hybrid.spreadStrength).toBe(0.62);
  });
});
