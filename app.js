let width = 0;
let height = 0;

const cameraFeed = document.querySelector('.camera-feed');
const captureBtn = document.querySelector('.btn-capture');
const allowBtn = document.querySelector('.btn-allow-media');
const allowText = document.querySelector('.allow-container span');
const captureContainer = document.querySelector('.capture');
const photo = document.getElementById('photo');
const paletteImg = document.getElementById('paletteImg')
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let streamingFlag = false;
let captureContainerH = captureContainer.clientHeight;
let captureContainerW = captureContainer.clientWidth;

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
    .getUserMedia({ video: { facingMode: "environment" }, audio: false })
    .then((stream) =>{
        cameraFeed.srcObject = stream;
        cameraFeed.play();
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

  // Flip horizontally to un-mirror the video
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(cameraFeed, -width, 0, width, height);
  ctx.restore();

  let barWidth = canvasPalette.width / 5;

  if( height > 0 && width > 0) {
    const pixelData = ctx.getImageData(0, 0, width, height).data;
    for(let i = 0; i < 5; i++) {
      let x = Math.floor((width / 5) * i + (width / 10));
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

  // Flip horizontally to un-mirror the captured image
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(cameraFeed, -width, 0, width, height);
  ctx.restore();

  if (width && height) {
    // Create a separate canvas for the 100px tall palette export
    const exportPaletteCanvas = document.createElement('canvas');
    const exportCtx = exportPaletteCanvas.getContext('2d');
    exportPaletteCanvas.width = canvasPalette.width;
    exportPaletteCanvas.height = 100;

    // Draw the palette colors at 100px height and extract RGB values
    const pixelData = ctx.getImageData(0, 0, width, height).data;
    const barWidth = exportPaletteCanvas.width / 5;
    currentPaletteColors = []; // Reset the current palette

    for (let i = 0; i < 5; i++) {
      let x = Math.floor((width / 5) * i + (width / 10));
      let y = Math.floor(height / 2);
      let index = (y * width + x) * 4;
      let startX = i * barWidth;

      let r = pixelData[index];
      let g = pixelData[index + 1];
      let b = pixelData[index + 2];

      // Store the RGB colors
      currentPaletteColors.push({ r, g, b });

      exportCtx.fillStyle = `rgb(${r},${g},${b})`;
      exportCtx.fillRect(startX, 0, barWidth, 100);
    }

    const paletteData = exportPaletteCanvas.toDataURL('image/png');
    const photoData = canvas.toDataURL('image/png');

    photo.setAttribute('src', photoData);
    paletteImg.setAttribute('src', paletteData);

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
