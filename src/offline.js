import { getAppSettings } from "./app-settings.js";
import { setLocale } from "./i18n.js";

setLocale(getAppSettings().locale, { force: true });

const retryButton = document.getElementById("retryButton");

retryButton?.addEventListener("click", () => {
  window.location.reload();
});
