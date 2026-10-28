/**
 * handwriting.js - Client-Side Touchless Handwriting Recognition
 * High-accuracy alphanumeric recognition (0-9, A-Z, basic symbols)
 * powered by an enhanced P+ Point-Cloud Recognizer with canonical geometric templates
 * and topological micro-discriminators.
 *
 * Runs 100% locally in the browser with <1ms inference latency and zero external dependencies.
 */

export const HANDWRITING_CONFIG = {
  CANVAS_SIZE: 28,
  ACTIVE_AREA_SIZE: 20,
  STROKE_LINE_WIDTH: 2.2,
  MIN_STROKE_POINTS: 3,
  MIN_BOUNDING_BOX: 8.0, // Minimum screen-pixel box to filter stray noise
  RESAMPLE_POINTS: 36
};

// --- Canonical Template Construction Helpers ---
function line(x1, y1, x2, y2, steps = 10) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) });
  }
  return pts;
}

function arc(cx, cy, rx, ry, startAngle, endAngle, steps = 16) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = startAngle + t * (endAngle - startAngle);
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

// Canonical and multi-style handwritten templates for digits, uppercase letters, and symbols
const CANONICAL_TEMPLATES = [
  // Digits 0-9
  { char: "0", strokes: [[...arc(0.5, 0.5, 0.35, 0.44, -Math.PI / 2, 1.5 * Math.PI, 32)]] },
  { char: "1", strokes: [[...line(0.5, 0.05, 0.5, 0.95, 24)]] },
  {
    char: "1", // 1 with top serif
    strokes: [
      [...line(0.35, 0.25, 0.5, 0.05, 8), ...line(0.5, 0.05, 0.5, 0.95, 20)]
    ]
  },
  {
    char: "2",
    strokes: [
      [
        ...arc(0.5, 0.28, 0.32, 0.22, Math.PI, 0, 16),
        ...line(0.82, 0.28, 0.18, 0.92, 16),
        ...line(0.18, 0.92, 0.85, 0.92, 16)
      ]
    ]
  },
  {
    char: "3",
    strokes: [
      [
        ...arc(0.5, 0.28, 0.30, 0.22, Math.PI * 1.2, 0.3, 16),
        ...arc(0.5, 0.72, 0.34, 0.23, -0.3, Math.PI * 0.85, 16)
      ]
    ]
  },
  {
    char: "4", // standard open 4
    strokes: [
      [...line(0.75, 0.05, 0.75, 0.95, 20)],
      [...line(0.75, 0.65, 0.15, 0.65, 12), ...line(0.15, 0.65, 0.55, 0.08, 14)]
    ]
  },
  {
    char: "4", // closed 4
    strokes: [
      [...line(0.5, 0.08, 0.15, 0.65, 12), ...line(0.15, 0.65, 0.82, 0.65, 14)],
      [...line(0.75, 0.25, 0.75, 0.95, 16)]
    ]
  },
  {
    char: "5",
    strokes: [
      [
        ...line(0.80, 0.10, 0.22, 0.10, 10),
        ...line(0.22, 0.10, 0.22, 0.45, 10),
        ...arc(0.48, 0.70, 0.32, 0.24, -Math.PI * 0.6, Math.PI * 0.75, 16)
      ]
    ]
  },
  {
    char: "6",
    strokes: [
      [
        ...arc(0.60, 0.30, 0.35, 0.25, -Math.PI * 0.3, -Math.PI * 0.9, 12),
        ...arc(0.50, 0.68, 0.32, 0.25, Math.PI, -Math.PI, 22)
      ]
    ]
  },
  {
    char: "7",
    strokes: [
      [
        ...line(0.15, 0.10, 0.85, 0.10, 12),
        ...line(0.85, 0.10, 0.35, 0.95, 20)
      ]
    ]
  },
  {
    char: "7", // 7 with crossbar
    strokes: [
      [...line(0.15, 0.10, 0.85, 0.10, 12), ...line(0.85, 0.10, 0.35, 0.95, 20)],
      [...line(0.40, 0.52, 0.75, 0.52, 8)]
    ]
  },
  {
    char: "8",
    strokes: [
      [
        ...arc(0.5, 0.30, 0.26, 0.22, -Math.PI / 2, 1.5 * Math.PI, 18),
        ...arc(0.5, 0.72, 0.32, 0.25, 1.5 * Math.PI, -Math.PI / 2, 20)
      ]
    ]
  },
  {
    char: "9",
    strokes: [
      [
        ...arc(0.50, 0.32, 0.32, 0.25, 0, 2 * Math.PI, 20),
        ...line(0.82, 0.32, 0.82, 0.92, 16)
      ]
    ]
  },

  // Uppercase Letters A-Z
  {
    char: "A",
    strokes: [
      [...line(0.15, 0.95, 0.50, 0.08, 16), ...line(0.50, 0.08, 0.85, 0.95, 16)],
      [...line(0.28, 0.60, 0.72, 0.60, 12)]
    ]
  },
  {
    char: "A", // 1-stroke continuous A
    strokes: [
      [
        ...line(0.15, 0.95, 0.50, 0.08, 14),
        ...line(0.50, 0.08, 0.85, 0.95, 14),
        ...line(0.85, 0.95, 0.72, 0.60, 8),
        ...line(0.72, 0.60, 0.28, 0.60, 10)
      ]
    ]
  },
  {
    char: "B",
    strokes: [
      [...line(0.20, 0.08, 0.20, 0.92, 20)],
      [...arc(0.35, 0.30, 0.32, 0.22, -Math.PI / 2, Math.PI / 2, 14)],
      [...arc(0.35, 0.70, 0.36, 0.22, -Math.PI / 2, Math.PI / 2, 14)]
    ]
  },
  {
    char: "B", // 1-stroke B
    strokes: [
      [
        ...line(0.20, 0.92, 0.20, 0.08, 16),
        ...arc(0.35, 0.30, 0.32, 0.22, -Math.PI / 2, Math.PI / 2, 14),
        ...arc(0.35, 0.70, 0.36, 0.22, -Math.PI / 2, Math.PI / 2, 14),
        ...line(0.35, 0.92, 0.20, 0.92, 6)
      ]
    ]
  },
  {
    char: "C",
    strokes: [[...arc(0.55, 0.50, 0.38, 0.42, -Math.PI * 0.75, Math.PI * 0.75, 28)]]
  },
  {
    char: "D",
    strokes: [
      [...line(0.20, 0.08, 0.20, 0.92, 20)],
      [...arc(0.35, 0.50, 0.45, 0.42, -Math.PI / 2, Math.PI / 2, 20)]
    ]
  },
  {
    char: "E",
    strokes: [
      [...line(0.20, 0.08, 0.20, 0.92, 18)],
      [...line(0.20, 0.08, 0.80, 0.08, 12)],
      [...line(0.20, 0.50, 0.65, 0.50, 10)],
      [...line(0.20, 0.92, 0.80, 0.92, 12)]
    ]
  },
  {
    char: "F",
    strokes: [
      [...line(0.20, 0.08, 0.20, 0.92, 18)],
      [...line(0.20, 0.08, 0.80, 0.08, 12)],
      [...line(0.20, 0.50, 0.65, 0.50, 10)]
    ]
  },
  {
    char: "G",
    strokes: [
      [
        ...arc(0.55, 0.50, 0.38, 0.42, -Math.PI * 0.75, Math.PI * 0.70, 24),
        ...line(0.78, 0.60, 0.78, 0.50, 6),
        ...line(0.78, 0.50, 0.55, 0.50, 8)
      ]
    ]
  },
  {
    char: "H",
    strokes: [
      [...line(0.20, 0.08, 0.20, 0.92, 16)],
      [...line(0.80, 0.08, 0.80, 0.92, 16)],
      [...line(0.20, 0.50, 0.80, 0.50, 12)]
    ]
  },
  {
    char: "I",
    strokes: [
      [...line(0.50, 0.08, 0.50, 0.92, 20)],
      [...line(0.28, 0.08, 0.72, 0.08, 10)],
      [...line(0.28, 0.92, 0.72, 0.92, 10)]
    ]
  },
  {
    char: "J",
    strokes: [
      [...line(0.70, 0.08, 0.70, 0.70, 18), ...arc(0.45, 0.70, 0.25, 0.22, 0, Math.PI * 0.85, 12)]
    ]
  },
  {
    char: "K",
    strokes: [
      [...line(0.20, 0.08, 0.20, 0.92, 18)],
      [...line(0.80, 0.12, 0.22, 0.50, 14)],
      [...line(0.22, 0.50, 0.82, 0.92, 14)]
    ]
  },
  {
    char: "L",
    strokes: [
      [...line(0.20, 0.08, 0.20, 0.92, 18), ...line(0.20, 0.92, 0.80, 0.92, 14)]
    ]
  },
  {
    char: "M",
    strokes: [
      [
        ...line(0.15, 0.92, 0.15, 0.08, 14),
        ...line(0.15, 0.08, 0.50, 0.60, 12),
        ...line(0.50, 0.60, 0.85, 0.08, 12),
        ...line(0.85, 0.08, 0.85, 0.92, 14)
      ]
    ]
  },
  {
    char: "N",
    strokes: [
      [
        ...line(0.18, 0.92, 0.18, 0.08, 16),
        ...line(0.18, 0.08, 0.82, 0.92, 20),
        ...line(0.82, 0.92, 0.82, 0.08, 16)
      ]
    ]
  },
  {
    char: "O",
    strokes: [[...arc(0.5, 0.5, 0.38, 0.42, -Math.PI / 2, 1.5 * Math.PI, 32)]]
  },
  {
    char: "P",
    strokes: [
      [...line(0.20, 0.08, 0.20, 0.92, 20)],
      [...arc(0.35, 0.35, 0.38, 0.26, -Math.PI / 2, Math.PI / 2, 16)]
    ]
  },
  {
    char: "Q",
    strokes: [
      [...arc(0.5, 0.48, 0.36, 0.40, -Math.PI / 2, 1.5 * Math.PI, 28)],
      [...line(0.55, 0.65, 0.88, 0.95, 8)]
    ]
  },
  {
    char: "R",
    strokes: [
      [...line(0.20, 0.08, 0.20, 0.92, 20)],
      [...arc(0.35, 0.35, 0.38, 0.26, -Math.PI / 2, Math.PI / 2, 16)],
      [...line(0.45, 0.55, 0.82, 0.92, 12)]
    ]
  },
  {
    char: "S",
    strokes: [
      [
        ...arc(0.52, 0.30, 0.30, 0.22, 0, -Math.PI * 1.1, 14),
        ...arc(0.48, 0.70, 0.32, 0.24, -Math.PI * 0.1, Math.PI, 14)
      ]
    ]
  },
  {
    char: "T",
    strokes: [
      [...line(0.15, 0.08, 0.85, 0.08, 14)],
      [...line(0.50, 0.08, 0.50, 0.92, 20)]
    ]
  },
  {
    char: "U",
    strokes: [
      [
        ...line(0.20, 0.08, 0.20, 0.65, 14),
        ...arc(0.50, 0.65, 0.30, 0.27, Math.PI, 0, 16),
        ...line(0.80, 0.65, 0.80, 0.08, 14)
      ]
    ]
  },
  {
    char: "V",
    strokes: [
      [...line(0.15, 0.08, 0.50, 0.92, 18), ...line(0.50, 0.92, 0.85, 0.08, 18)]
    ]
  },
  {
    char: "W",
    strokes: [
      [
        ...line(0.12, 0.08, 0.30, 0.92, 12),
        ...line(0.30, 0.92, 0.50, 0.35, 10),
        ...line(0.50, 0.35, 0.70, 0.92, 10),
        ...line(0.70, 0.92, 0.88, 0.08, 12)
      ]
    ]
  },
  {
    char: "X",
    strokes: [
      [...line(0.18, 0.08, 0.82, 0.92, 18)],
      [...line(0.82, 0.08, 0.18, 0.92, 18)]
    ]
  },
  {
    char: "Y",
    strokes: [
      [...line(0.15, 0.08, 0.50, 0.48, 12)],
      [...line(0.85, 0.08, 0.50, 0.48, 12)],
      [...line(0.50, 0.48, 0.50, 0.92, 14)]
    ]
  },
  {
    char: "Z",
    strokes: [
      [
        ...line(0.18, 0.08, 0.82, 0.08, 14),
        ...line(0.82, 0.08, 0.18, 0.92, 20),
        ...line(0.18, 0.92, 0.82, 0.92, 14)
      ]
    ]
  },

  // Basic Symbols
  {
    char: "+",
    strokes: [
      [...line(0.5, 0.15, 0.5, 0.85, 14)],
      [...line(0.15, 0.5, 0.85, 0.5, 14)]
    ]
  },
  {
    char: "-",
    strokes: [
      [...line(0.15, 0.5, 0.85, 0.5, 16)]
    ]
  },
  {
    char: "?",
    strokes: [
      [...arc(0.5, 0.30, 0.28, 0.22, Math.PI, 0, 12), ...line(0.78, 0.30, 0.50, 0.58, 10), ...line(0.50, 0.58, 0.50, 0.72, 8)],
      [{ x: 0.50, y: 0.88 }]
    ]
  }
];

