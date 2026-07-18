import { expect, mock, test } from "bun:test";
import { COMMUNITY_API_CONTRACT_LIMITS } from "./community-api-contract.js";
import { initCommunityHomepageLink } from "./community-homepage-link.js";

const SESSION_STORAGE_KEY = "paletcam:community:session:v1";
const MAGIC_LINK = "https://colorcatchers.co/auth/magic/account-a";

function createMemoryStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  return {
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(String(key)) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    get length() {
      return values.size;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

function restoreProperty(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
}

async function createHarness(initialSession = null) {
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const addEventListenerDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "addEventListener",
  );
  const initialEntries = initialSession
    ? [[SESSION_STORAGE_KEY, JSON.stringify(initialSession)]]
    : [];
  const storage = createMemoryStorage(initialEntries);
  let storageListener = null;

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "addEventListener", {
    configurable: true,
    value: mock((type, listener) => {
      if (type === "storage") {
        storageListener = listener;
      }
    }),
  });

  const module = await import(`./community-session.js?test=${Math.random()}`);

  return {
    module,
    storage,
    emitStorage({ key = SESSION_STORAGE_KEY, newValue, storageArea = storage, commit = true }) {
      if (commit && key === SESSION_STORAGE_KEY && storageArea === storage) {
        if (newValue === null) {
          storage.removeItem(key);
        } else {
          storage.setItem(key, newValue);
        }
      }
      storageListener?.({ key, newValue, storageArea });
    },
    restore() {
      restoreProperty("localStorage", localStorageDescriptor);
      restoreProperty("addEventListener", addEventListenerDescriptor);
    },
  };
}

const accountA = {
  token: "token-a",
  email: "a@example.com",
  user: { id: "a", name: "Account A", email: "a@example.com" },
};
const accountB = {
  token: "token-b",
  email: "b@example.com",
  user: { id: "b", name: "Account B", email: "b@example.com" },
};

