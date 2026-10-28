/**
 * shapes.js - Geometric heuristic shape snapping (Line, Circle, Rectangle, Triangle)
 *
 * Algorithm Pipeline:
 * 1. Pause Detection: Monitors pointer speed at the end of an active stroke.
 *    If pointer remains stationary (<18 px/s) for ~600 ms, shape snapping triggers.
 * 2. Spatial Resampling: Normalizes stroke into equidistant points to remove temporal clustering.
 * 3. Straight Line Detection: Ratio of endpoint distance to total arc length (straightness >= 0.88).
 * 4. Closure Analysis: Evaluates whether start and end points meet.
 * 5. Circle Detection: For closed shapes, calculates centroid and radial coefficient of variation (sigma_r / r_mean <= 0.16).
 * 6. Polygon Corner Detection: Ramer-Douglas-Peucker simplification; analyzes corner angles for 3-corner triangles and 4-corner rectangles.
 */

export const SHAPE_CONFIG = {
  PAUSE_DURATION_MS: 600,             // Required stationary pause time to trigger snap
  STATIONARY_SPEED_THRESHOLD: 18.0,   // Maximum movement speed (px/sec) considered "paused"
  MIN_STROKE_POINTS: 10,              // Minimum raw points needed to analyze geometry
  MIN_STROKE_LENGTH: 45.0,            // Minimum path length in pixels
  LINE_STRAIGHTNESS_THRESHOLD: 0.88,  // D_endpoints / Path_length >= 0.88 -> Line
  CLOSURE_THRESHOLD_RATIO: 0.22,      // D_endpoints / Path_length <= 0.22 -> Closed shape
  CLOSURE_MAX_PIXELS: 50.0,           // Absolute max endpoint gap to consider closed
  CIRCLE_RADIAL_CV_MAX: 0.16,         // Max radial std-dev / mean radius for a circle
  CIRCLE_ASPECT_RATIO_MIN: 0.70,      // Min aspect ratio (width/height) for circle
  CIRCLE_ASPECT_RATIO_MAX: 1.42,      // Max aspect ratio for circle
  RDP_EPSILON_RATIO: 0.045            // Epsilon factor for RDP polyline simplification
};

/**
 * 2D Euclidean distance.
 */
function dist(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * Computes total arc length of a sequence of points.
 */
function computePathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += dist(points[i - 1], points[i]);
  }
  return len;
}

/**
 * Computes axis-aligned bounding box of a point set.
 */
function computeBoundingBox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    maxX,
    maxY
  };
}

/**
 * Resamples a polyline into N equidistant points.
 */
function resampleEquidistant(points, targetCount = 60) {
  const totalLength = computePathLength(points);
  if (totalLength === 0 || points.length < 2) return [...points];

  const step = totalLength / (targetCount - 1);
  const result = [{ x: points[0].x, y: points[0].y }];
  let accumulated = 0;
  let currIdx = 0;
  let currPoint = { ...points[0] };

  for (let i = 1; i < targetCount - 1; i++) {
    const targetDist = i * step;
    while (currIdx < points.length - 1) {
      const nextPoint = points[currIdx + 1];
      const segmentLen = dist(currPoint, nextPoint);
      if (accumulated + segmentLen >= targetDist) {
        const remaining = targetDist - accumulated;
        const ratio = segmentLen > 0 ? remaining / segmentLen : 0;
        const interpolated = {
          x: currPoint.x + (nextPoint.x - currPoint.x) * ratio,
          y: currPoint.y + (nextPoint.y - currPoint.y) * ratio
        };
        result.push(interpolated);
        break;
      } else {
        accumulated += segmentLen;
        currIdx++;
        currPoint = { ...points[currIdx] };
      }
    }
  }

  result.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  return result;
}

/**
 * Perpendicular distance from point p to line segment (a, b).
 */
function perpendicularDistance(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  const projection = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return dist(p, projection);
}

/**
 * Ramer-Douglas-Peucker (RDP) polyline simplification algorithm.
 */
function ramerDouglasPeucker(points, epsilon) {
  if (points.length <= 2) return [...points];

  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
    const right = ramerDouglasPeucker(points.slice(index), epsilon);
    return left.slice(0, left.length - 1).concat(right);
  } else {
    return [first, last];
  }
}

/**
 * Computes angle at vertex B formed by segments AB and BC in degrees (0 to 180).
 */
