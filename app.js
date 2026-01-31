let width = 0;
let height = 0;

const cameraFeed = document.querySelector('.camera-feed');
const captureBtn = document.querySelector('.btn-capture');
const allowBtn = document.querySelector('.btn-allow-media');
const allowText = document.querySelector('.allow-container span');
const captureContainer = document.querySelector('.capture');
const photo = document.getElementById('photo');
const outputPalette = document.getElementById('outputPalette');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let streamingFlag = false;
let captureContainerH = captureContainer.clientHeight;
let captureContainerW = captureContainer.clientWidth;

// Zoom and camera controls
const zoomBtns = document.querySelectorAll('.zoom-btns .btn-small');
const zoomDisplay = document.querySelector('.zoom-btns span');
const rotateBtn = document.querySelector('.btn-rotate');

// Swatch count controls
const swatchIncreaseBtn = document.querySelector('.btn-swatch-increase');
const swatchDecreaseBtn = document.querySelector('.btn-swatch-decrease');
const swatchCountDisplay = document.querySelector('.swatch-count-display');

let currentZoom = 1;
let zoomInterval = null;
let videoTrack = null;
let currentFacingMode = "environment"; // "environment" for back camera, "user" for front
let swatchCount = 5; // Default number of swatches

if (navigator.mediaDevices?.getUserMedia) {
  allowBtn.addEventListener('click', () => {
      getMediaStream();
  });

  allowText.addEventListener('click', () => {
      getMediaStream();
  });
}

const getMediaStream = () => {
    navigator.mediaDevices
    .getUserMedia({ video: { facingMode: currentFacingMode }, audio: false })
    .then((stream) =>{
        cameraFeed.srcObject = stream;
        cameraFeed.play();

        // Get the video track for zoom control
        videoTrack = stream.getVideoTracks()[0];

        // Check zoom capabilities
        if (videoTrack && videoTrack.getCapabilities) {
            const capabilities = videoTrack.getCapabilities();
            if (capabilities.zoom) {
                console.log('Zoom range:', capabilities.zoom.min, '-', capabilities.zoom.max);
                currentZoom = capabilities.zoom.min || 1;
                updateZoomDisplay();
            }
        }
    })
    .catch((err) => {
        console.error("An error occurred: " + err);
  });
}

cameraFeed.addEventListener('canplay', (ev) => {
  if (!streamingFlag) {
    width = captureContainer.clientWidth;
    height = cameraFeed.videoHeight / (cameraFeed.videoWidth / width);

    cameraFeed.setAttribute('width', width);
    cameraFeed.setAttribute('height', height);
    canvas.setAttribute('width', width);
    canvas.setAttribute('height', height);
    streamingFlag = true;

    requestAnimationFrame(canvasRefresh);
  }
});

captureBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (streamingFlag && width > 0 && height > 0) {
      takePicture();
    } else {
      getMediaStream();
    }
});

function clearPhoto() {
  console.log('Clearing photo...');
  ctx.fillStyle = "#222222"
  ctx.fillRect(0, 0, 0,0);

  const data = canvas.toDataURL('image/png');
  photo.setAttribute('src', data);
}

const canvasPalette = document.getElementById('canvas-palette');
const ctxPalette = canvasPalette.getContext('2d');

function canvasRefresh(paletteHeight = captureContainerH) {
  let w = captureContainer.clientWidth;
  let h = cameraFeed.videoHeight;
  let captureH = captureContainerH;

  if (canvas.width !== w || canvas.height !== h) {
    canvas.height = h;
    canvas.width = w;
  }

  if (canvasPalette.width !== w || canvasPalette.height !== h) {
    canvasPalette.width = w;
    canvasPalette.height = captureH;
  }

  // Flip horizontally only for front-facing camera
  ctx.save();
  if (currentFacingMode === "user") {
    ctx.scale(-1, 1);
    ctx.drawImage(cameraFeed, -width, 0, width, height);
  } else {
    ctx.drawImage(cameraFeed, 0, 0, width, height);
  }
  ctx.restore();

  let barWidth = canvasPalette.width / swatchCount;

  if( height > 0 && width > 0) {
    const pixelData = ctx.getImageData(0, 0, width, height).data;
    for(let i = 0; i < swatchCount; i++) {
      let x = Math.floor((width / swatchCount) * i + (width / (swatchCount * 2)));
      let y = Math.floor(height / 2);
      let index = (y * width + x) * 4;
      let startX = i * barWidth;

      let r = pixelData[index];
      let g = pixelData[index + 1];
      let b = pixelData[index + 2];

      ctxPalette.fillStyle = `rgb(${r},${g},${b})`;
      ctxPalette.fillRect(startX, 0, barWidth, captureContainerH);
    }
  }

  requestAnimationFrame(canvasRefresh);
}

// Store current palette colors
let currentPaletteColors = [];

