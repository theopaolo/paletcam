import { css, html, LitElement } from 'lit';

const PANEL_HIDE_DELAY_MS = 260;

class SharedPanelElement extends LitElement {
  static properties = {
    closeLabel: { attribute: 'close-label' },
    closeIconSrc: { attribute: 'close-icon-src' },
    open: { type: Boolean, reflect: true },
    panelTitle: { attribute: 'panel-title' },
  };

  static styles = css`
    :host {
      position: fixed;
      inset-block: 0;
      left: 50%;
      width: min(100vw, var(--app-shell-max-width, 500px));
      height: 100%;
      transform: translateX(-50%);
      display: block;
      box-sizing: border-box;
      overflow: hidden;
      z-index: var(--shared-panel-z-index, 1000);
      pointer-events: none;
    }

    :host([hidden]) {
      display: none;
    }

    .panel-shell {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 0.5rem;
      overflow-y: var(--shared-panel-shell-overflow-y, auto);
      overscroll-behavior: contain;
      box-sizing: border-box;
      padding: var(--shared-panel-padding, 0.5rem);
      background-color: #1b1b1b;
      color: var(--secondary-color, #f0f0f0);
      transform: translateX(100%);
      transition: transform 0.2s cubic-bezier(0.65, 0.05, 0.36, 1);
      pointer-events: auto;
    }

    :host([open]) .panel-shell {
      transform: translateX(0);
    }

    .panel-header {
      display: flex;
      justify-content: space-betwwen;
      padding: .5rem;
      color: inherit;
    }

    .panel-header.panel-header--with-actions {
      grid-template-columns: minmax(0, 1fr) auto auto;
      grid-template-areas: 'title actions close';
      gap: 0.5rem;
    }

    .panel-title {
      grid-area: title;
      min-width: 0;
      margin: 0;
      font-size: 1.5rem;
      font-weight: 400;
      text-transform: uppercase;
      display: none;
    }

    .panel-header-actions {
      grid-area: actions;
      min-width: 0;
      display: flex;
      align-items: flex-start;
      justify-content: flex-end;
      gap: 0.5rem;
    }

    ::slotted([slot="header-actions"]) {
      flex-shrink: 0;
    }

    .close-button {
      display: grid;
      place-content: center;
      margin-left: auto;
      overflow: hidden;
      padding: 0;
      width: 3rem;
      height: 3rem;
      color: var(--color-text);
      font-size: 2rem;
      border-radius: 9999px;
      border: 4px solid #0f0f0f;
      box-shadow:
        inset 0px 2px 5px #5757578a,
        0px 2px 4px #303030;
      background: linear-gradient(
        #181818,
        #141414 8%,
        #131313 20%,
        #0c0c0c 50%,
        #131313bd 80%,
        #161616
    );
    appearance: none;
    -webkit-appearance: none;
    }

    .close-button-icon {
      width: var(--shared-panel-close-icon-size, 1.5rem);
      height: var(--shared-panel-close-icon-size, 1.5rem);
      object-fit: contain;
      flex-shrink: 0;
      justify-self: end;
      filter: var(--shared-panel-close-icon-filter, none);
    }

    .close-button-glyph {
      line-height: 1;
    }

    @media (hover: hover) {
      .close-button:hover {
        background-color: rgba(255, 255, 255, 0.1);
      }
    }

    .panel-body {
      min-height: var(--shared-panel-body-min-height, 0);
      display: var(--shared-panel-body-display, block);
      overflow: var(--shared-panel-body-overflow, visible);
    }

    @media (max-width: 560px) {
      .panel-header.panel-header--with-actions {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          'title close'
          'actions actions';
      }
    }
  `;

  constructor() {
    super();
    this.closeLabel = 'Fermer le panneau';
    this.closeIconSrc = '';
    this.open = false;
    this.panelTitle = '';
    this.hasPendingCloseEvent = false;
    this.hideTimeoutId = 0;
    this.openFrameRequestId = 0;
    this.returnFocusTarget = null;
  }

  connectedCallback() {
    super.connectedCallback();

    if (this.classList.contains('visible')) {
      this.open = true;
      this.hidden = false;
      this.inert = false;
      this.setAttribute('aria-hidden', 'false');
      return;
    }

    this.open = false;
    this.hidden = true;
    this.inert = true;
    this.setAttribute('aria-hidden', 'true');
  }

  disconnectedCallback() {
    this.clearHideTimeout();
    this.clearOpenFrameRequest();
    super.disconnectedCallback();
  }

  clearHideTimeout() {
    if (!this.hideTimeoutId) {
      return;
    }

    window.clearTimeout(this.hideTimeoutId);
    this.hideTimeoutId = 0;
  }

  clearOpenFrameRequest() {
    if (!this.openFrameRequestId) {
      return;
    }

    window.cancelAnimationFrame(this.openFrameRequestId);
    this.openFrameRequestId = 0;
  }

  getPanelName() {
    return this.dataset.panelName || '';
  }

  getPanelShell() {
    return this.renderRoot?.querySelector('.panel-shell') || null;
  }

  getCloseButton() {
    return this.renderRoot?.querySelector('.close-button') || null;
  }

  getDeepActiveElement() {
    let activeElement = document.activeElement;

    while (activeElement?.shadowRoot?.activeElement) {
      activeElement = activeElement.shadowRoot.activeElement;
    }

    return activeElement instanceof HTMLElement ? activeElement : null;
  }

