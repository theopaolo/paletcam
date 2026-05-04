const XN = 0.95047;
const YN = 1;
const ZN = 1.08883;

function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function rgbToXyz(r, g, b) {
  const linearR = srgbToLinear(r);
  const linearG = srgbToLinear(g);
  const linearB = srgbToLinear(b);

  return [
    0.4124564 * linearR + 0.3575761 * linearG + 0.1804375 * linearB,
    0.2126729 * linearR + 0.7151522 * linearG + 0.072175 * linearB,
    0.0193339 * linearR + 0.119192 * linearG + 0.9503041 * linearB,
  ];
}

function labF(value) {
  return value > 0.008856 ? Math.cbrt(value) : (903.3 * value + 16) / 116;
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {[number, number, number]}
 */
export function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const POW25_7 = 25 ** 7;

/**
 * @param {number[]} lab1
 * @param {number[]} lab2
 * @returns {number}
 */
export function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cab = (C1 + C2) / 2;
  const Cab7 = Cab ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cab7 / (Cab7 + POW25_7)));

  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  let h1p = Math.atan2(b1, a1p) * DEG;
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * DEG;
  if (h2p < 0) h2p += 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }

  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);

  const Lp = (L1 + L2) / 2;
  const Cp = (C1p + C2p) / 2;

  let hp;
  if (C1p * C2p === 0) {
    hp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hp = (h1p + h2p + 360) / 2;
  } else {
    hp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos((hp - 30) * RAD) +
    0.24 * Math.cos(2 * hp * RAD) +
    0.32 * Math.cos((3 * hp + 6) * RAD) -
    0.2 * Math.cos((4 * hp - 63) * RAD);

  const lp50sq = (Lp - 50) * (Lp - 50);
  const SL = 1 + (0.015 * lp50sq) / Math.sqrt(20 + lp50sq);
  const SC = 1 + 0.045 * Cp;
  const SH = 1 + 0.015 * Cp * T;

  const Cp7 = Cp ** 7;
  const RC = 2 * Math.sqrt(Cp7 / (Cp7 + POW25_7));
  const dTheta = 30 * Math.exp(-((hp - 275) / 25) * ((hp - 275) / 25));
  const RT = -Math.sin(2 * dTheta * RAD) * RC;

  return Math.sqrt(
    (dLp / SL) * (dLp / SL) +
      (dCp / SC) * (dCp / SC) +
      (dHp / SH) * (dHp / SH) +
      RT * (dCp / SC) * (dHp / SH),
  );
}