function takePicture() {
  console.log('Taking picture...');
  canvas.width = width;
  canvas.height = height;

  // Flip horizontally only for front-facing camera
  ctx.save();
  if (currentFacingMode === "user") {
    ctx.scale(-1, 1);
    ctx.drawImage(cameraFeed, -width, 0, width, height);
  } else {
    ctx.drawImage(cameraFeed, 0, 0, width, height);
  }
  ctx.restore();

  if (width && height) {
    // Use 3x pixel density for sharp images
    const pixelDensity = 3;

    // Create a separate canvas for the 100px tall palette export
    const exportPaletteCanvas = document.createElement('canvas');
    const exportCtx = exportPaletteCanvas.getContext('2d');
    exportPaletteCanvas.width = canvasPalette.width * pixelDensity;
    exportPaletteCanvas.height = 100 * pixelDensity;

    // Draw the palette colors at 100px height and extract RGB values
    const pixelData = ctx.getImageData(0, 0, width, height).data;
    const barWidth = exportPaletteCanvas.width / swatchCount;
    currentPaletteColors = []; // Reset the current palette

    for (let i = 0; i < swatchCount; i++) {
      let x = Math.floor((width / swatchCount) * i + (width / (swatchCount * 2)));
      let y = Math.floor(height / 2);
      let index = (y * width + x) * 4;
      let startX = i * barWidth;

      let r = pixelData[index];
      let g = pixelData[index + 1];
      let b = pixelData[index + 2];

      // Store the RGB colors
      currentPaletteColors.push({ r, g, b });

      exportCtx.fillStyle = `rgb(${r},${g},${b})`;
      exportCtx.fillRect(startX * pixelDensity, 0, barWidth * pixelDensity, 100 * pixelDensity);
    }

    const paletteData = exportPaletteCanvas.toDataURL('image/png');

    // Create a square photo canvas (same width as one palette color)
    const photoCanvas = document.createElement('canvas');
    const photoCtx = photoCanvas.getContext('2d');
    photoCanvas.width = barWidth * pixelDensity;
    photoCanvas.height = 100 * pixelDensity;

    // Calculate dimensions for object-fit: cover behavior
    const canvasAspect = width / height;
    const targetAspect = barWidth / 100;

    let sourceX = 0, sourceY = 0, sourceWidth = width, sourceHeight = height;

    if (canvasAspect > targetAspect) {
      // Source is wider, crop the sides
      sourceWidth = height * targetAspect;
      sourceX = (width - sourceWidth) / 2;
    } else {
      // Source is taller, crop top/bottom
      sourceHeight = width / targetAspect;
      sourceY = (height - sourceHeight) / 2;
    }

    // Draw the cropped image to fit the square canvas (object-fit: cover effect)
    photoCtx.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, barWidth * pixelDensity, 100 * pixelDensity);
    const photoData = photoCanvas.toDataURL('image/png');

    photo.setAttribute('src', photoData);

    // Create dynamic palette swatches in the output
    outputPalette.innerHTML = '';
    currentPaletteColors.forEach(color => {
      const swatch = document.createElement('div');
      swatch.className = 'output-swatch';
      swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
      swatch.title = `rgb(${color.r}, ${color.g}, ${color.b})`;

      // Copy color on click
      swatch.addEventListener('click', () => {
        const colorText = `rgb(${color.r}, ${color.g}, ${color.b})`;
        navigator.clipboard.writeText(colorText).then(() => {
          console.log('Color copied:', colorText);
        });
      });

      outputPalette.appendChild(swatch);
    });

    // Automatically save to localStorage
    if (currentPaletteColors.length > 0) {
      const savedPalette = savePalette(currentPaletteColors, paletteData);
      console.log('Palette automatically saved:', savedPalette);
    }

    // Show filters panel and store original image data
    // const imageData = ctx.getImageData(0, 0, width, height);
    // showFiltersPanel(imageData, width, height);
  } else {
    clearPhoto();
  }
}

// Zoom functionality
function updateZoomDisplay() {
  zoomDisplay.textContent = currentZoom.toFixed(1);
}

function applyZoom(zoomValue) {
  if (videoTrack && videoTrack.getCapabilities) {
    const capabilities = videoTrack.getCapabilities();

    if (capabilities.zoom) {
      // Clamp zoom value to the camera's min/max
      const clampedZoom = Math.max(
        capabilities.zoom.min,
        Math.min(capabilities.zoom.max, zoomValue)
      );

      currentZoom = clampedZoom;

      videoTrack.applyConstraints({
        advanced: [{ zoom: currentZoom }]
      }).then(() => {
        updateZoomDisplay();
      }).catch(err => {
        console.error('Error applying zoom:', err);
      });
    }
  }
}

function startZoom(direction) {
  const zoomStep = 0.1; // Zoom increment per frame

  zoomInterval = setInterval(() => {
    const newZoom = direction === 'in'
      ? currentZoom + zoomStep
      : currentZoom - zoomStep;

    applyZoom(newZoom);
  }, 50); // Update every 50ms for smooth zooming
}

function stopZoom() {
  if (zoomInterval) {
    clearInterval(zoomInterval);
    zoomInterval = null;
  }
}

// Zoom button event listeners
zoomBtns.forEach((btn, index) => {
  const direction = index === 0 ? 'out' : 'in'; // First button is -, second is +

  // Mouse events
  btn.addEventListener('mousedown', () => startZoom(direction));
  btn.addEventListener('mouseup', stopZoom);
  btn.addEventListener('mouseleave', stopZoom);

  // Touch events for mobile
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startZoom(direction);
  });
  btn.addEventListener('touchend', (e) => {
    e.preventDefault();
    stopZoom();
  });
});

// Rotate camera (switch between front and back)
rotateBtn.addEventListener('click', () => {
  // Stop current stream
  if (cameraFeed.srcObject) {
    cameraFeed.srcObject.getTracks().forEach(track => track.stop());
  }

  // Toggle facing mode
  currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";

  // Reset zoom
  currentZoom = 1;

  // Restart stream with new camera
  getMediaStream();
});

// Swatch count controls
function updateSwatchCountDisplay() {
  swatchCountDisplay.textContent = swatchCount;
}

swatchIncreaseBtn.addEventListener('click', () => {
  swatchCount++;
  updateSwatchCountDisplay();
});

swatchDecreaseBtn.addEventListener('click', () => {
  if (swatchCount > 1) { // Minimum of 1 swatch
    swatchCount--;
    updateSwatchCountDisplay();
  }
});
