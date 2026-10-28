/**
 * main.js - Application orchestrator, animation loop, and render pipeline
 */

import { HandTracker, TRACKING_CONFIG } from "./handTracking.js";
import { GestureClassifier } from "./gestures.js";
import { OneEuroFilter2D } from "./smoothing.js";
import { StrokeManager } from "./strokes.js";
import { ShapeDetector } from "./shapes.js";
import { HandwritingClassifier } from "./handwriting.js";
import { MetricsTracker } from "./metrics.js";
import { UIManager, UI_CONFIG } from "./ui.js";

// Canvas Resolution
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

class AirCanvasApp {
  constructor() {
    this.video = document.getElementById("cam");
    this.viewCanvas = document.getElementById("view");
    this.ctx = this.viewCanvas.getContext("2d");

    // Persistent offscreen canvas for drawing layer
    this.drawingCanvas = document.createElement("canvas");
    this.drawingCanvas.width = CANVAS_WIDTH;
    this.drawingCanvas.height = CANVAS_HEIGHT;
    this.drawingCtx = this.drawingCanvas.getContext("2d");

    // Subsystems
    this.tracker = new HandTracker();
    this.classifier = new GestureClassifier();
    this.smoother = new OneEuroFilter2D(1.0, 0.02, 1.0);
    this.strokeManager = new StrokeManager(CANVAS_WIDTH, CANVAS_HEIGHT);
    this.shapeDetector = new ShapeDetector();
    this.handwriting = new HandwritingClassifier();
    this.metrics = new MetricsTracker();
    this.ui = new UIManager(this.strokeManager, this.metrics, this.handwriting);

    // State flags
    this.isRunning = false;
    this.lastTimestamp = performance.now();
    this.smoothedPointer = null;
    this.activeMode = "idle";
    this.writeModePauseTimer = null;
    this.pendingWriteStroke = null;
    this.lastPinchState = false;

    // Visual snap animation feedback
    this.shapeSnapFeedback = null;
  }

  /**
   * Initializes UI and checks system prerequisites.
   */
  async init() {
    this.viewCanvas.width = CANVAS_WIDTH;
    this.viewCanvas.height = CANVAS_HEIGHT;

    this.ui.bindDOM();

    // Setup start button modal handler
    const startBtn = document.getElementById("btn-start-camera");
    const startModal = document.getElementById("start-screen");
    const loadingMessage = document.getElementById("start-loading-status");

    // Attempt to load TF.js model asynchronously in background
    this.handwriting.loadModel((status) => {
      console.log("[Handwriting]", status);
    });

    startBtn.addEventListener("click", async () => {
      startBtn.disabled = true;
      startBtn.textContent = "Starting camera...";
      if (loadingMessage) loadingMessage.textContent = "Initializing camera & MediaPipe HandLandmarker...";

      try {
        await this.tracker.initModel((msg) => {
          if (loadingMessage) loadingMessage.textContent = msg;
        });

        await this.tracker.startCamera(this.video);

        // Hide start screen and launch animation loop
        if (startModal) startModal.classList.add("hidden");
        this.isRunning = true;
        this.ui.showToast("Air Canvas Ready! Pinch to draw.");
        requestAnimationFrame(this.loop.bind(this));
      } catch (err) {
        startBtn.disabled = false;
        startBtn.textContent = "Retry Camera";
        if (loadingMessage) {
          loadingMessage.innerHTML = `<span style="color:#ef4444;font-weight:600;">Error: ${err.message}</span>`;
        }
        this.ui.showToast(`Error: ${err.message}`, 6000);
      }
    });
  }

