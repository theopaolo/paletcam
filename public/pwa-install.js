// Register Service Worker
if ('serviceWorker' in navigator) {
  const SERVICE_WORKER_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
  let refreshing = false;

  function bindServiceWorkerUpdateChecks(registration) {
    let isUpdating = false;

    const triggerUpdate = () => {
      if (!registration || isUpdating) {
        return;
      }

      isUpdating = true;
      registration.update()
        .catch((error) => {
          console.warn('Service Worker update check failed:', error);
        })
        .finally(() => {
          isUpdating = false;
        });
    };

    const intervalId = globalThis.setInterval(
      triggerUpdate,
      SERVICE_WORKER_UPDATE_INTERVAL_MS
    );

    window.addEventListener('focus', triggerUpdate);
    window.addEventListener('pageshow', triggerUpdate);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        triggerUpdate();
      }
    });

    window.addEventListener('beforeunload', () => {
      globalThis.clearInterval(intervalId);
    }, { once: true });

    triggerUpdate();
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) {
      return;
    }

    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    const serviceWorkerUrl = new URL('service-worker.js', window.location.href);
    const serviceWorkerScope = new URL('.', window.location.href).pathname;

    navigator.serviceWorker.register(serviceWorkerUrl.pathname, {
      scope: serviceWorkerScope,
      updateViaCache: 'none',
    })
      .then((registration) => {
        bindServiceWorkerUpdateChecks(registration);
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
  });
}

// PWA Install Prompt
let deferredPrompt;
const installToast = document.createElement('div');
installToast.className = 'install-toast';
installToast.innerHTML = `
  <div class="install-toast-content">
    <img src="logo/colorcatchers.svg" alt="ColorCatcher" class="install-icon">
    <div class="install-text">
      <strong>Installer ColorCatcher</strong>
      <p>Ajoutez l'app à votre écran d'accueil</p>
    </div>
    <button class="install-btn">Installer</button>
    <button class="install-close">×</button>
  </div>
`;

// Listen for the beforeinstallprompt event
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  // Stash the event so it can be triggered later
  deferredPrompt = e;

  // Check if user has previously dismissed the prompt
  const hasDismissed = localStorage.getItem('pwa-install-dismissed');
  if (hasDismissed) {
    return;
  }

  // Show the install toast after a short delay
  setTimeout(() => {
    document.body.appendChild(installToast);
    installToast.classList.add('show');
  }, 3000);
});

// Install button click handler
installToast.addEventListener('click', (e) => {
  if (e.target.classList.contains('install-btn')) {
    installToast.classList.remove('show');

    if (deferredPrompt) {
      // Show the install prompt
      deferredPrompt.prompt();

      // Wait for the user to respond to the prompt
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the install prompt');
        } else {
          console.log('User dismissed the install prompt');
        }
        deferredPrompt = null;

        // Remove the toast after interaction
        setTimeout(() => {
          if (installToast.parentNode) {
            installToast.parentNode.removeChild(installToast);
          }
        }, 300);
      });
    }
  }

  if (e.target.classList.contains('install-close')) {
    // User dismissed the toast
    installToast.classList.remove('show');
    localStorage.setItem('pwa-install-dismissed', 'true');

    setTimeout(() => {
      if (installToast.parentNode) {
        installToast.parentNode.removeChild(installToast);
      }
    }, 300);
  }
});

// Listen for app installed event
window.addEventListener('appinstalled', () => {
  console.log('PWA was installed');
  deferredPrompt = null;

  if (installToast.parentNode) {
    installToast.classList.remove('show');
    setTimeout(() => {
      if (installToast.parentNode) {
        installToast.parentNode.removeChild(installToast);
      }
    }, 300);
  }
});
