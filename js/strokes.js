/**
 * strokes.js - Stroke data model, multi-style rendering, undo/redo stack, and PNG/SVG export
 *
 * Supported Brush Styles:
 * - "solid": Crisp, round-capped vector-smooth strokes.
 * - "neon": Multi-pass glowing laser aura with an intense bright core.
 * - "dashed": Styled dashed paths.
 * - "calligraphy": Velocity-responsive dynamic width with simulated 45-degree chisel nib.
 */

export const STROKE_CONFIG = {
  DEFAULT_COLOR: "#2457ff",
  DEFAULT_SIZE: 8,
  MIN_SIZE: 2,
  MAX_SIZE: 48,
  DEFAULT_STYLE: "solid",
  MAX_HISTORY: 50,
  PALETTE: [
    { name: "Crimson Red", hex: "#ff3b30" },
    { name: "Electric Blue", hex: "#2457ff" },
    { name: "Emerald Green", hex: "#22c55e" },
    { name: "Cyber Yellow", hex: "#facc15" },
    { name: "Neon Violet", hex: "#a855f7" },
    { name: "Pure White", hex: "#ffffff" }
  ]
};

export class StrokeManager {
  constructor(width = 1280, height = 720) {
    this.width = width;
    this.height = height;

    this.strokes = [];       // Array of completed strokes
    this.redoStack = [];     // Stack for redone strokes or states
    this.currentStroke = null;

    // Active tool settings
    this.activeColor = STROKE_CONFIG.DEFAULT_COLOR;
    this.activeSize = STROKE_CONFIG.DEFAULT_SIZE;
    this.activeStyle = STROKE_CONFIG.DEFAULT_STYLE;
    this.eraserRadiusMultiplier = 4.0;

    // Dedicated offscreen drawing layer to keep webcam completely separate from ink
    this.drawingCanvas = document.createElement("canvas");
    this.drawingCanvas.width = width;
    this.drawingCanvas.height = height;
    this.drawingCtx = this.drawingCanvas.getContext("2d");
  }

  /**
   * Begins a new stroke.
   * @param {{x: number, y: number}} point - Starting coordinate
   * @param {Object} [overrides] - Optional color/size/style overrides
   */
  startStroke(point, overrides = {}) {
    const isErase = overrides.isErase || false;
    const size = isErase
      ? (overrides.size || this.activeSize) * this.eraserRadiusMultiplier
      : (overrides.size || this.activeSize);

    this.currentStroke = {
      id: "stroke_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      points: [{ x: point.x, y: point.y, speed: 0, timestamp: performance.now() }],
      color: overrides.color || this.activeColor,
      size: size,
      style: overrides.style || this.activeStyle,
      isErase: isErase,
      isShape: false,
      shapeType: null,
      shapeData: null,
      originalPoints: null // Saved if shape snapping occurs
    };
  }

  /**
   * Appends an interpolated coordinate to the active stroke.
   * @param {{x: number, y: number, speed?: number}} point
   */
  addPoint(point) {
    if (!this.currentStroke) return;

    const last = this.currentStroke.points[this.currentStroke.points.length - 1];
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    const dist = Math.hypot(dx, dy);

    // Skip redundant points that are too close (sub-pixel jitter)
    if (dist < 1.0) return;

    const speed = point.speed !== undefined ? point.speed : dist;
    this.currentStroke.points.push({
      x: point.x,
      y: point.y,
      speed: speed,
      timestamp: performance.now()
    });
  }

  /**
   * Finalizes the active stroke and adds it to the undo stack.
   * @returns {Object|null} The finalized stroke
   */
  endStroke() {
    if (!this.currentStroke) return null;

    // Discard single-point zero-length accidental clicks
    if (this.currentStroke.points.length < 2 && !this.currentStroke.isShape) {
      this.currentStroke = null;
      return null;
    }

    const completed = this.currentStroke;
    this.strokes.push(completed);
    this.currentStroke = null;

    // Clear redo history when a new action is performed
    this.redoStack = [];

    if (this.strokes.length > STROKE_CONFIG.MAX_HISTORY) {
      this.strokes.shift();
    }

    return completed;
  }

