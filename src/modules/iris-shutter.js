/**
 * Iris face for the capture button: the live palette cut into aperture blades.
 * The button keeps its own click; this module only draws and animates.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const CENTER = 32;
const RADIUS = 30;
const GRAPHITE = [
  { r: 44, g: 44, b: 44 },
  { r: 36, g: 36, b: 36 },
];

/**
 * Per-look geometry. Titanium splits each color into thin blades; flat keeps
 * one blade per color, turned 45° so four blades open a diamond (a leaf
 * shutter) rather than a square window.
 */
const LOOKS = {
  titanium: {
    aperture: 5,
    bend: 0.16,
    rotation: 0,
    bladesPerColor: (count) => Math.max(2, Math.round(12 / count)),
  },
  flat: { aperture: 6.5, bend: 0.3, rotation: Math.PI / 4, bladesPerColor: () => 1 },
};

/**
 * Blade outlines for an iris of `colors.length * perColor` blades. Blade i is the
 * region between the lines tangent to the aperture at angles i and i+1, with
 * the outer part of each line bowed into a quadratic curve (control point =
 * segment midpoint turned by `bend`). Neighbours share their curve, so the
 * blades tile the ring; aperture 0 closes the iris to a point.
 *
 * @param {{ count: number, perColor: number, aperture: number, twist?: number, bend?: number, radius?: number }} options
 * @returns {{ d: string, edge: string, colorIndex: number }[]}
 */
export function irisBladePaths({
  count,
  perColor,
  aperture,
  twist = 0,
  bend = 0,
  radius = RADIUS,
}) {
  const n = count * perColor;
  if (n < 3) {
    return [];
  }

  const step = (2 * Math.PI) / n;
  const r = Math.min(Math.max(aperture, 0), radius);
  const outerShift = Math.acos(r / radius);
  const vertexRadius = r / Math.cos(Math.PI / n);
  const xy = (rad, ang) => [CENTER + rad * Math.cos(ang), CENTER + rad * Math.sin(ang)];
  const pt = (rad, ang) =>
    xy(rad, ang)
      .map((v) => v.toFixed(2))
      .join(" ");
  const ctrl = (vertexAngle, outerAngle) => {
    const [x1, y1] = xy(vertexRadius, vertexAngle);
    const [x2, y2] = xy(radius, outerAngle);
    const mx = (x1 + x2) / 2 - CENTER;
    const my = (y1 + y2) / 2 - CENTER;
    const cos = Math.cos(bend);
    const sin = Math.sin(bend);
    return `${(CENTER + mx * cos - my * sin).toFixed(2)} ${(CENTER + mx * sin + my * cos).toFixed(2)}`;
  };

  const blades = [];
  for (let i = 0; i < n; i++) {
    const a1 = twist + i * step;
    const v1 = a1 + step / 2;
    const v2 = a1 + step * 1.5;
    const o1 = a1 + outerShift;
    const o2 = a1 + step + outerShift;
    const leading = `M${pt(vertexRadius, v1)} Q${ctrl(v1, o1)} ${pt(radius, o1)}`;
    blades.push({
      d: `${leading} A${radius} ${radius} 0 0 1 ${pt(radius, o2)} Q${ctrl(v2, o2)} ${pt(vertexRadius, v2)} Z`,
      edge: leading,
      colorIndex: Math.floor(i / perColor),
    });
  }
  return blades;
}

const ease = (x) => x * x * (3 - 2 * x);

/**
 * @param {{ button: HTMLElement | null }} options
 */
