/** An RGB color with integer channels (0–255). */
interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** A saved palette entry as stored in IndexedDB. */
interface SavedPalette {
  id: number;
  timestamp: string;
  colors: RgbColor[];
  photoBlob?: Blob;
}

/** Copy-mode identifiers used throughout the UI. */
type CopyMode = "rgb" | "hex" | "hsl";

/** Camera facing mode. */
type FacingMode = "environment" | "user";

/** Zoom capability range reported by the camera track. */
interface ZoomCapabilities {
  min: number;
  max: number;
  step: number;
}

/** Options accepted by createCameraController. */
interface CameraControllerOptions {
  cameraFeed: HTMLVideoElement;
  onCameraActiveChange?: (isActive: boolean) => void;
  onZoomChange?: (zoom: number) => void;
  onError?: (error: unknown) => void;
  initialFacingMode?: FacingMode;
  zoomStep?: number;
  zoomIntervalMs?: number;
}

/** The controller object returned by createCameraController. */
interface CameraController {
  applyZoom(zoomValue: number): Promise<void>;
  getCurrentZoom(): number;
  getZoomCapabilities(): ZoomCapabilities | null;
  getFacingMode(): FacingMode;
  startStream(): Promise<boolean>;
  startZoom(direction: "in" | "out"): void;
  stopStream(): void;
  stopZoom(): void;
  toggleFacingMode(): Promise<boolean>;
}
