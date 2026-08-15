import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { t } from "../i18n.js";
import { createSwatchCountDrumUiController } from "./swatch-count-drum-ui.js";
import { FakeElement, installFakeDom } from "./test-support/fake-dom.js";

function createDrumFixture() {
  const control = new FakeElement("div");
  control.className = "swatch-count-control";

  const drum = new FakeElement("div");
  drum.className = "swatch-count-drum";
  drum.setAttribute("data-min", "3");
  drum.setAttribute("data-max", "7");
  drum.setAttribute("data-value", "4");
  drum.setBoundingRect({ height: 48, top: 0, width: 48 });

  const windowElement = new FakeElement("span");
  windowElement.className = "swatch-drum-window";
  const track = new FakeElement("span");
  track.className = "swatch-drum-track";
  const previous = new FakeElement("span");
  previous.className = "swatch-drum-previous";
  const current = new FakeElement("span");
  current.className = "swatch-drum-current";
  const next = new FakeElement("span");
  next.className = "swatch-drum-next";
  track.append(previous, current, next);
  windowElement.appendChild(track);
  drum.appendChild(windowElement);

  const label = new FakeElement("span");
  label.className = "swatch-count-label";
  control.append(drum, label);

  return { current, drum, label, next, previous, track };
}

describe("createSwatchCountDrumUiController", () => {
  let uninstallFakeDom = () => {};

  beforeEach(() => {
    uninstallFakeDom = installFakeDom({ prefersReducedMotion: true });
  });

  afterEach(() => {
    uninstallFakeDom();
  });

  test("renders the current value and localized spinbutton semantics", () => {
    const fixture = createDrumFixture();
    const controller = createSwatchCountDrumUiController({
      swatchCountDrum: fixture.drum,
    });

    controller.initialize(4);

    expect(fixture.previous.textContent).toBe("3");
    expect(fixture.current.textContent).toBe("4");
    expect(fixture.next.textContent).toBe("5");
    expect(fixture.drum.getAttribute("aria-valuenow")).toBe("4");
    expect(fixture.drum.getAttribute("aria-valuetext")).toBe(t("slider.colorCount", { count: 4 }));
    expect(fixture.label.textContent).toBe(t("slider.colorCountLabel"));
  });

  test("supports keyboard steps and clamps at both ends", () => {
    const fixture = createDrumFixture();
    const changes = [];
    const controller = createSwatchCountDrumUiController({
      swatchCountDrum: fixture.drum,
      onSwatchCountChange: (count) => changes.push(count),
    });
    controller.initialize(4);
    controller.bindEvents();

    fixture.drum.dispatch("keydown", { key: "ArrowUp" });
    fixture.drum.dispatch("keydown", { key: "End" });
    fixture.drum.dispatch("keydown", { key: "ArrowUp" });
    fixture.drum.dispatch("keydown", { key: "Home" });
    fixture.drum.dispatch("keydown", { key: "ArrowDown" });

    expect(changes).toEqual([5, 7, 3]);
    expect(controller.getValue()).toBe(3);
    expect(fixture.drum.getAttribute("aria-valuenow")).toBe("3");
    expect(fixture.previous.textContent).toBe("");
  });

  test("increments on an upward swipe and supports top and bottom taps", () => {
    const fixture = createDrumFixture();
    const changes = [];
    const controller = createSwatchCountDrumUiController({
      swatchCountDrum: fixture.drum,
      onSwatchCountChange: (count) => changes.push(count),
    });
    controller.initialize(4);
    controller.bindEvents();

    fixture.drum.dispatch("pointerdown", { clientY: 36, pointerId: 1 });
    fixture.drum.dispatch("pointermove", { clientY: 16, pointerId: 1 });
    fixture.drum.dispatch("pointerup", { clientY: 16, pointerId: 1 });

    fixture.drum.dispatch("pointerdown", { clientY: 8, pointerId: 2 });
    fixture.drum.dispatch("pointerup", { clientY: 8, pointerId: 2 });

    fixture.drum.dispatch("pointerdown", { clientY: 40, pointerId: 3 });
    fixture.drum.dispatch("pointerup", { clientY: 40, pointerId: 3 });

    expect(changes).toEqual([5, 6, 5]);
    expect(controller.getValue()).toBe(5);
    expect(fixture.track.style.transform).toBe("translate3d(0, -33.3333%, 0)");
  });
});
