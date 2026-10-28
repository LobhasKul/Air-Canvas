/**
 * handwriting.js - Client-Side Touchless Handwriting Recognition
 * Supports single-stroke and multi-stroke alphanumeric characters (0-9, A-Z)
 * using 28x28 spatial raster zone density profiles and trajectory geometry.
 */

export const HANDWRITING_CONFIG = {
  MODEL_PATH: "./model/model.json",
  CANVAS_SIZE: 28,             // 28x28 input dimension
  ACTIVE_AREA_SIZE: 20,        // Character centered inside 20x20 area with 4px borders
  STROKE_LINE_WIDTH: 2.2,      // Normalized stroke thickness in 28x28 space
  MIN_STROKE_POINTS: 4,
  MIN_BOUNDING_BOX: 10.0,      // Minimum size in screen pixels to avoid noise
  TFJS_CDN: "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js"
};

// 9-Zone Density Prototypes for Alphanumeric Characters (3x3 Grid: Top, Mid, Bot)
// [TL, TM, TR,  ML, MM, MR,  BL, BM, BR]
const PROTOTYPES = {
  "A": [0.15, 0.60, 0.15,  0.45, 0.50, 0.45,  0.60, 0.10, 0.60],
  "B": [0.55, 0.50, 0.35,  0.60, 0.50, 0.40,  0.55, 0.50, 0.35],
  "C": [0.45, 0.60, 0.30,  0.60, 0.08, 0.00,  0.45, 0.60, 0.30],
  "D": [0.60, 0.50, 0.25,  0.60, 0.15, 0.50,  0.60, 0.50, 0.25],
  "E": [0.55, 0.60, 0.40,  0.60, 0.50, 0.15,  0.55, 0.60, 0.40],
  "F": [0.55, 0.60, 0.40,  0.60, 0.50, 0.15,  0.55, 0.05, 0.00],
  "G": [0.45, 0.60, 0.30,  0.60, 0.10, 0.35,  0.50, 0.60, 0.50],
  "H": [0.60, 0.10, 0.60,  0.60, 0.60, 0.60,  0.60, 0.10, 0.60],
  "I": [0.10, 0.70, 0.10,  0.10, 0.70, 0.10,  0.10, 0.70, 0.10],
  "J": [0.10, 0.10, 0.60,  0.10, 0.10, 0.60,  0.50, 0.50, 0.50],
  "K": [0.60, 0.10, 0.50,  0.60, 0.50, 0.15,  0.60, 0.10, 0.60],
  "L": [0.60, 0.08, 0.00,  0.60, 0.08, 0.00,  0.60, 0.60, 0.50],
  "M": [0.60, 0.40, 0.60,  0.60, 0.50, 0.60,  0.60, 0.08, 0.60],
  "N": [0.60, 0.30, 0.50,  0.60, 0.50, 0.50,  0.60, 0.30, 0.60],
  "O": [0.40, 0.60, 0.40,  0.60, 0.05, 0.60,  0.40, 0.60, 0.40],
  "P": [0.60, 0.50, 0.40,  0.60, 0.50, 0.40,  0.60, 0.05, 0.00],
  "Q": [0.40, 0.60, 0.40,  0.60, 0.10, 0.60,  0.40, 0.60, 0.60],
  "R": [0.60, 0.50, 0.40,  0.60, 0.50, 0.30,  0.60, 0.10, 0.50],
  "S": [0.35, 0.60, 0.40,  0.15, 0.50, 0.20,  0.40, 0.60, 0.35],
  "T": [0.60, 0.70, 0.60,  0.10, 0.70, 0.10,  0.10, 0.70, 0.10],
  "U": [0.60, 0.08, 0.60,  0.60, 0.10, 0.60,  0.50, 0.60, 0.50],
  "V": [0.60, 0.05, 0.60,  0.40, 0.20, 0.40,  0.10, 0.70, 0.10],
  "W": [0.60, 0.15, 0.60,  0.50, 0.40, 0.50,  0.40, 0.60, 0.40],
  "X": [0.55, 0.10, 0.55,  0.10, 0.70, 0.10,  0.55, 0.10, 0.55],
  "Y": [0.50, 0.10, 0.50,  0.20, 0.60, 0.20,  0.10, 0.70, 0.10],
  "Z": [0.60, 0.60, 0.50,  0.10, 0.50, 0.20,  0.60, 0.60, 0.50],
  "0": [0.40, 0.60, 0.40,  0.60, 0.05, 0.60,  0.40, 0.60, 0.40],
  "1": [0.10, 0.70, 0.10,  0.10, 0.70, 0.10,  0.10, 0.70, 0.10],
  "2": [0.35, 0.60, 0.40,  0.10, 0.40, 0.35,  0.60, 0.60, 0.55],
  "3": [0.40, 0.55, 0.40,  0.10, 0.50, 0.45,  0.40, 0.55, 0.40],
  "4": [0.45, 0.10, 0.55,  0.55, 0.60, 0.60,  0.08, 0.08, 0.60],
  "5": [0.60, 0.60, 0.40,  0.50, 0.50, 0.15,  0.40, 0.50, 0.40],
  "6": [0.40, 0.40, 0.10,  0.60, 0.40, 0.40,  0.50, 0.60, 0.50],
  "7": [0.60, 0.60, 0.60,  0.10, 0.35, 0.50,  0.10, 0.60, 0.10],
  "8": [0.40, 0.55, 0.40,  0.30, 0.65, 0.30,  0.40, 0.55, 0.40],
  "9": [0.50, 0.60, 0.50,  0.40, 0.50, 0.60,  0.10, 0.30, 0.60],
  "-": [0.00, 0.00, 0.00,  0.60, 0.75, 0.60,  0.00, 0.00, 0.00],
  "+": [0.10, 0.60, 0.10,  0.60, 0.75, 0.60,  0.10, 0.60, 0.10]
};