export function createIrisShutter({ button }) {
  if (!button) {
    return { setColors() {}, setLook() {}, snap() {}, destroy() {} };
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "iris-face");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<defs><linearGradient id="irisSheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/></linearGradient></defs><g class="iris-blades" stroke="#000" stroke-linejoin="round"></g><g class="iris-edges" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="0.35" stroke-linecap="round"></g><circle class="iris-sheen" cx="32" cy="32" r="${RADIUS}" fill="url(#irisSheen)"/><circle class="iris-rim" cx="32" cy="32" r="${RADIUS - 0.3}" fill="none" stroke="#000" stroke-opacity="0.6" stroke-width="0.6"/>`;
  const bladeGroup = svg.querySelector(".iris-blades");
  const edgeGroup = svg.querySelector(".iris-edges");
  button.append(svg);

  /** @type {{ r: number, g: number, b: number }[]} */
  let colors = [];
  let look = "logo";
  let aperture = LOOKS.titanium.aperture;
  let twist = 0;
  let frameId = 0;

  function currentLook() {
    return LOOKS[look] ?? LOOKS.titanium;
  }

  function draw() {
    if (look === "logo") {
      return;
    }
    // Graphite until the first palette. Single color fills all six blades.
    const palette = colors.length === 0 ? GRAPHITE : colors;
    const count = colors.length < 3 ? 6 : colors.length;
    const { bend, rotation, bladesPerColor } = currentLook();
    const blades = irisBladePaths({
      count,
      perColor: bladesPerColor(count),
      aperture,
      twist: twist + rotation,
      bend,
    });

    // Reuse path nodes while the blade count holds, so fills can transition.
    while (bladeGroup.childElementCount > blades.length) bladeGroup.lastElementChild?.remove();
    while (edgeGroup.childElementCount > blades.length) edgeGroup.lastElementChild?.remove();
    while (bladeGroup.childElementCount < blades.length)
      bladeGroup.append(document.createElementNS(SVG_NS, "path"));
    while (edgeGroup.childElementCount < blades.length)
      edgeGroup.append(document.createElementNS(SVG_NS, "path"));

    blades.forEach((blade, i) => {
      const { r, g, b } =
        palette === GRAPHITE ? GRAPHITE[i % 2] : palette[blade.colorIndex % palette.length];
      const bladeNode = bladeGroup.children[i];
      bladeNode.setAttribute("d", blade.d);
      bladeNode.setAttribute("fill", `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`);
      edgeGroup.children[i].setAttribute("d", blade.edge);
    });
  }

  function animate(durationMs, step) {
    globalThis.cancelAnimationFrame?.(frameId);
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      step(1);
      draw();
      return;
    }
    const start = performance.now();
    const frame = (now) => {
      const k = Math.min(1, Math.max(0, (now - start) / durationMs));
      step(k);
      draw();
      if (k < 1) {
        frameId = requestAnimationFrame(frame);
      }
    };
    frameId = requestAnimationFrame(frame);
  }

  return {
    /** @param {{ r: number, g: number, b: number }[]} nextColors */
    setColors(nextColors) {
      const countChanged = nextColors.length !== colors.length;
      const direction = Math.sign(nextColors.length - colors.length);
      colors = nextColors.map(({ r, g, b }) => ({ r, g, b }));
      if (countChanged && colors.length >= 3 && look !== "logo") {
        // A blade more or less: a small counter-turn that settles, like a ring clicking over.
        animate(260, (k) => {
          twist = 0.15 * direction * (1 - ease(k));
        });
        return;
      }
      draw();
    },
    /** @param {string} nextLook */
    setLook(nextLook) {
      look = nextLook in LOOKS ? nextLook : "logo";
      button.classList.toggle("has-iris", look !== "logo");
      button.dataset.iris = look;
      aperture = currentLook().aperture;
      twist = 0;
      draw();
    },
    /** Close to a point and reopen, like a lens stopping down for the exposure. */
    snap() {
      if (look === "logo") {
        return;
      }
      const open = currentLook().aperture;
      animate(300, (k) => {
        const c = ease(k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65);
        aperture = open * (1 - c);
        twist = 0.3 * c;
      });
    },
    destroy() {
      globalThis.cancelAnimationFrame?.(frameId);
      svg.remove();
      button.classList.remove("has-iris");
    },
  };
}
