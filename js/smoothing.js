/**
 * smoothing.js - Adaptive 1€ (One Euro) Filter for Real-Time Gesture Pointer Smoothing
 *
 * Reference: Casiez, G., Roussel, N. and Vogel, D. (2012).
 * "1 € Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems."
 * Proceedings of ACM CHI 2012, pp. 2527-2530.
 *
 * Characteristics:
 * - Low cutoff frequency at low speeds to eliminate jitter and tremors while holding still.
 * - High cutoff frequency at high speeds to minimize latency during quick drawing motions.
 */

export const SMOOTHING_CONFIG = {
  DEFAULT_MIN_CUTOFF: 1.0,      // f_c_min: Minimum cutoff frequency in Hz (jitter reduction)
  DEFAULT_BETA: 0.02,           // beta: Speed coefficient (higher = less lag during rapid movement)
  DEFAULT_DERIVATIVE_CUTOFF: 1.0 // f_c_deriv: Fixed cutoff for speed low-pass filter in Hz
};

/**
 * Low-pass filter with exponential smoothing: y_i = alpha * x_i + (1 - alpha) * y_{i-1}
 */
class LowPassFilter {
  constructor(alpha = 0.5, initVal = 0) {
    this.alpha = alpha;
    this.y = initVal;
    this.initialized = false;
  }

  filter(x, alpha) {
    if (alpha !== undefined) this.alpha = alpha;
    if (!this.initialized) {
      this.y = x;
      this.initialized = true;
      return x;
    }
    this.y = this.alpha * x + (1.0 - this.alpha) * this.y;
    return this.y;
  }

  reset() {
    this.initialized = false;
    this.y = 0;
  }
}

/**
 * 1D One Euro Filter implementation.
 */
export class OneEuroFilter {
  /**
   * @param {number} minCutoff - Minimum cutoff frequency in Hz (f_c_min)
   * @param {number} beta - Speed coefficient
   * @param {number} dCutoff - Cutoff frequency for derivative filter in Hz
   */
  constructor(
    minCutoff = SMOOTHING_CONFIG.DEFAULT_MIN_CUTOFF,
    beta = SMOOTHING_CONFIG.DEFAULT_BETA,
    dCutoff = SMOOTHING_CONFIG.DEFAULT_DERIVATIVE_CUTOFF
  ) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;

    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
    this.lastTime = null;
    this.lastValue = null;
  }

  /**
   * Compute smoothing alpha from cutoff frequency and sample interval.
   * alpha = 1 / (1 + tau / dt) where tau = 1 / (2 * pi * fc)
   */
  _computeAlpha(rate, cutoff) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    const te = 1.0 / rate;
    return 1.0 / (1.0 + tau / te);
  }

  /**
   * Filters a single value at the given timestamp.
   * @param {number} x - Raw input value
   * @param {number} timestamp - Current timestamp in milliseconds
   * @returns {number} Filtered value
   */
  filter(x, timestamp) {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      this.lastValue = x;
      this.xFilter.filter(x, 1.0);
      this.dxFilter.filter(0, 1.0);
      return x;
    }

    const dt = (timestamp - this.lastTime) / 1000.0; // convert to seconds
    this.lastTime = timestamp;

    // Handle duplicate or out-of-order timestamps gracefully
    if (dt <= 0) {
      return this.lastValue !== null ? this.lastValue : x;
    }

    const rate = 1.0 / dt;

    // Calculate raw rate of change (derivative) and smooth it
    const dx = (x - (this.lastValue !== null ? this.lastValue : x)) * rate;
    const alphaD = this._computeAlpha(rate, this.dCutoff);
    const smoothedDx = this.dxFilter.filter(dx, alphaD);

    // Adaptive cutoff based on smoothed velocity: fc = fc_min + beta * |dx|
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDx);
    const alpha = this._computeAlpha(rate, cutoff);

    // Filter value with adaptive alpha
    const filteredX = this.xFilter.filter(x, alpha);
    this.lastValue = filteredX;
    return filteredX;
  }

  reset() {
    this.lastTime = null;
    this.lastValue = null;
    this.xFilter.reset();
    this.dxFilter.reset();
  }
}

/**
 * 2D One Euro Filter for smoothing (x, y) coordinates.
 */
export class OneEuroFilter2D {
  constructor(minCutoff, beta, dCutoff) {
    this.filterX = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.filterY = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.lastFiltered = null;
    this.lastSpeed = 0;
  }

  /**
   * Smooths an (x, y) point at the given timestamp.
   * @param {{x: number, y: number}} point - Raw coordinates
   * @param {number} timestamp - Timestamp in ms (e.g., performance.now())
   * @returns {{x: number, y: number, speed: number}} Filtered coordinates and instantaneous speed
   */
  filter(point, timestamp) {
    const fx = this.filterX.filter(point.x, timestamp);
    const fy = this.filterY.filter(point.y, timestamp);

    let speed = 0;
    if (this.lastFiltered) {
      const dx = fx - this.lastFiltered.x;
      const dy = fy - this.lastFiltered.y;
      speed = Math.hypot(dx, dy); // pixels per step
    }

    this.lastFiltered = { x: fx, y: fy };
    this.lastSpeed = speed;

    return { x: fx, y: fy, speed };
  }

  reset() {
    this.filterX.reset();
    this.filterY.reset();
    this.lastFiltered = null;
    this.lastSpeed = 0;
  }
}