  /**
   * Main render and tracking loop (runs at display refresh rate, ~60 FPS).
   */
  loop(timestamp) {
    if (!this.isRunning) return;

    this.metrics.updateFrame(timestamp);

    // 1. Process Video Frame & Hand Tracking
    const trackingResult = this.tracker.detect(timestamp);

    let dwellInfo = { isHovering: false, progress: 0 };
    let rawPointer = null;

    if (trackingResult.handDetected && trackingResult.landmarks) {
      const lm = trackingResult.landmarks;

      // Classify gesture with hysteresis & debouncing
      const gesture = this.classifier.process(lm);
      this.activeMode = gesture.mode;

      // Horizontal mirroring: webcam image is mirrored horizontally (1 - x)
      rawPointer = {
        x: (1.0 - gesture.pointer.x) * CANVAS_WIDTH,
        y: gesture.pointer.y * CANVAS_HEIGHT
      };

      // 2. Smooth Pointer Coordinates via 1€ Adaptive Filter
      const smoothed = this.smoother.filter(rawPointer, timestamp);
      this.smoothedPointer = { x: smoothed.x, y: smoothed.y };
      const currentSpeed = smoothed.speed; // px per frame

      // 3. Process Active Mode Logic
      if (this.activeMode === "draw") {
        if (!this.strokeManager.currentStroke) {
          // Begin new stroke
          this.strokeManager.startStroke(this.smoothedPointer);
          this.shapeDetector.reset();
        } else {
          // Append point
          this.strokeManager.addPoint(this.smoothedPointer);

          // 4. Shape Snapping: Detect stationary pause at end of stroke (~600 ms)
          if (this.ui.appMode === "draw") {
            const isPaused = this.shapeDetector.checkPause(currentSpeed, timestamp);
            if (isPaused && this.strokeManager.currentStroke) {
              const detected = this.shapeDetector.detectShape(this.strokeManager.currentStroke.points);
              if (detected) {
                this.strokeManager.replaceStrokeWithShape(
                  this.strokeManager.currentStroke,
                  detected.shapeType,
                  detected.shapeData
                );
                this.shapeSnapFeedback = {
                  type: detected.shapeType,
                  time: timestamp
                };
                this.ui.showToast(`Snapped to ${detected.shapeType.toUpperCase()}! (Undo available)`);
              }
            }
          }
        }
      } else if (this.activeMode === "erase") {
        if (this.strokeManager.currentStroke && !this.strokeManager.currentStroke.isErase) {
          this.strokeManager.endStroke();
        }
        const eraserRadius = (this.strokeManager.activeSize * this.strokeManager.eraserRadiusMultiplier) / 2;
        // Directly erase ink wherever the open palm sweeps (never damages webcam feed)
        this.strokeManager.eraseAt(this.smoothedPointer, eraserRadius);
      } else {
        // Not drawing or erasing: finalize any open stroke
        if (this.strokeManager.currentStroke) {
          const finishedStroke = this.strokeManager.endStroke();

          // In "write" mode, queue stroke with debounce buffer to support multi-stroke letters (A, T, H, etc.)
          if (this.ui.appMode === "write" && finishedStroke && !finishedStroke.isErase) {
            this._queueHandwritingStroke(finishedStroke);
          }
        }
        this.shapeDetector.reset();

        // 5. Selection Mode: Touchless Air Dwell Hover
        if (this.activeMode === "select") {
          dwellInfo = this.ui.processDwell(this.smoothedPointer);
        } else {
          this.ui._resetDwell();
        }
      }

      this.metrics.updateTracking(trackingResult.latencyMs, true, this.activeMode);
    } else {
      // No hand in view
      if (this.strokeManager.currentStroke) {
        const finishedStroke = this.strokeManager.endStroke();
        if (this.ui.appMode === "write" && finishedStroke && !finishedStroke.isErase) {
          this._queueHandwritingStroke(finishedStroke);
        }
      }
      this.classifier.reset();
      this.smoother.reset();
      this.shapeDetector.reset();
      this.ui._resetDwell();
      this.activeMode = "idle";
      this.smoothedPointer = null;

      this.metrics.updateTracking(0, false, "idle");
    }

    // 6. Update HUD Status
    this.ui.updateHUD(
      this.activeMode,
      trackingResult.handDetected,
      this.metrics.fps,
      this.metrics.latencyMs
    );

    // 7. Render All Layers to Viewport
    this.render(dwellInfo, timestamp);

    requestAnimationFrame(this.loop.bind(this));
  }

  /**
   * Queues a completed stroke in "write" mode and sets a short timer to allow
   * multi-stroke characters (e.g. A, E, F, H, K, T, X) to be completed together.
   */
  _queueHandwritingStroke(stroke) {
    if (!this.handwritingStrokes) this.handwritingStrokes = [];
    this.handwritingStrokes.push(stroke);

    if (this.handwritingTimer) {
      clearTimeout(this.handwritingTimer);
    }

    if (this.ui) {
      this.ui.setBufferingStatus(true);
    }

    this.handwritingTimer = setTimeout(() => {
      this._processBufferedHandwriting();
    }, 750);
  }