/**
 * Resamples stroke points into targetCount equidistant coordinates along arc length.
 */
function resamplePoints(points, targetCount = HANDWRITING_CONFIG.RESAMPLE_POINTS) {
  if (!points || points.length === 0) return [];
  if (points.length === 1) {
    return Array(targetCount).fill({ x: points[0].x, y: points[0].y });
  }

  let totalDist = 0;
  for (let i = 1; i < points.length; i++) {
    totalDist += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  if (totalDist === 0) {
    return Array(targetCount).fill({ x: points[0].x, y: points[0].y });
  }

  const interval = totalDist / (targetCount - 1);
  const result = [{ x: points[0].x, y: points[0].y }];
  let distCovered = 0;
  let currIdx = 0;
  let currPt = points[0];

  while (result.length < targetCount && currIdx < points.length - 1) {
    const nextPt = points[currIdx + 1];
    const segLen = Math.hypot(nextPt.x - currPt.x, nextPt.y - currPt.y);

    if (distCovered + segLen >= interval) {
      const t = (interval - distCovered) / (segLen || 0.0001);
      const newPt = {
        x: currPt.x + t * (nextPt.x - currPt.x),
        y: currPt.y + t * (nextPt.y - currPt.y)
      };
      result.push(newPt);
      currPt = newPt;
      distCovered = 0;
    } else {
      distCovered += segLen;
      currIdx++;
      currPt = points[currIdx];
    }
  }

  while (result.length < targetCount) {
    result.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  }

  return result;
}

/**
 * Normalizes multi-stroke coordinates into a canonical [0, 1] x [0, 1] bounding box
 * while preserving character aspect ratio and centering.
 */
function normalizeCloud(strokes) {
  let allPts = [];
  for (const s of strokes) {
    if (s.points) allPts.push(...s.points);
    else if (Array.isArray(s)) allPts.push(...s);
  }
  if (allPts.length === 0) return { cloud: [], ar: 1.0, w: 0, h: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of allPts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const w = Math.max(0.001, maxX - minX);
  const h = Math.max(0.001, maxY - minY);
  const ar = w / h;
  const maxDim = Math.max(w, h);

  const resampledAll = [];
  const totalStrokePts = allPts.length;

  for (const s of strokes) {
    const pts = s.points ? s.points : s;
    if (!pts || pts.length === 0) continue;
    const count = Math.max(4, Math.round((pts.length / totalStrokePts) * HANDWRITING_CONFIG.RESAMPLE_POINTS));
    const normalizedS = pts.map(p => ({
      x: (p.x - minX) / maxDim + (1 - w / maxDim) / 2,
      y: (p.y - minY) / maxDim + (1 - h / maxDim) / 2
    }));
    resampledAll.push(...resamplePoints(normalizedS, count));
  }

  return {
    cloud: resamplePoints(resampledAll, HANDWRITING_CONFIG.RESAMPLE_POINTS),
    ar,
    w,
    h
  };
}

/**
 * Computes bidirectional point-cloud distance (Chamfer / Hausdorff-mean distance).
 */
function pointCloudDistance(cloudA, cloudB) {
  let sumA = 0;
  for (let i = 0; i < cloudA.length; i++) {
    const a = cloudA[i];
    let minDist = Infinity;
    for (let j = 0; j < cloudB.length; j++) {
      const b = cloudB[j];
      const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      if (d < minDist) minDist = d;
    }
    sumA += Math.sqrt(minDist);
  }

  let sumB = 0;
  for (let j = 0; j < cloudB.length; j++) {
    const b = cloudB[j];
    let minDist = Infinity;
    for (let i = 0; i < cloudA.length; i++) {
      const a = cloudA[i];
      const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      if (d < minDist) minDist = d;
    }
    sumB += Math.sqrt(minDist);
  }

  return (sumA / cloudA.length + sumB / cloudB.length) / 2;
}

// Pre-normalize all template point clouds once at module load
const PROCESSED_TEMPLATES = CANONICAL_TEMPLATES.map(t => {
  const norm = normalizeCloud(t.strokes);
  return {
    char: t.char,
    cloud: norm.cloud,
    ar: norm.ar,
    numStrokes: t.strokes.length
  };
});

export class HandwritingClassifier {
  constructor() {
    this.isModelAvailable = true;
    this.isLoading = false;
  }

  /**
   * Initializes the handwriting recognition engine.
   */
  async loadModel(onStatusUpdate = () => {}) {
    this.isLoading = false;
    this.isModelAvailable = true;
    onStatusUpdate("Handwriting engine active (P+ Point-Cloud & Topological Matcher ready).");
    return true;
  }

  /**
   * Classifies user-drawn strokes into the best-matching alphanumeric character.
   * @param {Array<{x: number, y: number}>} points - Raw points sequence
   * @param {Array<Object>} [strokes] - Optional constituent stroke objects
   * @returns {Promise<{char: string, confidence: number, top3: Array}|null>}
   */
  async classify(points, strokes = null) {
    const strokeList = strokes && strokes.length > 0 ? strokes : [{ points }];
    const norm = normalizeCloud(strokeList);

    if (!norm.cloud || norm.cloud.length === 0) return null;
    if (norm.w < HANDWRITING_CONFIG.MIN_BOUNDING_BOX && norm.h < HANDWRITING_CONFIG.MIN_BOUNDING_BOX) {
      return null;
    }

    const queryCloud = norm.cloud;
    const queryAR = norm.ar;
    const numStrokes = strokeList.length;

    // Extract micro-topological features from normalized cloud
    let midRightX = 0;
    let botRightCount = 0;
    let topCenterCount = 0;
    let botCenterCount = 0;
    let leftSpineCount = 0;

    for (const p of queryCloud) {
      if (p.y >= 0.40 && p.y <= 0.60) {
        if (p.x > midRightX) midRightX = p.x;
      }
      if (p.x >= 0.60 && p.y >= 0.65) botRightCount++;
      if (p.x >= 0.35 && p.x <= 0.65 && p.y <= 0.20) topCenterCount++;
      if (p.x >= 0.35 && p.x <= 0.65 && p.y >= 0.80) botCenterCount++;
      if (p.x <= 0.28 && p.y >= 0.25 && p.y <= 0.75) leftSpineCount++;
    }

    const candidates = [];

    for (const t of PROCESSED_TEMPLATES) {
      let d = pointCloudDistance(queryCloud, t.cloud);

      // 1. Aspect Ratio Matching
      if (queryAR < 0.35 && t.ar > 0.6) {
        d += 0.40;
      } else if (queryAR > 1.8 && t.ar < 1.0) {
        d += 0.40;
      }

      // 2. Stroke Count Compatibility (soft preference)
      if (numStrokes === 1) {
        if (["E", "H", "X", "+"].includes(t.char) && t.numStrokes > 2) d += 0.08;
      } else if (numStrokes >= 2) {
        if (["O", "0", "C", "S", "8", "6", "9"].includes(t.char)) d += 0.08;
      }

      // 3. Middle-Right indentation for 'B' vs 'D' / '0' / 'O'
      if (t.char === "B") {
        if (midRightX > 0.75) d += 0.16; // B must have center indent
      } else if (["D", "O", "0"].includes(t.char)) {
        if (midRightX < 0.55) d += 0.16; // D, O, 0 have right bulge at mid height
      }

      // 4. 'P' vs 'R': R has bottom-right leg; P is empty
      if (t.char === "P" && botRightCount > 3) {
        d += 0.20;
      } else if (t.char === "R" && botRightCount <= 1) {
        d += 0.20;
      }

      // 5. 'U' / 'V' vs 'D' / 'O': U and V are open at top
      if (["U", "V", "W", "Y"].includes(t.char)) {
        if (topCenterCount > 4) d += 0.20;
      }

      // 6. 'F' vs 'E': E has bottom horizontal bar, F does not
      if (t.char === "F" && botCenterCount > 4) {
        d += 0.15;
      }

      candidates.push({ char: t.char, dist: d });
    }

    // Deduplicate candidates by taking lowest distance per character
    const bestPerChar = {};
    for (const c of candidates) {
      if (!bestPerChar[c.char] || c.dist < bestPerChar[c.char].dist) {
        bestPerChar[c.char] = c;
      }
    }

    const sorted = Object.values(bestPerChar).sort((a, b) => a.dist - b.dist);
    if (sorted.length === 0) return null;

    const top = sorted[0];
    const second = sorted[1] || { dist: top.dist + 0.1 };
    const margin = Math.max(0.01, second.dist - top.dist);

    // Compute intuitive confidence percentage (50% to 99%)
    const rawConf = (1.0 - top.dist / 0.25) * 80 + margin * 100;
    const confidence = Math.min(99.0, Math.max(50.0, rawConf));

    const top3 = sorted.slice(0, 3).map(s => ({
      char: s.char,
      confidence: Math.round(Math.min(99, Math.max(20, (1.0 - s.dist / 0.28) * 100)))
    }));

    return {
      char: top.char,
      confidence: Math.round(confidence * 10) / 10,
      top3
    };
  }
}