  /**
   * Replaces a completed stroke with a recognized geometric shape.
   * Saves the original points so undo can revert back to the hand-drawn stroke!
   * @param {Object} stroke - Target stroke
   * @param {string} shapeType - "line" | "circle" | "rectangle" | "triangle"
   * @param {Object} shapeData - Computed geometry data
   */
  replaceStrokeWithShape(stroke, shapeType, shapeData) {
    stroke.originalPoints = [...stroke.points];
    stroke.isShape = true;
    stroke.shapeType = shapeType;
    stroke.shapeData = shapeData;
  }

  /**
   * Undo: If the last stroke was a shape-snapped stroke, reverts it back to
   * the original hand-drawn stroke. Otherwise, pops it to the redo stack.
   */
  undo() {
    if (this.strokes.length === 0) return null;

    const lastStroke = this.strokes[this.strokes.length - 1];

    if (lastStroke.isShape && lastStroke.originalPoints) {
      // Revert snapped shape back to hand-drawn stroke
      const shapeBackup = {
        type: "shapeRevert",
        stroke: lastStroke,
        shapeType: lastStroke.shapeType,
        shapeData: lastStroke.shapeData
      };
      this.redoStack.push(shapeBackup);

      lastStroke.isShape = false;
      lastStroke.shapeType = null;
      lastStroke.shapeData = null;
      lastStroke.points = [...lastStroke.originalPoints];
      lastStroke.originalPoints = null;
      return { action: "revertedShape", stroke: lastStroke };
    }

    const popped = this.strokes.pop();
    this.redoStack.push({ type: "strokePop", stroke: popped });
    return { action: "poppedStroke", stroke: popped };
  }

  /**
   * Redo: Reapplies the most recent undone stroke or shape snap.
   */
  redo() {
    if (this.redoStack.length === 0) return null;

    const item = this.redoStack.pop();
    if (item.type === "shapeRevert") {
      this.replaceStrokeWithShape(item.stroke, item.shapeType, item.shapeData);
      return { action: "reappliedShape", stroke: item.stroke };
    } else if (item.type === "strokePop") {
      this.strokes.push(item.stroke);
      return { action: "reappliedStroke", stroke: item.stroke };
    } else if (item.type === "clearAll") {
      this.strokes = item.strokes;
      return { action: "restoredClear", count: this.strokes.length };
    }
    return null;
  }

  /**
   * Clears the entire canvas while allowing undo.
   */
  clear() {
    if (this.strokes.length === 0) return;
    this.redoStack.push({ type: "clearAll", strokes: [...this.strokes] });
    this.strokes = [];
    this.currentStroke = null;
  }

  /**
   * Directly erases ink strokes within the specified radius of an open palm.
   * Modifies strokes in-place without ever damaging or cutting through the camera feed.
   * @param {{x: number, y: number}} point - Palm center coordinates
   * @param {number} radius - Eraser sphere radius
   * @returns {boolean} True if any strokes or points were erased
   */
  eraseAt(point, radius = 40) {
    if (!point || this.strokes.length === 0) return false;

    let modified = false;
    const remaining = [];

    for (const stroke of this.strokes) {
      if (stroke.isErase) continue;

      if (stroke.isShape && stroke.shapeData) {
        const d = stroke.shapeData;
        let hit = false;
        if (stroke.shapeType === "circle") {
          const distToCenter = Math.hypot(point.x - d.cx, point.y - d.cy);
          hit = Math.abs(distToCenter - d.radius) < radius || distToCenter < d.radius;
        } else if (stroke.shapeType === "line") {
          const l2 = (d.x2 - d.x1) ** 2 + (d.y2 - d.y1) ** 2;
          let t = l2 === 0 ? 0 : ((point.x - d.x1) * (d.x2 - d.x1) + (point.y - d.y1) * (d.y2 - d.y1)) / l2;
          t = Math.max(0, Math.min(1, t));
          const projX = d.x1 + t * (d.x2 - d.x1);
          const projY = d.y1 + t * (d.y2 - d.y1);
          hit = Math.hypot(point.x - projX, point.y - projY) < radius;
        } else {
          // Heart or Rectangle bounding box
          hit =
            point.x >= d.x - radius &&
            point.x <= d.x + d.width + radius &&
            point.y >= d.y - radius &&
            point.y <= d.y + d.height + radius;
        }

        if (hit) {
          modified = true;
          continue; // Erased shape
        }
        remaining.push(stroke);
        continue;
      }

      // Freehand stroke points
      const kept = [];
      let touched = false;
      for (const p of stroke.points) {
        if (Math.hypot(p.x - point.x, p.y - point.y) < radius) {
          touched = true;
          modified = true;
        } else {
          kept.push(p);
        }
      }

      if (!touched) {
        remaining.push(stroke);
      } else if (kept.length >= 3) {
        stroke.points = kept;
        remaining.push(stroke);
      }
    }

    if (modified) {
      this.strokes = remaining;
    }
    return modified;
  }

