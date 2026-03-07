import { LitElement, html } from 'lit';
import {
  SAMPLE_COL_COUNT,
  SAMPLE_DIAMETER,
  SAMPLE_ROW_COUNT,
} from '../palette-extract-grid.js';

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback) {
  const normalizedValue = Math.floor(Number(value));
  if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return fallback;
  }

  return normalizedValue;
}

class SampleGridOverlayElement extends LitElement {
  static properties = {
    chosenIndices: { attribute: false },
    sampleColCount: { attribute: 'sample-col-count', type: Number },
    sampleDiameter: { attribute: 'sample-diameter', type: Number },
    sampleRowCount: { attribute: 'sample-row-count', type: Number },
    videoWidth: { attribute: 'video-width', type: Number },
    visible: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.chosenIndices = [];
    this.sampleColCount = SAMPLE_COL_COUNT;
    this.sampleDiameter = SAMPLE_DIAMETER;
    this.sampleRowCount = SAMPLE_ROW_COUNT;
    this.videoWidth = 0;
    this.visible = false;
    this._resizeObserver = null;
    this.classList.add('sample-row-overlay');
    this.setAttribute('aria-hidden', 'true');
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add('sample-row-overlay');
    this.setAttribute('aria-hidden', 'true');

    if (typeof ResizeObserver === 'function') {
      this._resizeObserver = new ResizeObserver(() => {
        this.updatePointSize();
      });
      this._resizeObserver.observe(this);
    }
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    super.disconnectedCallback();
  }

  updated(changedProperties) {
    if (
      changedProperties.has('sampleDiameter')
      || changedProperties.has('videoWidth')
      || changedProperties.has('visible')
    ) {
      this.updatePointSize();
    }

    if (changedProperties.has('visible')) {
      this.style.display = this.visible ? '' : 'none';
    }
  }

  updatePointSize() {
    if (!this.visible) {
      return;
    }

    const videoWidth = Number(this.videoWidth);
    if (!Number.isFinite(videoWidth) || videoWidth <= 0) {
      return;
    }

    const displayWidth = this.offsetWidth;
    if (displayWidth <= 0) {
      return;
    }

    const size = Math.max(
      2,
      Math.round(normalizePositiveInteger(this.sampleDiameter, SAMPLE_DIAMETER) * (displayWidth / videoWidth)),
    );

    this.style.setProperty('--sample-size', `${size}px`);
  }

  render() {
    const sampleColCount = normalizePositiveInteger(this.sampleColCount, SAMPLE_COL_COUNT);
    const sampleRowCount = normalizePositiveInteger(this.sampleRowCount, SAMPLE_ROW_COUNT);
    const chosenIndexSet = new Set(
      Array.isArray(this.chosenIndices)
        ? this.chosenIndices.map((value) => String(value))
        : [],
    );
    const templateParts = [];

    for (let row = 0; row < sampleRowCount; row += 1) {
      const rowPercent = ((row + 1) / (sampleRowCount + 1)) * 100;

      templateParts.push(html`
        <div class="sample-row-line" style=${`top: ${rowPercent}%;`}></div>
      `);

      for (let col = 0; col < sampleColCount; col += 1) {
        const gridIndex = String((col * sampleRowCount) + row);
        const className = chosenIndexSet.has(gridIndex)
          ? 'sample-row-point is-chosen'
          : 'sample-row-point';

        templateParts.push(html`
          <div
            class=${className}
            data-grid-index=${gridIndex}
            style=${`left: ${((col + 0.5) / sampleColCount) * 100}%; top: ${rowPercent}%;`}
          ></div>
        `);
      }
    }

    return html`${templateParts}`;
  }
}

if (!customElements.get('sample-grid-overlay')) {
  customElements.define('sample-grid-overlay', SampleGridOverlayElement);
}
