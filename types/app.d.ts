// ---------------------------------------------------------------------------
//  Domain models
// ---------------------------------------------------------------------------

/** An RGB color with integer channels (0–255). */
interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** HSL color (h: 0–360, s/l: 0–1). */
interface HslColor {
  h: number;
  s: number;
  l: number;
}

/** Normalized crop rectangle (values are 0–1 fractions of the source image). */
interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixel-space crop rectangle (absolute pixel coordinates). */
interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Known moderation statuses for community catches. */
type ModerationStatus = "TO_MODERATE" | "PUBLIC" | "REJECTED" | "PRIVATE";

/** A saved palette entry as stored in IndexedDB (v2 schema). Legacy entries may lack capture metadata. */
interface Palette {
  id: number;
  timestamp: string;
  colors: RgbColor[];
  photoBlob: Blob;
  captureAspectRatio?: string;
  captureCropRect?: CropRect | null;
  captureMode?: CaptureMode;
  ralMatch?: RalMatchRecord;
  remoteCatchId: string | null;
  moderationStatus: ModerationStatus | null;
  postedAt: string | null;
  moderationUpdatedAt: string | null;
  lastModerationCheckAt: string | null;
}

/** Copy-mode identifiers used throughout the UI. */
type CopyMode = "rgb" | "hex" | "hsl";

// ---------------------------------------------------------------------------
//  App settings
// ---------------------------------------------------------------------------

type CaptureMode = "palette" | "ral";

type PaletteExtractionAlgorithm = "grid" | "median-cut";

interface GridSettings {
  sampleRowCount: number;
  sampleColCount: number;
  sampleRadius: number;
}

/** Quantization color space: 'rgb' (default) or 'oklch' (perceptually uniform). */
type QuantizationColorSpace = "rgb" | "oklch";

interface MedianCutSettings {
  quantizedPoolSize: number;
  maxQuantizerPixels: number;
  colorSpace: QuantizationColorSpace;
}

interface PaletteScoringWeights {
  chromaWeight: number;
  lumaSpreadWeight: number;
  rarityWeight: number;
  diversityWeight: number;
}

interface AppSettings {
  captureMode: CaptureMode;
  photoExportQuality: number;
  paletteExtractionAlgorithm: PaletteExtractionAlgorithm;
  grid: GridSettings;
  medianCut: MedianCutSettings;
  paletteScoring: PaletteScoringWeights;
}

/** Deep-partial variant for updateAppSettings — nested groups accept partial patches. */
interface AppSettingsPatch {
  captureMode?: CaptureMode;
  photoExportQuality?: number;
  paletteExtractionAlgorithm?: PaletteExtractionAlgorithm;
  grid?: Partial<GridSettings>;
  medianCut?: Partial<MedianCutSettings>;
  paletteScoring?: Partial<PaletteScoringWeights>;
}

// ---------------------------------------------------------------------------
//  Community / session
// ---------------------------------------------------------------------------

interface CommunityUser {
  id: string;
  name: string;
  email: string;
}

interface CommunitySession {
  token: string;
  email: string;
  user: CommunityUser | null;
}

interface ModerationSyncResult {
  pendingCount: number;
  updatedCount: number;
}

interface PublicationMeta {
  tone: "public" | "rejected" | "private" | "pending";
  label: string;
  status: ModerationStatus;
}

type PublicationAction = "publish" | "unpublish";

interface ModerationEntry {
  remoteCatchId: string;
  status: ModerationStatus;
}

// ---------------------------------------------------------------------------
//  Palette scoring / extraction
// ---------------------------------------------------------------------------

interface ScoringProfile {
  __paletteScoringProfile: true;
  chromaWeight: number;
  lumaSpreadWeight: number;
  rarityWeight: number;
  diversityWeight: number;
}

interface HueRarityMap {
  buckets: number[];
  maxCount: number;
  BUCKET_COUNT: number;
}

interface PaletteExtractionResult {
  colors: RgbColor[];
  chosenIndices: number[];
}

