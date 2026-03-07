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

type PaletteExtractionAlgorithm = "grid" | "median-cut";

interface GridSettings {
  sampleRowCount: number;
  sampleColCount: number;
  sampleRadius: number;
}

interface MedianCutSettings {
  quantizedPoolSize: number;
  maxQuantizerPixels: number;
}

interface PaletteScoringWeights {
  chromaWeight: number;
  lumaSpreadWeight: number;
  rarityWeight: number;
  diversityWeight: number;
}

interface AppSettings {
  photoExportQuality: number;
  paletteExtractionAlgorithm: PaletteExtractionAlgorithm;
  grid: GridSettings;
  medianCut: MedianCutSettings;
  paletteScoring: PaletteScoringWeights;
}

/** Deep-partial variant for updateAppSettings — nested groups accept partial patches. */
interface AppSettingsPatch {
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

/** Options accepted by createCameraController. */
interface CameraControllerOptions {
  cameraFeed: HTMLVideoElement | null;
  onCameraActiveChange?: (isActive: boolean) => void;
  onZoomChange?: (zoom: number) => void;
  onError?: (error: unknown) => void;
  initialFacingMode?: FacingMode;
  zoomStep?: number;
}

/** The controller object returned by createCameraController. */
interface CameraController {
  destroy(): void;
  applyZoom(zoomValue: number): Promise<void>;
  getCurrentZoom(): number;
  getZoomCapabilities(): ZoomCapabilities | null;
  getFacingMode(): FacingMode;
  startStream(): Promise<boolean>;
  stopStream(): void;
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