  /**
   * Renders a single stroke onto the provided Canvas 2D context.
   */
  renderStroke(ctx, stroke) {
    if (!stroke) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (stroke.isErase) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = stroke.size;
      this._renderPointsPath(ctx, stroke.points);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.globalCompositeOperation = "source-over";

    // 1. Snapped Geometric Shapes
    if (stroke.isShape && stroke.shapeData) {
      this._renderShape(ctx, stroke);
      ctx.restore();
      return;
    }

    // 2. Brush Styles
    switch (stroke.style) {
      case "neon":
        // Multi-pass neon glow:
        // Pass 1: Broad glowing aura with shadowBlur
        ctx.shadowColor = stroke.color;
        ctx.shadowBlur = stroke.size * 2.2;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size * 1.2;
        ctx.globalAlpha = 0.85;
        this._renderPointsPath(ctx, stroke.points);
        ctx.stroke();

        // Pass 2: Intense white-hot core
        ctx.shadowBlur = stroke.size * 0.5;
        ctx.shadowColor = "#ffffff";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(2, stroke.size * 0.4);
        ctx.globalAlpha = 0.95;
        this._renderPointsPath(ctx, stroke.points);
        ctx.stroke();
        break;

      case "dashed":
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.setLineDash([stroke.size * 2.2, stroke.size * 1.6]);
        this._renderPointsPath(ctx, stroke.points);
        ctx.stroke();
        break;

      case "calligraphy":
        // Variable-width calligraphy rendering
        this._renderCalligraphy(ctx, stroke);
        break;

      case "solid":
      default:
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        this._renderPointsPath(ctx, stroke.points);
        ctx.stroke();
        break;
    }

    ctx.restore();
  }

  /**
   * Helper to draw a continuous smooth path using midpoint quadratic curves.
   */
  _renderPointsPath(ctx, points) {
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }

