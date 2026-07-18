import { getAppSettings, subscribeAppSettings } from "./app-settings.js";
import { setLocale, t } from "./i18n.js";
import { recordOperationalMetric } from "./modules/operational-metrics.js";
import {
  isCriticalOperationActive,
  subscribeCriticalOperations,
} from "./modules/critical-operation.js";
import { createServiceWorkerUpdateController } from "./modules/service-worker-update-controller.js";
import { showToast } from "./modules/toast-ui.js";

const isLocalHostname =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "0.0.0.0";
const isBuiltArtifact =
  typeof __PALETCAM_BUILD_ARTIFACT__ === "boolean" && __PALETCAM_BUILD_ARTIFACT__;
const isLocalDevelopment = isLocalHostname && !isBuiltArtifact;
const SERVICE_WORKER_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

setLocale(getAppSettings().locale, { force: true });

function bindServiceWorkerUpdateChecks(registration) {
  let isUpdating = false;

  const triggerUpdate = () => {
    if (!registration || isUpdating) {
      return;
    }

    isUpdating = true;
    const startedAt = performance.now();
    registration
      .update()
      .then(() => {
        recordOperationalMetric(
          "service-worker-update",
          {
            outcome: "success",
            durationMs: performance.now() - startedAt,
          },
          { sampleRate: 0.1 },
        );
      })
      .catch((error) => {
        recordOperationalMetric("service-worker-update", {
          outcome: "failure",
          durationMs: performance.now() - startedAt,
          errorName: error?.name ?? "Error",
        });
        console.warn("Service Worker update check failed:", error);
      })
      .finally(() => {
        isUpdating = false;
      });
  };

  const intervalId = globalThis.setInterval(triggerUpdate, SERVICE_WORKER_UPDATE_INTERVAL_MS);

  window.addEventListener("focus", triggerUpdate);
  window.addEventListener("pageshow", triggerUpdate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      triggerUpdate();
    }
  });

  window.addEventListener(
    "beforeunload",
    () => {
      globalThis.clearInterval(intervalId);
    },
    { once: true },
  );

  triggerUpdate();
}

function bindLocalDevelopmentServiceWorkerCleanup() {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      )
      .catch((error) => {
        console.warn("Service Worker cleanup failed in local dev:", error);
      });
  });
}

function bindProductionServiceWorkerRegistration() {
  const updateController = createServiceWorkerUpdateController({
    isBusy: isCriticalOperationActive,
    subscribeBusy: subscribeCriticalOperations,
    activateWorker: (worker) => worker.postMessage({ type: "SKIP_WAITING" }),
    onDeferred: () => {
      showToast(t("pwa.update.deferred"), { duration: 2600 });
    },
    onReadyToReload: () => {
      recordOperationalMetric("service-worker-activation", { outcome: "success" });
      window.location.reload();
    },
  });

  const offerWaitingUpdate = (registration) => {
    const waitingWorker = registration?.waiting;
    if (!waitingWorker) return;

    showToast(t("pwa.update.available"), {
      actionLabel: t("pwa.update.action"),
      duration: 0,
      onAction: () => {
        updateController.requestActivation(waitingWorker);
      },
    });
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    updateController.handleControllerChange();
  });

  window.addEventListener("beforeunload", () => updateController.destroy(), { once: true });

  window.addEventListener("load", () => {
    const startedAt = performance.now();
    const serviceWorkerUrl = new URL("service-worker.js", window.location.href);
    const serviceWorkerScope = new URL(".", window.location.href).pathname;

    navigator.serviceWorker
      .register(serviceWorkerUrl.pathname, {
        scope: serviceWorkerScope,
        updateViaCache: "none",
      })
      .then((registration) => {
        recordOperationalMetric("service-worker-registration", {
          outcome: "success",
          durationMs: performance.now() - startedAt,
        });
        offerWaitingUpdate(registration);
        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          installingWorker?.addEventListener("statechange", () => {
            if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
              offerWaitingUpdate(registration);
            }
          });
        });
        bindServiceWorkerUpdateChecks(registration);
      })
      .catch((error) => {
        recordOperationalMetric("service-worker-registration", {
          outcome: "failure",
          durationMs: performance.now() - startedAt,
          errorName: error?.name ?? "Error",
        });
        console.error("Service Worker registration failed:", error);
      });
  });
}

function createInstallToast() {
  const installToast = document.createElement("div");
  installToast.className = "install-toast";
  return installToast;
}

function renderInstallToast(installToast) {
  installToast.innerHTML = `
    <div class="install-toast-content">
      <img src="logo/colorcatchers.svg" alt="${t("header.logoAlt")}" class="install-icon">
      <div class="install-text">
        <strong>${t("pwa.install.title")}</strong>
        <p>${t("pwa.install.body")}</p>
      </div>
      <button class="install-btn">${t("pwa.install.action")}</button>
      <button class="install-close" aria-label="${t("common.closePanel")}">×</button>
    </div>
  `;
}

if ("serviceWorker" in navigator) {
  if (isLocalDevelopment) {
    bindLocalDevelopmentServiceWorkerCleanup();
  } else {
    bindProductionServiceWorkerRegistration();
  }
}

let deferredPrompt;
const installToast = createInstallToast();
renderInstallToast(installToast);

let currentLocale = getAppSettings().locale;
subscribeAppSettings((settings) => {
  if (settings.locale === currentLocale) {
    return;
  }

  currentLocale = settings.locale;
  setLocale(currentLocale);
  renderInstallToast(installToast);
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;

  const hasDismissed = localStorage.getItem("pwa-install-dismissed");
  if (hasDismissed) {
    return;
  }

  setTimeout(() => {
    document.body.appendChild(installToast);
    installToast.classList.add("show");
  }, 3000);
});

installToast.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.classList.contains("install-btn")) {
    installToast.classList.remove("show");

    if (deferredPrompt) {
      deferredPrompt.prompt();

      deferredPrompt.userChoice.then((_choiceResult) => {
        deferredPrompt = null;

        setTimeout(() => {
          if (installToast.parentNode) {
            installToast.parentNode.removeChild(installToast);
          }
        }, 300);
      });
    }
  }

  if (target?.classList.contains("install-close")) {
    installToast.classList.remove("show");
    localStorage.setItem("pwa-install-dismissed", "true");

    setTimeout(() => {
      if (installToast.parentNode) {
        installToast.parentNode.removeChild(installToast);
      }
    }, 300);
  }
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;

  if (installToast.parentNode) {
    installToast.classList.remove("show");
    setTimeout(() => {
      if (installToast.parentNode) {
        installToast.parentNode.removeChild(installToast);
      }
    }, 300);
  }
});
