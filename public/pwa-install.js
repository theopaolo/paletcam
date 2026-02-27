// Platform detection
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

if (isIOS) {
  document.documentElement.classList.add('is-ios');
}

// Register Service Worker
if ('serviceWorker' in navigator) {
  let refreshing = false;

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

    navigator.serviceWorker.register(serviceWorkerUrl.pathname, { scope: serviceWorkerScope })
      .then((registration) => {

        void registration.update();
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

// iOS PWA install prompt (Safari doesn't support beforeinstallprompt)
if (isIOS && !isInStandaloneMode) {
  const iosInstallToast = document.createElement('div');
  iosInstallToast.className = 'install-toast ios-install-toast';
  iosInstallToast.innerHTML = `
    <div class="install-toast-content">
      <img src="logo/colorcatchers.svg" alt="ColorCatcher" class="install-icon">
      <div class="install-text">
        <strong>Installer ColorCatcher</strong>
        <p>Appuyez sur <svg class="ios-share-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> puis <em>Sur l'écran d'accueil</em></p>
      </div>
      <button class="install-close">×</button>
    </div>
  `;

  const hasDismissedIos = localStorage.getItem('pwa-ios-install-dismissed');
  if (!hasDismissedIos) {
    setTimeout(() => {
      document.body.appendChild(iosInstallToast);
      iosInstallToast.classList.add('show');
    }, 3000);
  }

  iosInstallToast.addEventListener('click', (e) => {
    if (e.target.closest('.install-close')) {
      iosInstallToast.classList.remove('show');
      localStorage.setItem('pwa-ios-install-dismissed', 'true');
      setTimeout(() => {
        if (iosInstallToast.parentNode) {
          iosInstallToast.parentNode.removeChild(iosInstallToast);
        }
      }, 300);
    }
  });
}

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