    // Connect to the final point
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  /**
   * Calligraphy style: renders dynamic width based on instantaneous drawing speed
   * and simulated 45-degree angle chisel nib geometry.
   */
  _renderCalligraphy(ctx, stroke) {
    const points = stroke.points;
    if (points.length < 2) return;

    ctx.fillStyle = stroke.color;
    ctx.strokeStyle = stroke.color;

    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];

      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.5) continue;

      // Inverse speed relation: slow motion = thick stroke; quick flick = thin stroke
      const speed = p1.speed || dist;
      const speedFactor = Math.max(0.2, 1.3 - Math.min(speed, 35) / 30);
      const width = Math.max(2, stroke.size * speedFactor);

      // 45-degree angle nib offset vector
      const nibAngle = Math.PI / 4;
      const nx = (Math.cos(nibAngle) * width) / 2;
      const ny = (Math.sin(nibAngle) * width) / 2;

      ctx.beginPath();
      ctx.moveTo(p0.x - nx, p0.y - ny);
      ctx.lineTo(p0.x + nx, p0.y + ny);
      ctx.lineTo(p1.x + nx, p1.y + ny);
      ctx.lineTo(p1.x - nx, p1.y - ny);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  /**
   * Renders snapped geometric shapes (line, circle, rectangle, triangle, heart).
   */
  _renderShape(ctx, stroke) {
    const d = stroke.shapeData;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;

    if (stroke.style === "dashed") {
      ctx.setLineDash([stroke.size * 2, stroke.size * 1.5]);
    } else if (stroke.style === "neon") {
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur = stroke.size * 2;
    }

    if (stroke.shapeType === "heart") {
      this._renderHeart(ctx, stroke);
      return;
    }

    ctx.beginPath();
    switch (stroke.shapeType) {
      case "line":
        ctx.moveTo(d.x1, d.y1);
        ctx.lineTo(d.x2, d.y2);
        break;

      case "circle":
        ctx.arc(d.cx, d.cy, d.radius, 0, Math.PI * 2);
        break;

      case "rectangle":
        ctx.rect(d.x, d.y, d.width, d.height);
        break;

      case "triangle":
        ctx.moveTo(d.p1.x, d.p1.y);
        ctx.lineTo(d.p2.x, d.p2.y);
        ctx.lineTo(d.p3.x, d.p3.y);
        ctx.closePath();
        break;

      default:
        this._renderPointsPath(ctx, stroke.points);
        break;
    }
    ctx.stroke();
  }

  /**
   * Renders a symmetric, vector-smooth completed heart shape.
   */
  _renderHeart(ctx, stroke) {
    const d = stroke.shapeData;
    const x = d.x;
    const y = d.y;
    const w = d.width;
    const h = d.height;

    const topCurveH = h * 0.32;
    const midX = x + w / 2;

    ctx.beginPath();
    ctx.moveTo(midX, y + topCurveH);

    // Left lobe
    ctx.bezierCurveTo(
      midX, y,
      x, y,
      x, y + topCurveH
    );

    // Left bottom curve to bottom tip
    ctx.bezierCurveTo(
      x, y + (h + topCurveH) / 2,
      midX - w * 0.08, y + h * 0.82,
      midX, y + h
    );

    // Right bottom curve from bottom tip
    ctx.bezierCurveTo(
      midX + w * 0.08, y + h * 0.82,
      x + w, y + (h + topCurveH) / 2,
      x + w, y + topCurveH
    );

    // Right lobe
    ctx.bezierCurveTo(
      x + w, y,
      midX, y,
      midX, y + topCurveH
    );

    ctx.closePath();
    ctx.stroke();
  }

  /**
   * Renders all completed strokes and the active stroke onto the canvas.
   * Uses an isolated offscreen ink layer so destination-out erasing NEVER
   * cuts through or damages the webcam feed!
   */
  renderAll(targetCtx) {
    // 1. Clear offscreen ink drawing layer (fully transparent)
    this.drawingCtx.clearRect(0, 0, this.width, this.height);

    // 2. Render all strokes onto the offscreen drawing layer
    for (const stroke of this.strokes) {
      this.renderStroke(this.drawingCtx, stroke);
    }
    if (this.currentStroke) {
      this.renderStroke(this.drawingCtx, this.currentStroke);
    }

    // 3. Composite offscreen drawing layer cleanly onto the target context
    targetCtx.drawImage(this.drawingCanvas, 0, 0);
  }

  /**
   * Generates a clean, standalone, valid SVG string of all strokes.
   * @param {string} background - "transparent" | "#ffffff" | "#000000"
   * @returns {string} SVG XML markup
   */
  exportSVG(background = "transparent") {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width} ${this.height}" width="${this.width}" height="${this.height}">\n`;

    // Definitions for neon glow filter
    svg += `  <defs>
    <filter id="neon-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>\n`;

    if (background !== "transparent") {
      svg += `  <rect width="100%" height="100%" fill="${background}"/>\n`;
    }

    for (const stroke of this.strokes) {
      if (stroke.isErase) continue; // Vector SVG ignores eraser strokes

      const dashAttr = stroke.style === "dashed"
        ? ` stroke-dasharray="${stroke.size * 2},${stroke.size * 1.5}"`
        : "";
      const filterAttr = stroke.style === "neon" ? ` filter="url(#neon-glow)"` : "";

      if (stroke.isShape && stroke.shapeData) {
        const d = stroke.shapeData;
        if (stroke.shapeType === "line") {
          svg += `  <line x1="${d.x1.toFixed(1)}" y1="${d.y1.toFixed(1)}" x2="${d.x2.toFixed(1)}" y2="${d.y2.toFixed(1)}" stroke="${stroke.color}" stroke-width="${stroke.size}" stroke-linecap="round"${dashAttr}${filterAttr}/>\n`;
        } else if (stroke.shapeType === "circle") {
          svg += `  <circle cx="${d.cx.toFixed(1)}" cy="${d.cy.toFixed(1)}" r="${d.radius.toFixed(1)}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.size}"${dashAttr}${filterAttr}/>\n`;
        } else if (stroke.shapeType === "rectangle") {
          svg += `  <rect x="${d.x.toFixed(1)}" y="${d.y.toFixed(1)}" width="${d.width.toFixed(1)}" height="${d.height.toFixed(1)}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.size}"${dashAttr}${filterAttr}/>\n`;
        } else if (stroke.shapeType === "triangle") {
          svg += `  <polygon points="${d.p1.x.toFixed(1)},${d.p1.y.toFixed(1)} ${d.p2.x.toFixed(1)},${d.p2.y.toFixed(1)} ${d.p3.x.toFixed(1)},${d.p3.y.toFixed(1)}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.size}"${dashAttr}${filterAttr}/>\n`;
        } else if (stroke.shapeType === "heart") {
          const midX = d.x + d.width / 2;
          const topCurveH = d.height * 0.32;
          svg += `  <path d="M ${midX.toFixed(1)} ${(d.y + topCurveH).toFixed(1)} C ${midX.toFixed(1)} ${d.y.toFixed(1)}, ${d.x.toFixed(1)} ${d.y.toFixed(1)}, ${d.x.toFixed(1)} ${(d.y + topCurveH).toFixed(1)} C ${d.x.toFixed(1)} ${(d.y + (d.height + topCurveH) / 2).toFixed(1)}, ${(midX - d.width * 0.08).toFixed(1)} ${(d.y + d.height * 0.82).toFixed(1)}, ${midX.toFixed(1)} ${(d.y + d.height).toFixed(1)} C ${(midX + d.width * 0.08).toFixed(1)} ${(d.y + d.height * 0.82).toFixed(1)}, ${(d.x + d.width).toFixed(1)} ${(d.y + (d.height + topCurveH) / 2).toFixed(1)}, ${(d.x + d.width).toFixed(1)} ${(d.y + topCurveH).toFixed(1)} C ${(d.x + d.width).toFixed(1)} ${d.y.toFixed(1)}, ${midX.toFixed(1)} ${d.y.toFixed(1)}, ${midX.toFixed(1)} ${(d.y + topCurveH).toFixed(1)} Z" fill="none" stroke="${stroke.color}" stroke-width="${stroke.size}"${dashAttr}${filterAttr}/>\n`;
        }
      } else if (stroke.points && stroke.points.length > 1) {
        let pathData = `M ${stroke.points[0].x.toFixed(1)} ${stroke.points[0].y.toFixed(1)}`;
        for (let i = 1; i < stroke.points.length; i++) {
          pathData += ` L ${stroke.points[i].x.toFixed(1)} ${stroke.points[i].y.toFixed(1)}`;
        }
        svg += `  <path d="${pathData}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}${filterAttr}/>\n`;
      }
    }

    svg += `</svg>`;
    return svg;
  }

  /**
   * Generates a PNG Data URL with options for transparency and background choices.
   * @param {Object} options
   * @param {boolean} options.transparent - Whether to export without background
   * @param {string} options.backgroundMode - "webcam" | "white" | "black"
   * @param {HTMLVideoElement|null} options.videoElement - Required if backgroundMode is "webcam"
   * @returns {string} PNG Data URL
   */
  exportPNG(options = {}) {
    const { transparent = false, backgroundMode = "webcam", videoElement = null } = options;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = this.width;
    exportCanvas.height = this.height;
    const ctx = exportCanvas.getContext("2d");

    if (!transparent) {
      if (backgroundMode === "white") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, this.width, this.height);
      } else if (backgroundMode === "black") {
        ctx.fillStyle = "#0e1117";
        ctx.fillRect(0, 0, this.width, this.height);
      } else if (backgroundMode === "webcam" && videoElement && videoElement.readyState >= 2) {
        // Draw mirrored webcam snapshot
        ctx.save();
        ctx.translate(this.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(videoElement, 0, 0, this.width, this.height);
        ctx.restore();
        // Dim slightly
        ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
        ctx.fillRect(0, 0, this.width, this.height);
      }
    }

    // Render strokes on top
    this.renderAll(ctx);
    return exportCanvas.toDataURL("image/png");
  }
}
