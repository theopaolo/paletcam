export function readStoredFlag(storageKey, fallbackValue = false) {
  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (storedValue === null) {
      return fallbackValue;
    }

    return storedValue === "1";
  } catch (error) {
    return fallbackValue;
  }
}

export function writeStoredFlag(storageKey, value) {
  try {
    window.localStorage.setItem(storageKey, value ? "1" : "0");
  } catch (error) {
    // Ignore storage failures (private mode, disabled storage).
  }
}

export function readStoredEnum(storageKey, allowedValues, fallbackValue) {
  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (allowedValues.includes(storedValue)) {
      return storedValue;
    }
  } catch (error) {
    return fallbackValue;
  }

  return fallbackValue;
}

export function writeStoredValue(storageKey, value) {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch (error) {
    // Ignore storage failures.
  }
}
