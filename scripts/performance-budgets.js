export const ARTIFACT_PERFORMANCE_BUDGETS = Object.freeze({
  cssBytes: 150 * 1024,
  distBytes: 2 * 1024 * 1024,
  fontBytes: 250 * 1024,
  initialJsBytes: 700 * 1024,
  precacheBytes: 2 * 1024 * 1024,
  precacheEntries: 150,
});

export const RUNTIME_PERFORMANCE_PROFILE = Object.freeze({
  cpuSlowdownRate: 4,
  downloadBytesPerSecond: 200 * 1024,
  latencyMs: 40,
  uploadBytesPerSecond: 100 * 1024,
});

// These are regression ceilings for a deterministic synthetic profile, not
// claims about every physical device. Real-device release checks record p50/p95.
export const RUNTIME_PERFORMANCE_BUDGETS = Object.freeze({
  appReadyMs: 10_000,
  backupExportMs: 1_000,
  backupHighCardinalityImportMs: 10_000,
  backupHighCardinalityMaxEventLoopGapMs: 500,
  backupImportMs: 2_000,
  backupRoundTripMs: 3_000,
  cameraReadyMs: 10_000,
  captureToSaveMs: 2_000,
  collection250HydrationMs: 7_000,
  collection250InitialRenderMs: 1_500,
  domContentLoadedMs: 8_000,
  extractionP95Ms: 1_000,
  loadMs: 10_000,
  maxLongTaskMs: 1_000,
  previewFrameIntervalP95Ms: 100,
  serviceWorkerInitialControlMs: 15_000,
  serviceWorkerUpdateActivationMs: 5_000,
  serviceWorkerUpdateInstallMs: 5_000,
  totalLongTaskMs: 2_500,
  viewerOpenMs: 4_000,
});