interface PaletteExtractionOptions {
  algorithm?: PaletteExtractionAlgorithm;
  /** Optional alias for medianCut.colorSpace for direct callers. */
  colorSpace?: QuantizationColorSpace;
  grid?: Partial<GridSettings>;
  medianCut?: Partial<MedianCutSettings>;
  scoring?: Partial<PaletteScoringWeights> | ScoringProfile;
}

/** A quantized color swatch with its pixel population count. */
interface QuantizedSwatch {
  rgb: number;
  population: number;
}

// ---------------------------------------------------------------------------
//  PaletteColor (rich color wrapper)
// ---------------------------------------------------------------------------

/** OKLCH color representation. */
interface OklchColor {
  l: number;
  c: number;
  h: number;
}

/** Contrast ratios against white and black backgrounds. */
interface ContrastInfo {
  white: number;
  black: number;
}

/**
 * Rich color object returned by createPaletteColor / enrichPaletteColors.
 *
 * Enumerable properties: r, g, b, population (backward-compatible with RgbColor).
 * Non-enumerable getters/methods provide extra info without breaking spreads.
 */
interface PaletteColor extends RgbColor {
  population: number;
  readonly hex: string;
  readonly hsl: HslColor;
  readonly oklch: OklchColor;
  readonly luminance: number;
  readonly isDark: boolean;
  readonly isLight: boolean;
  readonly textColor: string;
  readonly contrast: ContrastInfo;
  css(format?: "rgb" | "hsl" | "oklch" | "hex"): string;
  toString(): string;
}

// ---------------------------------------------------------------------------
//  RAL color matching
// ---------------------------------------------------------------------------

/** A RAL Classic color entry. */
interface RalColor {
  code: string;
  name: string;
  r: number;
  g: number;
  b: number;
}

/** A RAL match result with perceptual distance. */
interface RalMatch {
  ral: RalColor;
  deltaE: number;
}

/** Flattened RAL match record stored on a saved Palette. */
interface RalMatchRecord {
  code: string;
  name: string;
  r: number;
  g: number;
  b: number;
  deltaE: number;
}

// ---------------------------------------------------------------------------
//  Toast UI
// ---------------------------------------------------------------------------

