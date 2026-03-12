class FakeClassList {
  constructor(element) {
    this.element = element;
    this.tokens = new Set();
  }

  add(...tokens) {
    for (const token of tokens) {
      if (token) {
        this.tokens.add(token);
      }
    }
    this.#sync();
  }

  contains(token) {
    return this.tokens.has(token);
  }

  remove(...tokens) {
    for (const token of tokens) {
      this.tokens.delete(token);
    }
    this.#sync();
  }

  set(value) {
    this.tokens = new Set(String(value).split(/\s+/).filter(Boolean));
    this.#sync();
  }

  toggle(token, force) {
    if (force === true) {
      this.tokens.add(token);
    } else if (force === false) {
      this.tokens.delete(token);
    } else if (this.tokens.has(token)) {
      this.tokens.delete(token);
    } else {
      this.tokens.add(token);
    }
    this.#sync();
    return this.tokens.has(token);
  }

  toString() {
    return [...this.tokens].join(" ");
  }

  #sync() {
    this.element._className = this.toString();
  }
}

function toDatasetKey(attributeName) {
  return attributeName
    .slice(5)
    .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function matchesSelector(element, selector) {
  if (!selector) {
    return false;
  }

  if (selector.startsWith(".")) {
    return element.classList.contains(selector.slice(1));
  }

  if (selector.startsWith("#")) {
    return element.id === selector.slice(1);
  }

  return element.tagName.toLowerCase() === selector.toLowerCase();
}

export class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.hidden = false;
    this.id = "";
    this.listeners = new Map();
    this.parentElement = null;
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
    this.textContent = "";
    this.type = "";
    this._className = "";
    this.offsetHeight = 0;
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this.classList.set(value);
  }

  get nextSibling() {
    if (!this.parentElement) {
      return null;
    }

    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] ?? null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  click() {
    this.dispatch("click");
  }

  closest(selector) {
    let current = this;

    while (current) {
      if (matchesSelector(current, selector)) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  dispatch(type, eventInit = {}) {
    const event = {
      button: 0,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      target: this,
      ...eventInit,
    };

    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }

    return event;
  }

  insertBefore(node, nextSibling) {
    node.parentElement = this;

    const index = this.children.indexOf(nextSibling);
    if (index < 0) {
      this.children.push(node);
      return node;
    }

    this.children.splice(index, 0, node);
    return node;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          matches.push(child);
        }
        visit(child);
      }
    };

    visit(this);
    return matches;
  }

  remove() {
    if (!this.parentElement) {
      return;
    }

    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);

    if (name === "id") {
      this.id = "";
    }

    if (name.startsWith("data-")) {
      delete this.dataset[toDatasetKey(name)];
    }
  }

  setAttribute(name, value) {
    const normalizedValue = String(value);
    this.attributes.set(name, normalizedValue);

    if (name === "id") {
      this.id = normalizedValue;
    }

    if (name.startsWith("data-")) {
      this.dataset[toDatasetKey(name)] = normalizedValue;
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

export function installFakeDom({
  prefersReducedMotion = true,
} = {}) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const fakeDocument = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createElementNS(_namespace, tagName) {
      return new FakeElement(tagName);
    },
  };

  const fakeWindow = {
    clearTimeout,
    setTimeout,
    matchMedia() {
      return { matches: prefersReducedMotion };
    },
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: fakeDocument,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });

  return () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  };
}
