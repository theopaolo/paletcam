import en from "./i18n/locales/en.js";
import fr from "./i18n/locales/fr.js";

const DEFAULT_LOCALE = "fr";
const SUPPORTED_LOCALES = new Set(["fr", "en"]);
const INTL_LOCALE_MAP = Object.freeze({
  en: "en-US",
  fr: "fr-FR",
});
const MESSAGES = Object.freeze({
  en,
  fr,
});
const localeListeners = new Set();

let currentLocale = normalizeLocale(
  globalThis.document?.documentElement?.lang || globalThis.navigator?.language || DEFAULT_LOCALE,
);

function formatTemplate(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_match, key) => {
    if (!Object.hasOwn(params, key) || params[key] == null) {
      return `{${key}}`;
    }

    return String(params[key]);
  });
}

function getMessage(locale, key) {
  return MESSAGES[locale]?.[key] ?? MESSAGES[DEFAULT_LOCALE]?.[key] ?? key;
}

function getTranslatableElements(root) {
  if (!root) {
    return [];
  }

  const elements = [];

  if (root instanceof Element) {
    elements.push(root);
  }

  if (root instanceof Document || root instanceof Element || root instanceof DocumentFragment) {
    elements.push(...root.querySelectorAll("*"));
  }

  return elements;
}

export function normalizeLocale(locale) {
  const normalizedLocale = String(locale || "")
    .trim()
    .toLowerCase()
    .split("-")[0];

  return SUPPORTED_LOCALES.has(normalizedLocale) ? normalizedLocale : DEFAULT_LOCALE;
}

export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}

export function getLocale() {
  return currentLocale;
}

export function getIntlLocale(locale = currentLocale) {
  return INTL_LOCALE_MAP[normalizeLocale(locale)] || INTL_LOCALE_MAP[DEFAULT_LOCALE];
}

export function t(key, params = {}) {
  return formatTemplate(getMessage(currentLocale, key), params);
}

export function applyTranslations(root = globalThis.document) {
  if (!root) {
    return;
  }

  const elements = getTranslatableElements(root);

  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.lang = currentLocale;
  }

  elements.forEach((element) => {
    const textKey = element.getAttribute("data-i18n");
    if (textKey) {
      element.textContent = t(textKey);
    }

    element.getAttributeNames()
      .filter((attributeName) => attributeName.startsWith("data-i18n-"))
      .forEach((attributeName) => {
        const targetAttribute = attributeName.slice("data-i18n-".length);
        const translationKey = element.getAttribute(attributeName);
        if (!translationKey) {
          return;
        }

        element.setAttribute(targetAttribute, t(translationKey));
      });
  });
}

export function setLocale(locale, { force = false } = {}) {
  const nextLocale = normalizeLocale(locale);
  if (!force && nextLocale === currentLocale) {
    return currentLocale;
  }

  currentLocale = nextLocale;
  applyTranslations(globalThis.document);
  localeListeners.forEach((listener) => {
    try {
      listener(currentLocale);
    } catch (error) {
      console.error("Locale listener failed:", error);
    }
  });

  return currentLocale;
}

export function subscribeLocaleChange(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}
