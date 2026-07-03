import {
  createPaletteVersoElement,
  renderPaletteVersoBlob,
} from "/modules/collection/palette-verso.js";
import { getColorNames } from "/modules/color-name-api.js";

const palettes = [
  {
    label: "4 colors — cross plate (DOM)",
    palette: {
      id: 1,
      timestamp: "2026-07-03T09:30:00",
      colors: [
        { r: 196, g: 128, b: 94, population: 300 },
        { r: 22, g: 31, b: 51, population: 200 },
        { r: 239, g: 235, b: 224, population: 350 },
        { r: 143, g: 163, b: 184, population: 150 },
      ],
    },
  },
  {
    label: "5 colors — density stripes (DOM)",
    palette: {
      id: 2,
      timestamp: "2026-07-03T09:30:00",
      colors: [
        { r: 143, g: 163, b: 184, population: 340 },
        { r: 239, g: 235, b: 224, population: 260 },
        { r: 196, g: 128, b: 94, population: 190 },
        { r: 22, g: 31, b: 51, population: 130 },
        { r: 214, g: 40, b: 57, population: 80 },
      ],
    },
  },
  {
    label: "7 colors — density stripes (DOM)",
    palette: {
      id: 3,
      timestamp: "2026-07-03T09:30:00",
      colors: [
        { r: 239, g: 235, b: 224, population: 300 },
        { r: 143, g: 163, b: 184, population: 220 },
        { r: 196, g: 128, b: 94, population: 170 },
        { r: 22, g: 31, b: 51, population: 120 },
        { r: 122, g: 139, b: 110, population: 90 },
        { r: 214, g: 40, b: 57, population: 60 },
        { r: 228, g: 178, b: 90, population: 40 },
      ],
    },
  },
];

for (const { label, palette } of palettes) {
  const heading = document.createElement("p");
  heading.className = "harness-label";
  heading.textContent = label;
  document.body.appendChild(heading);

  const slot = document.createElement("div");
  slot.className = "verso-slot";
  const names = await getColorNames(palette.colors);
  slot.appendChild(createPaletteVersoElement(palette, names));
  document.body.appendChild(slot);
}

for (const { palette } of [palettes[0], palettes[2]]) {
  const heading = document.createElement("p");
  heading.className = "harness-label";
  heading.textContent = `${palette.colors.length} colors — canvas export (PNG)`;
  document.body.appendChild(heading);

  const slot = document.createElement("div");
  slot.className = "export-slot";
  const names = await getColorNames(palette.colors);
  const blob = await renderPaletteVersoBlob(palette, names);
  const image = document.createElement("img");
  image.src = URL.createObjectURL(blob);
  slot.appendChild(image);
  document.body.appendChild(slot);
}
