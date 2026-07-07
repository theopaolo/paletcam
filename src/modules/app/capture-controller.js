import { getAppSettings } from "../../app-settings.js";
import { trackCaptureStatAsync } from "../../capture-stat-service.js";
import { t } from "../../i18n.js";
import { savePalette } from "../../palette-storage.js";
import { drawFrameToCanvas, renderOutputSwatches } from "../camera-ui.js";
import { createErrorToastOptions, reportAppError } from "../error-reporting.js";
import { extractPaletteColors, removeDarkestColor } from "../palette-extraction.js";
import { showToast } from "../toast-ui.js";
import { scheduleSavedPalettePreviewWarmup } from "../collection/palette-preview-persistence.js";
import { exportPhotoBlob } from "./photo-export.js";
import { getCenteredAspectCropRect, toNormalizedCropRect } from "./geometry.js";

export function createCaptureController({
  cameraFeed,
  frameCanvas,
  outputPalette,
  cameraController,
  captureMicroInteractions,
  livePreviewController,
  photoOutputController,
  ralPreview,
  getCaptureMode,
  getOneMoreColor,
  getPaletteExtractionOptions,
  getPhotoExportQuality,
  getShouldMirrorUserFacingCamera,
}) {
  let isSavePending = false;

  async function captureCurrentFrame() {
    const frameContext = livePreviewController?.getFrameContext();
    const frameWidth = livePreviewController?.getFrameWidth() ?? 0;
    const frameHeight = livePreviewController?.getFrameHeight() ?? 0;

    if (!frameContext || frameWidth <= 0 || frameHeight <= 0 || isSavePending) {
      return;
    }

    captureMicroInteractions.triggerCaptureFlash();

    const facingMode = cameraController.getFacingMode();
    const shouldMirrorUserFacing = getShouldMirrorUserFacingCamera();
    const captureSourceWidth = cameraFeed.videoWidth || frameWidth;
    const captureSourceHeight = cameraFeed.videoHeight || frameHeight;
    const captureSourceRect = getCenteredAspectCropRect(captureSourceWidth, captureSourceHeight);
    const captureCropRect = toNormalizedCropRect(
      captureSourceRect,
      captureSourceWidth,
      captureSourceHeight,
    );

    const captureModeSnapshot = getCaptureMode();

    frameCanvas.width = frameWidth;
    frameCanvas.height = frameHeight;

    drawFrameToCanvas({
      context: frameContext,
      cameraFeed,
      width: frameWidth,
      height: frameHeight,
      facingMode,
      shouldMirrorUserFacing,
      sourceRect: captureSourceRect,
    });

    let paletteColors;
    let ralMatchData = null;

    if (captureModeSnapshot === "ral") {
      const currentRalMatch =
        ralPreview.getCurrentPreview()?.match ?? livePreviewController.readCurrentRalMatch();
      if (currentRalMatch) {
        paletteColors = [
          {
            r: currentRalMatch.ral.r,
            g: currentRalMatch.ral.g,
            b: currentRalMatch.ral.b,
            deltaE: currentRalMatch.deltaE,
          },
        ];
        ralMatchData = {
          code: currentRalMatch.ral.code,
          name: currentRalMatch.ral.name,
          r: currentRalMatch.ral.r,
          g: currentRalMatch.ral.g,
          b: currentRalMatch.ral.b,
          deltaE: currentRalMatch.deltaE,
        };
      } else {
        paletteColors = [];
      }
    } else {
      paletteColors = livePreviewController.getCapturePaletteColors();
      if (paletteColors.length === 0) {
        const imageData = frameContext.getImageData(0, 0, frameWidth, frameHeight).data;
        const { colors: extractedPaletteColors } = extractPaletteColors(
          imageData,
          frameWidth,
          frameHeight,
          livePreviewController.getEffectiveSwatchCount(),
          getPaletteExtractionOptions(),
        );
        const finalColors = getOneMoreColor()
          ? removeDarkestColor(extractedPaletteColors)
          : extractedPaletteColors;
        paletteColors = finalColors.map((color) => ({ ...color }));
      }
    }

    renderOutputSwatches(outputPalette, paletteColors);
    photoOutputController.clearPaletteId();

    isSavePending = true;
    try {
      await new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      const masterPhotoBlob = await exportPhotoBlob({
        fallbackCanvas: frameCanvas,
        fallbackWidth: frameWidth,
        fallbackHeight: frameHeight,
        cameraFeed,
        facingMode,
        photoExportQuality: getPhotoExportQuality(),
        shouldMirrorUserFacing,
        sourceRect: null,
      });

      photoOutputController.setBlob(masterPhotoBlob);

      if (paletteColors.length > 0) {
        const savedPalette = await savePalette(paletteColors, {
          photoBlob: masterPhotoBlob,
          captureAspectRatio: "4:3",
          captureCropRect,
          captureMode: captureModeSnapshot,
          ralMatch: ralMatchData,
          polaroidRenderSettings: {
            footerLabel: getAppSettings().polaroidFooterLabel,
          },
        });
        scheduleSavedPalettePreviewWarmup(savedPalette, "gallery");
        trackCaptureStatAsync();
        photoOutputController.setPaletteId(savedPalette?.id);
      }
    } catch (error) {
      photoOutputController.clearPaletteId();
      reportAppError(error, {
        logMessage: "Failed to save palette.",
      });
      showToast(
        t("camera.captureSaveFailed"),
        createErrorToastOptions(error, {
          variant: "error",
          duration: 2500,
        }),
      );
    } finally {
      isSavePending = false;
    }
  }

  return {
    captureCurrentFrame,
    isSavePending: () => isSavePending,
  };
}
