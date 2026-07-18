// ---------------------------------------------------------------------------
//  Domain models
// ---------------------------------------------------------------------------

interface Window {
  __sharedPanelEscapeHandlerBound?: boolean;
}

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

/** A saved palette entry as stored in IndexedDB. Legacy entries may lack capture metadata. */
interface PolaroidRenderSettings {
  footerLabel: string;
  showColorNames?: boolean;
}

interface Palette {
  id: number;
  timestamp: string;
  colors: RgbColor[];
  photoBlob?: Blob | null;
  previewBlob?: Blob | null;
  previewFooterLabel?: string | null;
  previewGalleryBlob?: Blob | null;
  previewGalleryFooterLabel?: string | null;
  previewViewerBlob?: Blob | null;
  previewViewerFooterLabel?: string | null;
  hasPhotoAsset?: boolean;
  captureAspectRatio?: string;
  captureCropRect?: CropRect | null;
  captureMode?: CaptureMode;
  ralMatch?: RalMatchRecord;
  polaroidRenderSettings?: PolaroidRenderSettings | null;
  polaroidColorNames?: string[] | null;
  remoteCatchId: string | null;
  remoteOwnerAccountKey: string | null;
  moderationStatus: ModerationStatus | null;
  postedAt: string | null;
  moderationUpdatedAt: string | null;
  lastModerationCheckAt: string | null;
}

type PalettePreviewVariant = "gallery" | "viewer";

interface PaletteAssetRecord {
  paletteId: number;
  photoBlob: Blob;
}

interface PalettePreviewRecord {
  paletteId: number;
  variant: PalettePreviewVariant;
  blob: Blob;
  footerLabel: string | null;
}

interface PaletteStorageMetadataRecord {
  key: string;
  version?: number;
  completedAt?: string;
  sessionId?: string;
  state?: "staging";
  stagedCount?: number;
  createdAtMs?: number;
  updatedAtMs?: number;
}

interface PaletteImportStagingRecord {
  sessionId: string;
  ordinal: number;
  palette: Omit<Palette, "id"> & { photoBlob: Blob };
}

/** Copy-mode identifiers used throughout the UI. */
type CopyMode = "rgb" | "hex" | "hsl";

// ---------------------------------------------------------------------------
//  App settings
// ---------------------------------------------------------------------------

type CaptureMode = "palette" | "ral";
type CollectionViewMode = "list" | "grid" | "swatch";
type PaletteAnalysisProfile = "expressive" | "perceptual" | "custom";

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
}

interface HybridSettings {
  repulsionRadius: number;
  spreadStrength: number;
  rarityStrength: number;
  tone: number;
  loyaltyStrength: number;
}

interface PaletteScoringWeights {
  chromaWeight: number;
  lumaSpreadWeight: number;
  rarityWeight: number;
  diversityWeight: number;
}

interface AppSettings {
  captureMode: CaptureMode;
  collectionViewMode: CollectionViewMode;
  locale: "fr" | "en";
  performanceHudEnabled: boolean;
  oneMoreColor: boolean;
  originBadgesEnabled: boolean;
  photoQualityMode: "sd" | "hd" | "fhd";
  polaroidFooterLabel: string;
  medianCut: MedianCutSettings;
  hybrid: HybridSettings;
}

/** Deep-partial variant for updateAppSettings — nested groups accept partial patches. */
interface AppSettingsPatch {
  captureMode?: CaptureMode;
  collectionViewMode?: CollectionViewMode;
  locale?: "fr" | "en";
  performanceHudEnabled?: boolean;
  oneMoreColor?: boolean;
  originBadgesEnabled?: boolean;
  photoQualityMode?: "sd" | "hd" | "fhd";
  polaroidFooterLabel?: string;
  medianCut?: Partial<MedianCutSettings>;
  hybrid?: Partial<HybridSettings>;
}