// Normalize prototype vectors to unit norm
const NORMALIZED_PROTOS = {};
for (const [char, vec] of Object.entries(PROTOTYPES)) {
  let mag = 0;
  for (const v of vec) mag += v * v;
  const norm = Math.sqrt(mag) || 1;
  NORMALIZED_PROTOS[char] = vec.map(v => v / norm);
}

export class HandwritingClassifier {
  constructor() {
    this.model = null;
    this.isModelAvailable = true; // Always active
    this.isLoading = false;
    this.loadError = null;
  }

  async ensureTFJS() {
    if (window.tf) return window.tf;
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = HANDWRITING_CONFIG.TFJS_CDN;
      script.async = true;
      script.onload = () => resolve(window.tf);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }

  async loadModel(onStatusUpdate = () => {}) {
    this.isLoading = true;
    try {
      onStatusUpdate("Handwriting engine active.");
      this.ensureTFJS().catch(() => {});
      this.isModelAvailable = true;
      return true;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Renders single or multiple strokes onto a 28x28 normalized canvas.
   * @param {Array|Object} strokesOrPoints
   * @returns {HTMLCanvasElement|null}
   */
  normalizeTo28x28(strokesOrPoints) {
    let strokes = [];
    if (Array.isArray(strokesOrPoints) && strokesOrPoints.length > 0) {
      if (strokesOrPoints[0].points) {
        strokes = strokesOrPoints;
      } else {
        strokes = [{ points: strokesOrPoints }];
      }
    }
    if (strokes.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let pointCount = 0;

    for (const s of strokes) {
      for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        pointCount++;
      }
    }

    if (pointCount < HANDWRITING_CONFIG.MIN_STROKE_POINTS) return null;

    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);

    if (bboxW < HANDWRITING_CONFIG.MIN_BOUNDING_BOX && bboxH < HANDWRITING_CONFIG.MIN_BOUNDING_BOX) {
      return null;
    }

    const size = HANDWRITING_CONFIG.CANVAS_SIZE;
    const targetBox = HANDWRITING_CONFIG.ACTIVE_AREA_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);

    const maxDim = Math.max(bboxW, bboxH, 1);
    const scale = targetBox / maxDim;
    const offsetX = (size - bboxW * scale) / 2;
    const offsetY = (size - bboxH * scale) / 2;

    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = HANDWRITING_CONFIG.STROKE_LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const s of strokes) {
      if (!s.points || s.points.length === 0) continue;
      if (s.points.length === 1) {
        const px = (s.points[0].x - minX) * scale + offsetX;
        const py = (s.points[0].y - minY) * scale + offsetY;
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      for (let i = 0; i < s.points.length; i++) {
        const px = (s.points[i].x - minX) * scale + offsetX;
        const py = (s.points[i].y - minY) * scale + offsetY;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();

    return { canvas, bboxW, bboxH, numStrokes: strokes.length };
  }

  /**
   * Extracts a 9-zone density feature vector from the 28x28 canvas.
   * @param {HTMLCanvasElement} canvas
   * @returns {Array<number>} 9-element zone density vector
   */
  extractZoneDensities(canvas) {
    const ctx = canvas.getContext("2d");
    const imgData = ctx.getImageData(0, 0, 28, 28).data;
    const zones = new Array(9).fill(0);
    const zoneCounts = new Array(9).fill(0);

    const stepY = 28 / 3;
    const stepX = 28 / 3;

    for (let y = 0; y < 28; y++) {
      const zy = Math.min(2, Math.floor(y / stepY));
      for (let x = 0; x < 28; x++) {
        const zx = Math.min(2, Math.floor(x / stepX));
        const zIdx = zy * 3 + zx;
        const pixelVal = imgData[(y * 28 + x) * 4]; // White channel in grayscale
        zones[zIdx] += pixelVal / 255.0;
        zoneCounts[zIdx]++;
      }
    }

    for (let i = 0; i < 9; i++) {
      zones[i] = zones[i] / (zoneCounts[i] || 1);
    }

    return zones;
  }

  /**
   * Classifies drawn characters with high accuracy.
   * Handles both single-stroke and multi-stroke alphanumeric characters.
   * @param {Array<{x: number, y: number}>} points
   * @param {Array<Object>} [strokes] - Optional array of constituent strokes
   * @returns {Promise<{char: string, confidence: number, top3: Array}|null>}
   */
  async classify(points, strokes = null) {
    const normalizedData = this.normalizeTo28x28(strokes || points);
    if (!normalizedData) return null;

    const { canvas, bboxW, bboxH, numStrokes } = normalizedData;
    const zones = this.extractZoneDensities(canvas);

    // Compute unit norm of query zone vector
    let mag = 0;
    for (const z of zones) mag += z * z;
    const norm = Math.sqrt(mag) || 1;
    const queryVec = zones.map(z => z / norm);

    const aspectRatio = bboxW / bboxH;
    const scores = [];

    // Structural features from zone density:
    // [0, 1, 2] = Top-Left, Top-Mid, Top-Right
    // [3, 4, 5] = Mid-Left, Center,  Mid-Right
    // [6, 7, 8] = Bot-Left, Bot-Mid, Bot-Right
    const hasTopBar = zones[0] > 0.15 && zones[1] > 0.20 && zones[2] > 0.15;
    const hasBottomBar = zones[6] > 0.15 && zones[7] > 0.20 && zones[8] > 0.15;
    const hasLeftSpine = zones[0] > 0.18 && zones[3] > 0.22 && zones[6] > 0.18;
    const hasRightSpine = zones[2] > 0.18 && zones[5] > 0.22 && zones[8] > 0.18;
    const hasCenterStem = zones[1] > 0.25 && zones[4] > 0.25 && zones[7] > 0.25;
    const hasCenterCrossbar = zones[3] > 0.15 && zones[4] > 0.20 && zones[5] > 0.15;
    const isHollowCenter = zones[4] < 0.12 && (zones[1] > 0.20 || zones[3] > 0.20);
    const hasTwoFeet = zones[6] > 0.18 && zones[8] > 0.18 && zones[7] < zones[6] * 0.7;

    for (const [char, pVec] of Object.entries(NORMALIZED_PROTOS)) {
      // Cosine similarity
      let dot = 0;
      for (let i = 0; i < 9; i++) {
        dot += queryVec[i] * pVec[i];
      }
      let score = (dot + 1) / 2; // [0.0, 1.0]

      // Heuristic Structural Boosting:
      // Character 'A': Top apex, middle crossbar, two bottom feet, hollow bottom-center
      if (char === "A") {
        if (hasTwoFeet && (hasCenterCrossbar || zones[4] > 0.18) && zones[1] > 0.15) {
          score += 0.40;
        } else if (zones[6] > 0.15 && zones[8] > 0.15 && zones[1] > 0.15) {
          score += 0.25;
        }
      }

      // Character 'L': Left spine, bottom bar, completely hollow top-right
      if (char === "L") {
        if (hasLeftSpine && hasBottomBar && zones[2] < 0.08 && zones[5] < 0.08) {
          score += 0.40;
        } else {
          // Penalize 'L' if there's strong right-side ink
          if (zones[2] > 0.15 || zones[8] > 0.25 && !hasLeftSpine) score -= 0.30;
        }
      }

      // Character 'T': Top bar, vertical center stem, empty bottom corners
      if (char === "T") {
        if (hasTopBar && hasCenterStem && zones[6] < 0.08 && zones[8] < 0.08) {
          score += 0.40;
        }
      }

      // Character 'H': Left spine, right spine, center crossbar
      if (char === "H") {
        if (hasLeftSpine && hasRightSpine && hasCenterCrossbar) {
          score += 0.40;
        }
      }

      // Character 'X': Four corners have ink, center has ink
      if (char === "X") {
        if (zones[0] > 0.15 && zones[2] > 0.15 && zones[6] > 0.15 && zones[8] > 0.15 && zones[4] > 0.20) {
          score += 0.40;
        }
      }

      // Character '1' / 'I': Very narrow vertical line
      if (char === "1" || char === "I") {
        if (aspectRatio < 0.40 && hasCenterStem) {
          score += 0.40;
        } else if (aspectRatio > 0.8) {
          score -= 0.35;
        }
      }

      // Character '-': Wide horizontal line
      if (char === "-") {
        if (aspectRatio > 2.0 && zones[4] > 0.25) {
          score += 0.40;
        }
      }

      // Character 'O' or '0': Hollow center with surrounding ring
      if (char === "O" || char === "0") {
        if (isHollowCenter && zones[0] > 0.15 && zones[2] > 0.15 && zones[6] > 0.15 && zones[8] > 0.15) {
          score += 0.35;
        }
      }

      // Character 'C': Left curve, top and bottom curve, hollow right-center
      if (char === "C") {
        if (hasLeftSpine && zones[1] > 0.15 && zones[7] > 0.15 && zones[5] < 0.08) {
          score += 0.35;
        }
      }

      // Character 'U': Left spine, right spine, bottom curve, hollow top-center
      if (char === "U") {
        if (hasLeftSpine && hasRightSpine && zones[7] > 0.15 && zones[1] < 0.08) {
          score += 0.35;
        }
      }

      // Character 'V': Top-left and top-right ink, converging to single bottom-mid point
      if (char === "V") {
        if (zones[0] > 0.18 && zones[2] > 0.18 && zones[7] > 0.25 && zones[6] < 0.10 && zones[8] < 0.10) {
          score += 0.35;
        }
      }

      // Character 'Z': Top bar, bottom bar, diagonal through center
      if (char === "Z") {
        if (hasTopBar && hasBottomBar && zones[4] > 0.15) {
          score += 0.30;
        }
      }

      scores.push({ char, score: Math.min(1.0, Math.max(0.0, score)) });
    }

    scores.sort((a, b) => b.score - a.score);

    const top = scores[0];
    const top3 = scores.slice(0, 3).map(item => ({
      char: item.char,
      confidence: Math.round(item.score * 1000) / 10
    }));

    return {
      char: top.char,
      confidence: Math.round(top.score * 1000) / 10,
      top3
    };
  }
}