  isFocusableTarget(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) {
      return false;
    }

    if (
      element.hidden ||
      element.hasAttribute('disabled') ||
      element.getAttribute('aria-hidden') === 'true' ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')
    ) {
      return false;
    }

    return true;
  }

  getInitialFocusTarget() {
    const selector = [
      '[data-panel-initial-focus]',
      '[autofocus]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'button',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const lightDomTarget = Array.from(this.querySelectorAll(selector))
      .find((element) => this.isFocusableTarget(element));

    if (lightDomTarget instanceof HTMLElement) {
      return lightDomTarget;
    }

    return this.getCloseButton();
  }

  focusElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    try {
      element.focus({ preventScroll: true });
    } catch (_error) {
      element.focus();
    }

    return this.getDeepActiveElement() === element;
  }

  focusFallbackTarget() {
    const { body } = document;
    const hadTabIndex = body.hasAttribute('tabindex');

    if (!hadTabIndex) {
      body.setAttribute('tabindex', '-1');
    }

    this.focusElement(body);

    if (!hadTabIndex) {
      body.removeAttribute('tabindex');
    }
  }

  restoreFocus() {
    const activeElement = this.getDeepActiveElement();
    const activeElementIsInsidePanel = Boolean(
      activeElement && (activeElement === this || this.contains(activeElement) || this.renderRoot?.contains(activeElement))
    );

    if (!activeElementIsInsidePanel) {
      return;
    }

    if (this.isFocusableTarget(this.returnFocusTarget) && this.returnFocusTarget !== this) {
      if (this.focusElement(this.returnFocusTarget)) {
        return;
      }
    }

    activeElement?.blur?.();
    this.focusFallbackTarget();
  }

  openPanel(returnFocusTarget = null) {
    this.clearHideTimeout();
    this.clearOpenFrameRequest();
    this.hasPendingCloseEvent = false;
    this.returnFocusTarget = returnFocusTarget instanceof HTMLElement
      ? returnFocusTarget
      : this.getDeepActiveElement();
    this.hidden = false;
    this.inert = false;
    this.open = false;
    this.classList.add('visible');
    this.setAttribute('aria-hidden', 'false');

    this.openFrameRequestId = window.requestAnimationFrame(() => {
      this.openFrameRequestId = 0;

      const panelShell = this.getPanelShell();
      panelShell?.getBoundingClientRect();

      this.open = true;
      this.updateComplete.then(() => {
        const initialFocusTarget = this.getInitialFocusTarget();
        if (!initialFocusTarget) {
          return;
        }

        this.focusElement(initialFocusTarget);
      });
    });
  }

  closePanel({ restoreFocus = true } = {}) {
    if (!this.classList.contains('visible') && !this.open) {
      return;
    }

    this.clearHideTimeout();
    this.clearOpenFrameRequest();
    this.hasPendingCloseEvent = this.classList.contains('visible');
    this.dispatchEvent(new CustomEvent('shared-panel-closing', {
      bubbles: true,
      composed: true,
      detail: { panelName: this.getPanelName() },
    }));
    if (restoreFocus) {
      this.restoreFocus();
    }
    this.open = false;
    this.classList.remove('visible');
    const panelShell = this.getPanelShell();
    if (panelShell) {
      panelShell.scrollTop = 0;
    }
    this.inert = true;
    this.setAttribute('aria-hidden', 'true');
    this.hideTimeoutId = window.setTimeout(() => {
      this.hideTimeoutId = 0;
      this.finalizeHidden();
    }, PANEL_HIDE_DELAY_MS);
  }

  finalizeHidden() {
    if (this.open) {
      return;
    }

    this.hidden = true;

    if (!this.hasPendingCloseEvent) {
      return;
    }

    this.hasPendingCloseEvent = false;
    this.dispatchEvent(new CustomEvent('shared-panel-closed', {
      bubbles: true,
      composed: true,
      detail: { panelName: this.getPanelName() },
    }));
  }

  handleCloseButtonClick() {
    this.closePanel();
  }

  handleShellTransitionEnd(event) {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') {
      return;
    }

    this.finalizeHidden();
  }

  render() {
    const hasHeaderActions = Boolean(this.querySelector('[slot="header-actions"]'));

    return html`
      <section
        class="panel-shell"
        role="dialog"
        aria-modal="true"
        aria-label=${this.panelTitle}
        @transitionend=${this.handleShellTransitionEnd}
      >
        <header
          class=${hasHeaderActions ? 'panel-header panel-header--with-actions' : 'panel-header'}
          part="header"
        >
          <h2 class="panel-title">${this.panelTitle}</h2>
          ${hasHeaderActions ? html`
            <div class="panel-header-actions">
              <slot name="header-actions"></slot>
            </div>
          ` : null}
          <button
            class="close-button"
            type="button"
            aria-label=${this.closeLabel}
            @click=${this.handleCloseButtonClick}
          >
            ${this.closeIconSrc
              ? html`
                  <img
                    class="close-button-icon"
                    src=${this.closeIconSrc}
                    alt=""
                    aria-hidden="true"
                  />
                `
              : html`<span class="close-button-glyph" aria-hidden="true">×</span>`}
          </button>
        </header>
        <div class="panel-body">
          <slot></slot>
        </div>
      </section>
    `;
  }
}

if (!customElements.get('shared-panel')) {
  customElements.define('shared-panel', SharedPanelElement);
}