function createFakeLink() {
  const handlers = new Map();
  return {
    href: "https://colorcatchers.co/",
    target: "",
    rel: "",
    addEventListener(type, listener) {
      handlers.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (handlers.get(type) === listener) {
        handlers.delete(type);
      }
    },
    fire(type) {
      handlers.get(type)?.();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("storage events notify subscribers for account replacement and logout only", async () => {
  const harness = await createHarness(accountA);
  try {
    const listener = mock(() => {});
    harness.module.subscribeCommunitySession(listener);

    const accountBValue = JSON.stringify(accountB);
    harness.emitStorage({ newValue: accountBValue });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(accountB);
    expect(harness.module.getCommunityAccessToken()).toBe("token-b");

    harness.emitStorage({ newValue: accountBValue });
    harness.emitStorage({ key: "unrelated:key", newValue: "ignored", commit: false });
    harness.emitStorage({
      newValue: JSON.stringify(accountA),
      storageArea: createMemoryStorage(),
      commit: false,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    harness.emitStorage({ newValue: null });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(null);
    expect(harness.module.getCommunitySession()).toBeNull();
  } finally {
    harness.restore();
  }
});

test("malformed cross-tab session data fails closed without throwing", async () => {
  const harness = await createHarness(accountA);
  const originalWarn = console.warn;
  console.warn = mock(() => {});
  try {
    const listener = mock(() => {});
    harness.module.subscribeCommunitySession(listener);

    expect(() => harness.emitStorage({ newValue: "{malformed" })).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(null);
    expect(harness.module.getCommunityAccessToken()).toBe("");
  } finally {
    console.warn = originalWarn;
    harness.restore();
  }
});

test("oversized persisted and cross-tab session capabilities fail closed", async () => {
  const harness = await createHarness({
    ...accountA,
    token: "t".repeat(COMMUNITY_API_CONTRACT_LIMITS.loginTokenCharacters + 1),
  });
  try {
    expect(harness.module.getCommunitySession()).toBeNull();

    harness.module.setCommunitySession(accountA);
    const listener = mock(() => {});
    harness.module.subscribeCommunitySession(listener);
    harness.emitStorage({
      newValue: JSON.stringify({
        ...accountB,
        user: {
          ...accountB.user,
          email: "e".repeat(COMMUNITY_API_CONTRACT_LIMITS.userEmailCharacters + 1),
        },
      }),
    });

    expect(harness.module.getCommunityAccessToken()).toBe("");
    expect(listener).toHaveBeenCalledWith(null);
  } finally {
    harness.restore();
  }
});

test("same-tab writes and replayed storage events notify only on semantic changes", async () => {
  const harness = await createHarness();
  try {
    const listener = mock(() => {});
    harness.module.subscribeCommunitySession(listener);

    harness.module.setCommunitySession(accountA);
    expect(listener).toHaveBeenCalledTimes(1);

    harness.module.setCommunitySession({
      ...accountA,
      token: " token-a ",
      email: " A@EXAMPLE.COM ",
    });
    harness.emitStorage({ newValue: harness.storage.getItem(SESSION_STORAGE_KEY) });
    expect(listener).toHaveBeenCalledTimes(1);

    harness.module.clearCommunitySession();
    harness.emitStorage({ newValue: null });
    harness.module.clearCommunitySession();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(null);
  } finally {
    harness.restore();
  }
});

test("failed durable logout cannot resurrect a stale bearer token in the running app", async () => {
  const harness = await createHarness(accountA);
  const originalWarn = console.warn;
  const originalSetItem = harness.storage.setItem;
  const originalRemoveItem = harness.storage.removeItem;
  console.warn = mock(() => {});
  try {
    const listener = mock(() => {});
    harness.module.subscribeCommunitySession(listener);
    harness.storage.setItem = () => {
      throw new Error("write denied");
    };
    harness.storage.removeItem = () => {
      throw new Error("remove denied");
    };

    expect(harness.module.clearCommunitySession()).toBe(false);
    expect(harness.module.getCommunitySession()).toBeNull();
    expect(harness.module.getCommunityAccessToken()).toBe("");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(null);
  } finally {
    harness.storage.setItem = originalSetItem;
    harness.storage.removeItem = originalRemoveItem;
    console.warn = originalWarn;
    harness.restore();
  }
});

test("a durable logout tombstone survives removeItem failure", async () => {
  const harness = await createHarness(accountA);
  const originalWarn = console.warn;
  const originalRemoveItem = harness.storage.removeItem;
  console.warn = mock(() => {});
  try {
    harness.storage.removeItem = () => {
      throw new Error("remove denied");
    };

    expect(harness.module.clearCommunitySession()).toBe(true);
    expect(harness.storage.getItem(SESSION_STORAGE_KEY)).toBe('{"cleared":true}');
    expect(harness.module.getCommunityAccessToken()).toBe("");
  } finally {
    harness.storage.removeItem = originalRemoveItem;
    console.warn = originalWarn;
    harness.restore();
  }
});

test("a failed login persistence write cannot restore an older stored account", async () => {
  const harness = await createHarness(accountA);
  const originalWarn = console.warn;
  const originalSetItem = harness.storage.setItem;
  console.warn = mock(() => {});
  try {
    harness.storage.setItem = () => {
      throw new Error("write denied");
    };

    expect(harness.module.setCommunitySession(accountB)).toEqual(accountB);
    expect(harness.module.getCommunitySession()).toEqual(accountB);
    expect(harness.module.getCommunityAccessToken()).toBe("token-b");
    expect(JSON.parse(harness.storage.getItem(SESSION_STORAGE_KEY))).toEqual(accountA);
  } finally {
    harness.storage.setItem = originalSetItem;
    console.warn = originalWarn;
    harness.restore();
  }
});

test("cross-tab account replacement resets a minted homepage magic link", async () => {
  const harness = await createHarness(accountA);
  const link = createFakeLink();
  let dispose = () => {};
  try {
    dispose = initCommunityHomepageLink({
      link,
      getToken: harness.module.getCommunityAccessToken,
      subscribeSession: harness.module.subscribeCommunitySession,
      requestMagicLink: mock(async () => ({
        magic_link: MAGIC_LINK,
        expires_at: "2099-01-01T00:00:00.000Z",
      })),
    });

    link.fire("pointerenter");
    await flush();
    expect(link.href).toBe(MAGIC_LINK);

    harness.emitStorage({ newValue: JSON.stringify(accountB) });
    expect(link.href).toBe("https://colorcatchers.co/?ref=browser");
  } finally {
    dispose();
    harness.restore();
  }
});

test("a getter before the queued storage event still notifies account replacement once", async () => {
  const harness = await createHarness(accountA);
  const link = createFakeLink();
  const listener = mock(() => {});
  let dispose = () => {};
  try {
    harness.module.subscribeCommunitySession(listener);
    dispose = initCommunityHomepageLink({
      link,
      getToken: harness.module.getCommunityAccessToken,
      subscribeSession: harness.module.subscribeCommunitySession,
      requestMagicLink: mock(async () => ({
        magic_link: MAGIC_LINK,
        expires_at: "2099-01-01T00:00:00.000Z",
      })),
    });
    link.fire("pointerenter");
    await flush();
    expect(link.href).toBe(MAGIC_LINK);

    const accountBValue = JSON.stringify(accountB);
    harness.storage.setItem(SESSION_STORAGE_KEY, accountBValue);
    expect(harness.module.getCommunityAccessToken()).toBe("token-b");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(link.href).toBe("https://colorcatchers.co/?ref=browser");

    harness.emitStorage({ newValue: accountBValue, commit: false });
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    dispose();
    harness.restore();
  }
});