interface AppSettingsStore {
  currentSettings: AppSettings;
  listeners: Set<(settings: AppSettings) => void>;
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

interface PaletteDeleteRemoteCleanupResult {
  attempted: boolean;
  error?: Error;
  remoteCatchId: string;
  status:
    | "not_published"
    | "unpublished"
    | "already_removed"
    | "authentication_required"
    | "failed";
  success: boolean;
}

interface CommunityDeleteOutboxRecord {
  key: string;
  accountKey: string;
  attemptCount: number;
  enqueuedAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  remoteCatchId: string;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
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

interface PaletteExportProgress {
  completed: number;
  elapsedMs: number;
  phase: "preparing" | "serializing" | "finalizing";
  total: number;
}

interface PaletteExportOptions {
  onProgress?: (progress: PaletteExportProgress) => void;
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
  chosenIndices?: number[];
  candidates?: unknown[];
  neutralCount?: number;
  neutralThreshold?: number;
}

interface HybridExtractionSettings extends Partial<HybridSettings> {
  previousColors?: RgbColor[];
}

interface PaletteExtractionOptions {
  algorithm?: PaletteExtractionAlgorithm;
  /** Optional alias for medianCut.colorSpace for direct callers. */
  colorSpace?: QuantizationColorSpace;
  grid?: Partial<GridSettings>;
  medianCut?: Partial<MedianCutSettings>;
  hybrid?: HybridExtractionSettings;
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
  onExpire?: () => void;
}

interface UndoToastOptions {
  actionLabel?: string;
  duration?: number;
  onUndo?: () => void;
  onExpire?: () => void;
  onDismiss?: (reason: "user-dismiss" | "swipe" | "interrupted" | "programmatic") => void;
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

interface CameraPoint {
  x: number;
  y: number;
}

interface CameraNumericRangeCapability {
  min: number;
  max: number;
  step?: number;
}

interface CameraTrackCapabilities {
  zoom?: CameraNumericRangeCapability;
  exposureCompensation?: CameraNumericRangeCapability;
  exposureMode?: string[];
  focusMode?: string[];
  pointsOfInterest?: boolean | CameraPoint[];
}

interface CameraTrackSettings {
  zoom?: number;
  exposureCompensation?: number;
  frameRate?: number;
}

interface CameraTrackConstraintSet {
  zoom?: number;
  exposureCompensation?: number;
  exposureMode?: string;
  focusMode?: string;
  pointsOfInterest?: CameraPoint[];
}

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

interface CameraStreamInterruptedEvent {
  type: string;
  trackReadyState: MediaStreamTrackState;
}

interface CameraStreamState {
  hasStream: boolean;
  hasVideoTrack: boolean;
  trackReadyState: MediaStreamTrackState;
  videoReadyState: number;
  videoPaused: boolean;
  videoEnded: boolean;
  videoWidth: number;
  videoHeight: number;
  currentTime: number;
}

/** Options accepted by createCameraController. */
interface CameraControllerOptions {
  cameraFeed: HTMLVideoElement | null;
  onCameraActiveChange?: (isActive: boolean) => void;
  onExposureChange?: (exposure: number) => void;
  onZoomChange?: (zoom: number) => void;
  onError?: (error: unknown) => void;
  onStreamInterrupted?: (event: CameraStreamInterruptedEvent) => void;
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
  getStreamState(): CameraStreamState;
  startStream(): Promise<boolean>;
  setMeteringPoint(point: CameraPoint): Promise<boolean>;
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

interface FrozenPinEntry {
  color: RgbColor;
  position: { x: number; y: number } | null;
}

interface FrozenPinStore {
  freeze(
    slot: number,
    color: RgbColor,
    position: { x: number; y: number } | null,
    sceneColors: RgbColor[],
  ): void;
  release(slot: number): Array<{ slot: number; entry: FrozenPinEntry }>;
  releaseAll(): Array<{ slot: number; entry: FrozenPinEntry }>;
  get(slot: number): FrozenPinEntry | null;
  getEntries(): Array<{ slot: number; color: RgbColor }>;
  has(slot: number): boolean;
  size(): number;
  applyToColors(colors: RgbColor[]): RgbColor[];
  checkSceneChange(colors: RgbColor[]): Array<{ slot: number; entry: FrozenPinEntry }>;
  processPresence(
    presence: Array<{ slot: number; presence: number }>,
  ): Array<{ slot: number; entry: FrozenPinEntry }>;
  reset(): void;
}

interface PerformanceHudController {
  destroy(): void;
  recordFrame(metrics: Record<string, unknown>): void;
  renderHud(now?: number): void;
  setEnabled(enabled: boolean): void;
}

interface VisualEffects {
  setCaptureButtonGlowColor(color: RgbColor): void;
  setCaptureGlowActive(isActive: boolean): void;
  setPaletteRibbon(colors: RgbColor[]): void;
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
  syncDayStateFromCardContainer(cardContainer: HTMLElement | null): void;
  takeCardPositionSnapshot(card: HTMLElement): CardPositionSnapshot;
  restoreCardFromSnapshot(card: HTMLElement, snapshot: CardPositionSnapshot): boolean;
}

interface PreviewAsset {
  blob: Blob;
  objectUrl?: string;
  source?: string;
}

interface ShareResult {
  status: "shared" | "cancelled" | "unsupported" | "error";
}

// ---------------------------------------------------------------------------
//  Viewer overlay
// ---------------------------------------------------------------------------

interface PaletteViewerOpenOptions {
  palettes?: Palette[];
  initialIndex?: number;
  returnFocusTarget?: HTMLElement | null;
  getPalettes?: () => Palette[];
  getPreviewAsset?: (palette: Palette) => Promise<PreviewAsset>;
  onShare?: (palette: Palette) => void | Promise<void>;
  onExport?: (palette: Palette) => void | Promise<void>;
  onExportVerso?: (palette: Palette) => void | Promise<void>;
  onPublish?: (palette: Palette) => void | Promise<void>;
  onDelete?: (palette: Palette) => void | Promise<void>;
  getPublishAction?: (palette: Palette) => PublicationAction;
  canShare?: (palette: Palette) => boolean;
  canExport?: (palette: Palette) => boolean;
  canPublish?: (palette: Palette) => boolean;
  canDelete?: (palette: Palette) => boolean;
}

// ---------------------------------------------------------------------------
//  Error types
// ---------------------------------------------------------------------------

interface ErrorLike {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
  cause?: unknown;
}

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

interface PaletcamDexieCollection<TRecord = Palette, TKey = number> {
  delete(): Promise<number>;
  modify(fn: (item: TRecord) => void): Promise<number>;
  primaryKeys(): Promise<TKey[]>;
}

interface PaletcamDexieWhereClause<TRecord = Palette, TKey = number> {
  equals(value: IDBValidKey): PaletcamDexieCollection<TRecord, TKey>;
}

interface PaletcamDexieTable<TRecord = Palette, TKey = number> {
  add(item: object): Promise<TKey>;
  bulkAdd(items: object[]): Promise<unknown>;
  bulkDelete(keys: TKey[]): Promise<void>;
  bulkGet(keys: TKey[]): Promise<Array<TRecord | undefined>>;
  bulkPut(items: object[]): Promise<number>;
  bulkUpdate(items: Array<{ key: TKey; changes: object }>): Promise<number>;
  get(key: TKey): Promise<TRecord | undefined>;
  put(item: object): Promise<TKey>;
  update(key: TKey, changes: object): Promise<number>;
  delete(key: TKey): Promise<void>;
  clear(): Promise<void>;
  orderBy(index: string): PaletcamDexieTable<TRecord, TKey>;
  reverse(): PaletcamDexieTable<TRecord, TKey>;
  toArray(): Promise<TRecord[]>;
  toCollection(): PaletcamDexieCollection<TRecord, TKey>;
  where(index: string): PaletcamDexieWhereClause<TRecord, TKey>;
}

interface PaletcamDb {
  version(ver: number): {
    stores(schema: Record<string, string>): {
      upgrade(
        // biome-ignore lint/suspicious/noExplicitAny: Dexie migration tables are selected dynamically by schema name.
        fn: (tx: { table(name: string): PaletcamDexieTable<any, any> }) => Promise<void> | void,
      ): void;
    };
  };
  transaction<TResult = void>(
    mode: "rw" | "r",
    // biome-ignore lint/suspicious/noExplicitAny: Transactions accept heterogeneous Dexie table instances.
    ...args: [...PaletcamDexieTable<any, any>[], () => Promise<TResult> | TResult]
  ): Promise<TResult>;
  palettes: PaletcamDexieTable<Palette, number>;
  paletteAssets: PaletcamDexieTable<PaletteAssetRecord, number>;
  palettePreviews: PaletcamDexieTable<PalettePreviewRecord, [number, PalettePreviewVariant]>;
  paletteStorageMetadata: PaletcamDexieTable<PaletteStorageMetadataRecord, string>;
  communityDeleteOutbox: PaletcamDexieTable<CommunityDeleteOutboxRecord, string>;
  paletteImportStaging: PaletcamDexieTable<PaletteImportStagingRecord, [string, number]>;
}

interface CapacitorLike {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

interface GlobalThis {
  Capacitor?: CapacitorLike;
  __paletcamAppSettingsStore__?: AppSettingsStore;
}

interface Navigator {
  standalone?: boolean;
}

// ---------------------------------------------------------------------------
//  Build-time injected globals (replaced via bundler `define`)
// ---------------------------------------------------------------------------

declare const __COMMUNITY_BASE_URL__: string;
declare const __PALETCAM_LOG_API_BASE_URL__: string;
declare const __PALETCAM_DEPLOY_BRANCH__: string;
declare const __PALETCAM_DEBUG_TOOLS__: boolean;
declare const __PALETCAM_BUILD_ARTIFACT__: boolean;
declare const __APP_VERSION__: string;
declare const __COMMIT_HASH__: string;
