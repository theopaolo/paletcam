// Filter controls
const filtersPanel = document.querySelector('.filters-panel');
const filterBtns = document.querySelectorAll('.filter-btn');
const brightnessInput = document.getElementById('brightness');
const contrastInput = document.getElementById('contrast');
const saturationInput = document.getElementById('saturation');
const warmthInput = document.getElementById('warmth');
const sharpenInput = document.getElementById('sharpen');
const resetBtn = document.querySelector('.btn-reset');
const saveBtn = document.querySelector('.btn-save');

let originalImageData = null;
let currentFilter = 'none';
let capturedWidth = 0;
let capturedHeight = 0;

// Preset filter definitions
const presetFilters = {
  none: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpen: 0 },
  vintage: { brightness: 5, contrast: 10, saturation: -20, warmth: 20, sharpen: 0 },
  warm: { brightness: 5, contrast: 5, saturation: 10, warmth: 40, sharpen: 0 },
  cool: { brightness: 0, contrast: 5, saturation: 0, warmth: -40, sharpen: 0 },
  bw: { brightness: 0, contrast: 10, saturation: -100, warmth: 0, sharpen: 10 },
  sepia: { brightness: 5, contrast: 5, saturation: -30, warmth: 50, sharpen: 0 }
};

// Apply filters to image
function applyFilters() {
  if (!originalImageData) return;

  const brightness = parseInt(brightnessInput.value);
  const contrast = parseInt(contrastInput.value);
  const saturation = parseInt(saturationInput.value);
  const warmth = parseInt(warmthInput.value);
  const sharpen = parseInt(sharpenInput.value);

  // Create a copy of original data
  const imageData = new ImageData(
    new Uint8ClampedArray(originalImageData.data),
    originalImageData.width,
    originalImageData.height
  );
  const data = imageData.data;

  // Apply brightness, contrast, saturation, warmth
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Brightness
    r += brightness * 2.55;
    g += brightness * 2.55;
    b += brightness * 2.55;

    // Contrast
    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    // Saturation
    const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
    const satFactor = 1 + saturation / 100;
    r = gray + satFactor * (r - gray);
    g = gray + satFactor * (g - gray);
    b = gray + satFactor * (b - gray);

    // Warmth (adjust red and blue channels)
    r += warmth * 0.5;
    b -= warmth * 0.5;

    // Clamp values
    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }

  // Apply sharpening if needed
  if (sharpen > 0) {
    sharpenImage(imageData, sharpen / 100);
  }

  // Draw filtered image using a separate canvas to avoid size conflicts
  const filterCanvas = document.createElement('canvas');
  filterCanvas.width = capturedWidth;
  filterCanvas.height = capturedHeight;
  const filterCtx = filterCanvas.getContext('2d');
  filterCtx.putImageData(imageData, 0, 0);
  photo.setAttribute('src', filterCanvas.toDataURL('image/png'));

  // Update palette with filtered colors
  updatePaletteFromFiltered(imageData);
}

// Sharpening using unsharp mask
function sharpenImage(imageData, amount) {
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const copy = new Uint8ClampedArray(data);

  const kernel = [
    0, -1, 0,
    -1, 5, -1,
    0, -1, 0
  ];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * w + (x + kx)) * 4 + c;
            sum += copy[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        const idx = (y * w + x) * 4 + c;
        data[idx] = Math.max(0, Math.min(255, copy[idx] + (sum - copy[idx]) * amount));
      }
    }
  }
}

// Update palette from filtered image
function updatePaletteFromFiltered(imageData) {
  const pixelData = imageData.data;
  const w = capturedWidth;
  const h = capturedHeight;

  const exportPaletteCanvas = document.createElement('canvas');
  const exportCtx = exportPaletteCanvas.getContext('2d');
  exportPaletteCanvas.width = w;
  exportPaletteCanvas.height = 100;

  const barWidth = exportPaletteCanvas.width / 5;

  for (let i = 0; i < 5; i++) {
    let x = Math.floor((w / 5) * i + (w / 10));
    let y = Math.floor(h / 2);
    let index = (y * w + x) * 4;
    let startX = i * barWidth;

    let r = pixelData[index];
    let g = pixelData[index + 1];
    let b = pixelData[index + 2];

    exportCtx.fillStyle = `rgb(${r},${g},${b})`;
    exportCtx.fillRect(startX, 0, barWidth, 100);
  }

  paletteImg.setAttribute('src', exportPaletteCanvas.toDataURL('image/png'));
}

// Show filters panel and store captured image data
function showFiltersPanel(imageData, width, height) {
  filtersPanel.classList.add('visible');
  originalImageData = imageData;
  capturedWidth = width;
  capturedHeight = height;
}

// Event listeners for filter buttons
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const filter = btn.dataset.filter;
    currentFilter = filter;
    const preset = presetFilters[filter];

    brightnessInput.value = preset.brightness;
    contrastInput.value = preset.contrast;
    saturationInput.value = preset.saturation;
    warmthInput.value = preset.warmth;
    sharpenInput.value = preset.sharpen;

    applyFilters();
  });
});

// Event listeners for sliders
[brightnessInput, contrastInput, saturationInput, warmthInput, sharpenInput].forEach(input => {
  input.addEventListener('input', () => {
    // Remove active class from preset buttons when manually adjusting
    filterBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[data-filter="none"]').classList.add('active');
    applyFilters();
  });
});

// Reset button
resetBtn.addEventListener('click', () => {
  brightnessInput.value = 0;
  contrastInput.value = 0;
  saturationInput.value = 0;
  warmthInput.value = 0;
  sharpenInput.value = 0;

  filterBtns.forEach(b => b.classList.remove('active'));
  document.querySelector('[data-filter="none"]').classList.add('active');

  applyFilters();
});

// Save palette button
saveBtn.addEventListener('click', () => {
  const paletteDataUrl = paletteImg.getAttribute('src');
  if (paletteDataUrl) {
    const link = document.createElement('a');
    link.download = 'palette.png';
    link.href = paletteDataUrl;
    link.click();
  }
});