interface StandardToastOptions {
  variant?: "error" | "default";
  duration?: number;
  details?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface UndoToastOptions {
  duration?: number;
  onUndo?: () => void;
  onExpire?: () => void;
}

// ---------------------------------------------------------------------------
//  Collection
// ---------------------------------------------------------------------------

interface SessionGroup {
  id: string;
  title: string;
  palettes: Palette[];
}

interface DayGroup {
  key: string;
  id: string;
  title: string;
  dateLabel: string;
  paletteCount: number;
  sessions: SessionGroup[];
}

// ---------------------------------------------------------------------------
//  Camera
// ---------------------------------------------------------------------------

/** Camera facing mode. */
type FacingMode = "environment" | "user";

/** Zoom capability range reported by the camera track. */
interface ZoomCapabilities {
  min: number;
  max: number;
  step: number;
}

/** Exposure compensation capability range reported by the camera track. */
interface ExposureCapabilities {
  min: number;
  max: number;
  step: number;
}

/** Options accepted by createCameraController. */
interface CameraControllerOptions {
  cameraFeed: HTMLVideoElement | null;
  onCameraActiveChange?: (isActive: boolean) => void;
  onExposureChange?: (exposure: number) => void;
  onZoomChange?: (zoom: number) => void;
  onError?: (error: unknown) => void;
  initialFacingMode?: FacingMode;
  zoomStep?: number;
}

/** The controller object returned by createCameraController. */
interface CameraController {
  applyExposureCompensation(exposureValue: number): Promise<boolean>;
  destroy(): void;
  applyZoom(zoomValue: number): Promise<boolean>;
  getCurrentExposureCompensation(): number;
  getCurrentZoom(): number;
  getExposureCapabilities(): ExposureCapabilities | null;
  getZoomCapabilities(): ZoomCapabilities | null;
  getFacingMode(): FacingMode;
  startStream(): Promise<boolean>;
  setMeteringPoint(point: { x: number; y: number }): Promise<boolean>;
  stopStream(): void;
  supportsMeteringPointSelection(): boolean;
  toggleFacingMode(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
//  UI controller factories
// ---------------------------------------------------------------------------

interface ZoomUiController {
  bindEvents(): void;
  destroy(): void;
  handleZoomChange(zoomValue: number): void;
  initialize(): void;
  setDisabled(): void;
  syncCapabilities(): void;
}

interface ExposureUiController {
  bindEvents(): void;
  destroy(): void;
  handleExposureChange(exposureValue: number): void;
  initialize(): void;
  setDisabled(): void;
  syncCapabilities(): void;
}

interface SwatchSliderUiController {
  bindEvents(): void;
  cleanup(): void;
  destroy(): void;
  initialize(swatchCount: number): void;
}

interface SampleGridOverlayController {
  configureGrid(options?: {
    sampleColCount?: number;
    sampleDiameter?: number;
    sampleRowCount?: number;
  }): void;
  ensureBuilt(): void;
  markChosenSquares(chosenIndices?: number[]): void;
  setVisible(isVisible: boolean): void;
  updatePointSizes(): void;
}

interface CaptureMicroInteractions {
  cleanup(): void;
  pulseCaptureButton(): void;
  triggerCaptureFlash(): void;
}

interface VisualEffects {
  setCaptureButtonGlowColor(color: RgbColor): void;
  setCaptureGlowActive(isActive: boolean): void;
}

// ---------------------------------------------------------------------------
//  Collection card lifecycle
// ---------------------------------------------------------------------------

interface CardPositionSnapshot {
  parent: HTMLElement | null;
  nextSibling: ChildNode | null;
}

interface CollectionCardLifecycle {
  ensureEmptyMessage(): void;
  syncSessionStateFromCardContainer(cardContainer: HTMLElement | null): void;
  takeCardPositionSnapshot(card: HTMLElement): CardPositionSnapshot;
  restoreCardFromSnapshot(card: HTMLElement, snapshot: CardPositionSnapshot): void;
}

interface PreviewAsset {
  blob: Blob;
  objectUrl: string;
}

interface ShareResult {
  status: "shared" | "cancelled" | "unsupported" | "error";
}

// ---------------------------------------------------------------------------
//  Viewer overlay
// ---------------------------------------------------------------------------

interface PaletteViewerOpenOptions {
  colors?: RgbColor[];
  captureMode?: CaptureMode;
  ralMatch?: RalMatchRecord;
  getPreviewAsset?: () => Promise<PreviewAsset>;
  onShare?: () => void | Promise<void>;
  onExport?: () => void | Promise<void>;
  onPublish?: () => void | Promise<void>;
  publishAction?: PublicationAction;
  onDelete?: () => void | Promise<void>;
  canShare?: boolean;
  canExport?: boolean;
  canPublish?: boolean;
  canDelete?: boolean;
}

// ---------------------------------------------------------------------------
//  Error types
// ---------------------------------------------------------------------------

interface CommunityApiError extends Error {
  name: "CommunityApiError";
  status: number;
  payload: unknown;
  path: string;
}

interface CommunityServiceError extends Error {
  name: "CommunityServiceError";
  code: string;
  cause?: CommunityApiError | Error | unknown;
  status: number;
}

// ---------------------------------------------------------------------------
//  Vendor shims
// ---------------------------------------------------------------------------

interface PaletcamDexieTable {
  add(item: object): Promise<number>;
  get(key: number): Promise<Palette | undefined>;
  update(key: number, changes: object): Promise<number>;
  delete(key: number): Promise<void>;
  reverse(): PaletcamDexieTable;
  toArray(): Promise<Palette[]>;
  toCollection(): { modify(fn: (item: Palette) => void): Promise<number> };
}

interface PaletcamDb {
  version(ver: number): {
    stores(schema: Record<string, string>): {
      upgrade(fn: (tx: { table(name: string): PaletcamDexieTable }) => Promise<number>): void;
    };
  };
  palettes: PaletcamDexieTable;
}

declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): any;
}
