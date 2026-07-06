import "/modules/toast/toast-host.js";
import { showToast, showUndoToast } from "/modules/toast-ui.js";

let isPaused = false;
const pausedTimers = new Set();
const originalSetTimeout = window.setTimeout;

window.setTimeout = function (...args) {
  const timerId = originalSetTimeout.apply(this, args);
  if (isPaused) {
    pausedTimers.add(timerId);
    window.clearTimeout(timerId);
  }
  return timerId;
};

setTimeout(() => {
  const toastHost = document.querySelector("toast-host");
  const demoContainer = document.querySelector(".toast-demo-container");
  if (toastHost && demoContainer) {
    demoContainer.appendChild(toastHost);
  }
}, 100);

const demoActions = {
  togglePause() {
    isPaused = !isPaused;
    const body = document.body;
    const pauseBtn = document.getElementById("pauseBtn");
    const pauseBadge = document.getElementById("pauseBadge");

    if (isPaused) {
      body.classList.add("paused");
      pauseBtn.textContent = "Resume Animations";
      pauseBadge.classList.add("active");
      return;
    }

    body.classList.remove("paused");
    pauseBtn.textContent = "Pause Animations";
    pauseBadge.classList.remove("active");
    pausedTimers.clear();
  },

  showStandardDefault() {
    showToast("This is a standard toast notification");
  },

  showStandardError() {
    showToast("Something went wrong!", { variant: "error" });
  },

  showStandardWithDetails() {
    showToast("Palette saved", {
      details: "Your palette has been saved to your library",
    });
  },

  showStandardWithAction() {
    showToast("Palette published", {
      actionLabel: "View",
      onAction: () => console.log("Action clicked!"),
    });
  },

  showUndo() {
    showUndoToast("Item deleted", {
      onUndo: () => console.log("Undo clicked!"),
    });
  },

  showUndoWithCallback() {
    showUndoToast("Palette removed from collection", {
      onUndo: () => console.log("Undo executed"),
      onExpire: () => console.log("Undo expired"),
    });
  },

  showMultiple() {
    const messages = ["First notification", "Second notification", "Third notification"];
    messages.forEach((message, index) => {
      setTimeout(() => showToast(message), index * 500);
    });
  },

  showMixed() {
    showToast("Default message");
    setTimeout(() => showUndoToast("Item deleted"), 800);
    setTimeout(() => showToast("All done!", { variant: "error" }), 1600);
  },

  clearAll() {
    console.log(
      "To clear toasts, you would need to manually dispatch events or add a clear method to toast-host",
    );
  },
};

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-demo-action]");
  if (!(trigger instanceof HTMLElement)) {
    return;
  }

  const actionName = trigger.dataset.demoAction;
  const action = actionName ? demoActions[actionName] : null;
  if (typeof action === "function") {
    action();
  }
});