  /**
   * Processes buffered strokes of a complete character through the handwriting engine.
   */
  async _processBufferedHandwriting() {
    if (!this.handwritingStrokes || this.handwritingStrokes.length === 0) return;
    const strokes = [...this.handwritingStrokes];
    this.handwritingStrokes = [];

    // Combine all points from constituent strokes of this character
    const allPoints = [];
    for (const s of strokes) {
      allPoints.push(...s.points);
    }

    try {
      const result = await this.handwriting.classify(allPoints, strokes);
      if (result) {
        this.ui.appendHandwritingResult(result);

        // In write mode, gently clear the written character strokes after 900ms
        // so the canvas is clean and ready for the next letter
        setTimeout(() => {
          if (this.ui.appMode === "write") {
            this.strokeManager.clearCanvas();
          }
        }, 900);
      } else {
        if (this.ui) this.ui.setBufferingStatus(false);
      }
    } catch (err) {
      if (this.ui) this.ui.setBufferingStatus(false);
      console.error("Handwriting recognition error:", err);
    }
  }

  /**
   * Renders background, webcam feed, drawing layer, cursor HUD, and dwell progress ring.
   */
  render(dwellInfo, timestamp) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Layer 1: Background
    if (this.ui.backgroundMode === "white") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else if (this.ui.backgroundMode === "black") {
      ctx.fillStyle = "#0c0f17";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else {
      // Mirrored Webcam Feed
      if (this.video && this.video.readyState >= 2) {
        ctx.save();
        ctx.translate(CANVAS_WIDTH, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(this.video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.restore();

        // Slight dim overlay so drawings and toolbar stand out crisply
        ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      } else {
        ctx.fillStyle = "#111827";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
    }

    // Layer 2: Drawing Layer
    this.strokeManager.renderAll(ctx);

    // Layer 3: Shape Snap Pulse Visual Feedback
    if (this.shapeSnapFeedback) {
      const elapsed = timestamp - this.shapeSnapFeedback.time;
      if (elapsed < 600) {
        ctx.save();
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 3;
        ctx.shadowColor = "#22c55e";
        ctx.shadowBlur = 12;
        ctx.globalAlpha = 1.0 - elapsed / 600;

        // Visual flash around recent shape
        const lastStroke = this.strokeManager.strokes[this.strokeManager.strokes.length - 1];
        if (lastStroke) {
          this.strokeManager.renderStroke(ctx, lastStroke);
        }
        ctx.restore();
      } else {
        this.shapeSnapFeedback = null;
      }
    }

    // Layer 4: Interactive Hand Cursor & Dwell Progress Ring
    if (this.smoothedPointer) {
      this._renderCursor(ctx, this.smoothedPointer, dwellInfo);
    }
  }

  /**
   * Renders dynamic pointer cursor and animated dwell ring.
   */
  _renderCursor(ctx, p, dwellInfo) {
    ctx.save();

    if (this.activeMode === "draw") {
      // Draw Cursor: Brush color dot with size preview
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(4, this.strokeManager.activeSize / 2), 0, Math.PI * 2);
      ctx.fillStyle = this.strokeManager.activeColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    } else if (this.activeMode === "erase") {
      // Eraser Cursor: Large dashed circle showing eraser boundary
      const radius = (this.strokeManager.activeSize * this.strokeManager.eraserRadiusMultiplier) / 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#ef4444";
      ctx.setLineDash([6, 6]);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
    } else if (this.activeMode === "select") {
      // Selection Cursor: Target crosshair + circular dwell progress ring
      const ringRadius = UI_CONFIG.DWELL_RING_RADIUS;

      // Outer guide circle
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringRadius, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.stroke();

      // Dwell Progress Arc (fills clockwise 0 to 100%)
      if (dwellInfo.isHovering && dwellInfo.progress > 0) {
        ctx.beginPath();
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + dwellInfo.progress * Math.PI * 2;
        ctx.arc(p.x, p.y, ringRadius, startAngle, endAngle);
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#2457ff";
        ctx.shadowColor = "#2457ff";
        ctx.shadowBlur = 8;
        ctx.stroke();
      }

      // Center pointer dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#2457ff";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    } else if (this.activeMode === "pause") {
      // Pause Cursor: Fist symbol / pause bars
      ctx.fillStyle = "rgba(239, 68, 68, 0.85)";
      ctx.fillRect(p.x - 7, p.y - 8, 4, 16);
      ctx.fillRect(p.x + 3, p.y - 8, 4, 16);
    } else {
      // Idle Cursor: Subtle white/blue indicator
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#2457ff";
      ctx.stroke();
    }

    ctx.restore();
  }
}

// Bootstrap on DOM content loaded
window.addEventListener("DOMContentLoaded", () => {
  const app = new AirCanvasApp();
  app.init();
});