function computeAngle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  if (magAB === 0 || magCB === 0) return 180;
  const cosTheta = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

export class ShapeDetector {
  constructor() {
    this.pauseStartTime = null;
    this.hasSnapped = false;
  }

  /**
   * Evaluates whether pointer velocity has stayed below the stationary threshold
   * long enough to qualify as a pause.
   * @param {number} speed - Instantaneous speed in px/step
   * @param {number} timestamp - Current performance.now()
   * @returns {boolean} True if pause duration >= PAUSE_DURATION_MS
   */
  checkPause(speed, timestamp) {
    if (speed < SHAPE_CONFIG.STATIONARY_SPEED_THRESHOLD) {
      if (this.pauseStartTime === null) {
        this.pauseStartTime = timestamp;
      } else if (timestamp - this.pauseStartTime >= SHAPE_CONFIG.PAUSE_DURATION_MS) {
        if (!this.hasSnapped) {
          this.hasSnapped = true;
          return true;
        }
      }
    } else {
      this.pauseStartTime = null;
      this.hasSnapped = false;
    }
    return false;
  }

  /**
   * Resets pause state when stroke terminates or starts anew.
   */
  reset() {
    this.pauseStartTime = null;
    this.hasSnapped = false;
  }

  /**
   * Classifies a stroke into a geometric shape (Line, Circle, Rectangle, Triangle).
   * @param {Array<{x: number, y: number}>} rawPoints - Original stroke points
   * @returns {{shapeType: string, shapeData: Object}|null}
   */
  detectShape(rawPoints) {
    if (!rawPoints || rawPoints.length < SHAPE_CONFIG.MIN_STROKE_POINTS) {
      return null;
    }

    const pathLength = computePathLength(rawPoints);
    if (pathLength < SHAPE_CONFIG.MIN_STROKE_LENGTH) {
      return null;
    }

    const start = rawPoints[0];
    const end = rawPoints[rawPoints.length - 1];
    const endpointDist = dist(start, end);

    // 1. Straight Line Check
    // If endpoint distance is nearly equal to total path length, it's a straight line
    const straightness = endpointDist / pathLength;
    if (straightness >= SHAPE_CONFIG.LINE_STRAIGHTNESS_THRESHOLD) {
      return {
        shapeType: "line",
        shapeData: {
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y
        }
      };
    }

    // 2. Closure Check
    // Closed if start and end points meet within relative or absolute tolerance
    const isClosed =
      endpointDist / pathLength <= SHAPE_CONFIG.CLOSURE_THRESHOLD_RATIO ||
      endpointDist <= SHAPE_CONFIG.CLOSURE_MAX_PIXELS;

    const isNearClosed = isClosed || endpointDist <= 85 || endpointDist / pathLength <= 0.35;

    if (!isNearClosed) {
      // Open curves that aren't straight lines are retained as organic strokes
      return null;
    }

    // Resample uniformly for unbiased geometry statistics
    const resampled = resampleEquidistant(rawPoints, 64);
    const bbox = computeBoundingBox(resampled);
    const aspectRatio = bbox.width / bbox.height;

    // 2.5 Heart Shape Detection (Organic & Freehand Aligned)
    // A heart has: a centered bottom tip, two upper lobes (left & right), and a center dip/notch
    if (aspectRatio >= 0.55 && aspectRatio <= 1.55 && bbox.width >= 30 && bbox.height >= 30) {
      const midX = bbox.x + bbox.width / 2;

      // Find lowest point (max Y = heart tip pointing downwards)
      let lowestP = resampled[0];
      for (const p of resampled) {
        if (p.y > lowestP.y) lowestP = p;
      }

      // Check if tip is centered horizontally
      const tipCentered = Math.abs(lowestP.x - midX) < bbox.width * 0.32;

      // Check for two distinct lobes in the top half (left and right of center)
      let leftPeakY = Infinity;
      let rightPeakY = Infinity;
      let notchY = -Infinity;

      for (const p of resampled) {
        if (p.y < bbox.y + bbox.height * 0.60) {
          if (p.x < midX - bbox.width * 0.08) {
            if (p.y < leftPeakY) leftPeakY = p.y;
          } else if (p.x > midX + bbox.width * 0.08) {
            if (p.y < rightPeakY) rightPeakY = p.y;
          } else {
            // Near center notch
            if (p.y > notchY) notchY = p.y;
          }
        }
      }

      const hasBothLobes = leftPeakY < Infinity && rightPeakY < Infinity;
      const hasNotch = notchY > Math.min(leftPeakY, rightPeakY) + bbox.height * 0.03 || endpointDist < 60;

      if (tipCentered && hasBothLobes && hasNotch) {
        return {
          shapeType: "heart",
          shapeData: {
            x: bbox.x,
            y: bbox.y,
            width: bbox.width,
            height: bbox.height
          }
        };
      }
    }

    if (!isClosed) {
      // Not a closed loop or heart
      return null;
    }

    // 3. Circle Check: Centroid and radial variance
    let sumX = 0, sumY = 0;
    for (const p of resampled) {
      sumX += p.x;
      sumY += p.y;
    }
    const cx = sumX / resampled.length;
    const cy = sumY / resampled.length;

    let meanRadius = 0;
    const radii = resampled.map((p) => {
      const r = dist(p, { x: cx, y: cy });
      meanRadius += r;
      return r;
    });
    meanRadius /= resampled.length;

    let variance = 0;
    for (const r of radii) {
      variance += (r - meanRadius) ** 2;
    }
    const stdDev = Math.sqrt(variance / resampled.length);
    const radialCV = meanRadius > 0 ? stdDev / meanRadius : 1.0;

    if (
      radialCV <= SHAPE_CONFIG.CIRCLE_RADIAL_CV_MAX &&
      aspectRatio >= SHAPE_CONFIG.CIRCLE_ASPECT_RATIO_MIN &&
      aspectRatio <= SHAPE_CONFIG.CIRCLE_ASPECT_RATIO_MAX
    ) {
      return {
        shapeType: "circle",
        shapeData: {
          cx: cx,
          cy: cy,
          radius: meanRadius
        }
      };
    }

    // 4. Polygon Analysis (Triangle / Rectangle) via RDP
    // Close the loop explicitly for polygon simplification
    const closedLoop = [...resampled, { x: resampled[0].x, y: resampled[0].y }];
    const epsilon = Math.max(bbox.width, bbox.height) * SHAPE_CONFIG.RDP_EPSILON_RATIO;
    const simplified = ramerDouglasPeucker(closedLoop, epsilon);

    // Simplified polygon vertices (excluding duplicate closed endpoint)
    const vertices = simplified.slice(0, simplified.length - 1);

    // Check for Triangle (3 dominant corners)
    if (vertices.length === 3) {
      const a1 = computeAngle(vertices[2], vertices[0], vertices[1]);
      const a2 = computeAngle(vertices[0], vertices[1], vertices[2]);
      const a3 = computeAngle(vertices[1], vertices[2], vertices[0]);
      const angleSum = a1 + a2 + a3;

      // Triangle internal angles sum to 180 degrees
      if (Math.abs(angleSum - 180) < 40) {
        return {
          shapeType: "triangle",
          shapeData: {
            p1: vertices[0],
            p2: vertices[1],
            p3: vertices[2]
          }
        };
      }
    }

    // Check for Rectangle (4 dominant corners)
    if (vertices.length === 4) {
      const angles = [
        computeAngle(vertices[3], vertices[0], vertices[1]),
        computeAngle(vertices[0], vertices[1], vertices[2]),
        computeAngle(vertices[1], vertices[2], vertices[3]),
        computeAngle(vertices[2], vertices[3], vertices[0])
      ];

      // Each corner should be close to 90 degrees
      const rightAngles = angles.filter((a) => Math.abs(a - 90) < 32).length;
      if (rightAngles >= 3) {
        return {
          shapeType: "rectangle",
          shapeData: {
            x: bbox.x,
            y: bbox.y,
            width: bbox.width,
            height: bbox.height
          }
        };
      }
    }

    // Fallback: If closed and bounding box is reasonable, check if it fits a rectangle
    // when user drew corners smoothly without stopping
    const rectPerimeter = 2 * (bbox.width + bbox.height);
    const perimeterRatio = pathLength / rectPerimeter;
    if (perimeterRatio >= 0.82 && perimeterRatio <= 1.25 && radialCV > 0.18) {
      return {
        shapeType: "rectangle",
        shapeData: {
          x: bbox.x,
          y: bbox.y,
          width: bbox.width,
          height: bbox.height
        }
      };
    }

    return null;
  }
}
