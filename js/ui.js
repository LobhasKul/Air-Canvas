/**
 * ui.js - Toolbar management, touchless air dwell-selection progress ring,
 * toast notifications, dark/light theme toggle, and keyboard shortcuts
 */

export const UI_CONFIG = {
  DWELL_DURATION_MS: 750,      // Time required to hover over a button to trigger contactless click
  DWELL_RING_RADIUS: 24,       // Visual progress ring radius in pixels
  TOAST_DURATION_MS: 3000      // Duration toast notifications stay on screen
};

export class UIManager {
  constructor(strokeManager, metricsTracker, handwritingClassifier) {
    this.strokeManager = strokeManager;
    this.metricsTracker = metricsTracker;
    this.handwriting = handwritingClassifier;

    // Background mode: "webcam" | "white" | "black"
    this.backgroundMode = "webcam";

    // Application mode: "draw" | "write"
    this.appMode = "draw";

    // Dwell interaction state
    this.hoveredElement = null;
    this.dwellStartTime = 0;
    this.dwellProgress = 0;     // 0.0 to 1.0
    this.hasTriggeredDwell = false;
    this.lastDwellTriggerTime = 0;

    // Toast stack
    this.toastContainer = null;

    // DOM references cached in bindDOM()
    this.dom = {};
  }

  /**
   * Caches DOM elements and attaches mouse/keyboard listeners.
   */
  bindDOM() {
    this.dom.stage = document.getElementById("stage");
    this.dom.viewCanvas = document.getElementById("view");
    this.dom.toolbar = document.getElementById("toolbar");
    this.dom.statusBadge = document.getElementById("status-badge");
    this.dom.modeIndicator = document.getElementById("mode-indicator");
    this.dom.handPresence = document.getElementById("hand-presence");
    this.dom.metricsPanel = document.getElementById("metrics-panel");
    this.dom.liveFps = document.getElementById("live-fps");
    this.dom.liveLatency = document.getElementById("live-latency");
    this.dom.btnRecordMetrics = document.getElementById("btn-record-metrics");
    this.dom.writeOutputBar = document.getElementById("write-output-bar");
    this.dom.recognizedText = document.getElementById("recognized-text");
    this.dom.confidenceBadge = document.getElementById("confidence-badge");
    this.dom.toastContainer = document.getElementById("toast-container");
    this.dom.themeToggle = document.getElementById("theme-toggle");
    this.dom.helpModal = document.getElementById("help-modal");
    this.dom.brushSizeDisplay = document.getElementById("brush-size-display");

    this._setupColorPalette();
    this._setupBrushStyles();
    this._setupActionButtons();
    this._setupKeyboardShortcuts();
    this._setupTheme();
  }

  /**
   * Initializes color selection swatches.
   */
  _setupColorPalette() {
    const swatches = document.querySelectorAll(".color-swatch");
    swatches.forEach((swatch) => {
      swatch.addEventListener("click", () => {
        const color = swatch.dataset.color;
        this.strokeManager.activeColor = color;
        swatches.forEach((s) => {
          s.classList.toggle("active", s === swatch);
          s.setAttribute("aria-checked", s === swatch ? "true" : "false");
        });
        this.showToast(`Color: ${swatch.getAttribute("aria-label")}`);
      });
    });
  }

  /**
   * Initializes brush style buttons (solid, neon, dashed, calligraphy).
   */
  _setupBrushStyles() {
    const styleBtns = document.querySelectorAll(".style-btn");
    styleBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const style = btn.dataset.style;
        this.strokeManager.activeStyle = style;
        styleBtns.forEach((b) => {
          b.classList.toggle("active", b === btn);
          b.setAttribute("aria-checked", b === btn ? "true" : "false");
        });
        this.showToast(`Brush Style: ${style.toUpperCase()}`);
      });
    });
  }

  /**
   * Attaches event listeners to toolbar action buttons.
   */
  _setupActionButtons() {
    // Brush Size controls
    document.getElementById("btn-size-down")?.addEventListener("click", () => {
      this.strokeManager.activeSize = Math.max(2, this.strokeManager.activeSize - 3);
      this._updateBrushSizeDisplay();
    });

    document.getElementById("btn-size-up")?.addEventListener("click", () => {
      this.strokeManager.activeSize = Math.min(48, this.strokeManager.activeSize + 3);
      this._updateBrushSizeDisplay();
    });

    // Undo / Redo / Clear
    document.getElementById("btn-undo")?.addEventListener("click", () => {
      const res = this.strokeManager.undo();
      if (res) {
        this.showToast(res.action === "revertedShape" ? "Reverted shape snap" : "Undo");
      }
    });

    document.getElementById("btn-redo")?.addEventListener("click", () => {
      const res = this.strokeManager.redo();
      if (res) this.showToast("Redo");
    });

    document.getElementById("btn-clear")?.addEventListener("click", () => {
      this.strokeManager.clear();
      this.showToast("Canvas cleared (Undo available)");
    });

    // Exports
    document.getElementById("btn-save-png")?.addEventListener("click", () => {
      this.triggerDownload(
        this.strokeManager.exportPNG({
          transparent: false,
          backgroundMode: this.backgroundMode,
          videoElement: document.getElementById("cam")
        }),
        "air-canvas.png"
      );
      this.showToast("Exported PNG");
    });

    document.getElementById("btn-save-transparent")?.addEventListener("click", () => {
      this.triggerDownload(
        this.strokeManager.exportPNG({ transparent: true }),
        "air-canvas-transparent.png"
      );
      this.showToast("Exported Transparent PNG");
    });

    document.getElementById("btn-save-svg")?.addEventListener("click", () => {
      const bg = this.backgroundMode === "white" ? "#ffffff" : this.backgroundMode === "black" ? "#0e1117" : "transparent";
      const svgData = this.strokeManager.exportSVG(bg);
      const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      this.triggerDownload(url, "air-canvas.svg");
      URL.revokeObjectURL(url);
      this.showToast("Exported Vector SVG");
    });

    // Background Mode Toggle: Webcam -> White -> Black -> Webcam
    document.getElementById("btn-toggle-bg")?.addEventListener("click", () => {
      if (this.backgroundMode === "webcam") this.backgroundMode = "white";
      else if (this.backgroundMode === "white") this.backgroundMode = "black";
      else this.backgroundMode = "webcam";

      const label = document.getElementById("bg-mode-label");
      if (label) label.textContent = this.backgroundMode.toUpperCase();
      this.showToast(`Background: ${this.backgroundMode.toUpperCase()}`);
    });

    // Mode Toggle: Draw Mode <-> Write Mode (Handwriting)
    document.getElementById("btn-toggle-mode")?.addEventListener("click", () => {
      this.toggleAppMode();
    });

    // Handwriting output bar actions
    document.getElementById("btn-copy-text")?.addEventListener("click", () => {
      const text = this.dom.recognizedText?.value || "";
      if (text) {
        navigator.clipboard.writeText(text);
        this.showToast("Copied text to clipboard!");
      }
    });

    document.getElementById("btn-backspace-text")?.addEventListener("click", () => {
      if (this.dom.recognizedText) {
        this.dom.recognizedText.value = this.dom.recognizedText.value.slice(0, -1);
      }
    });

    document.getElementById("btn-clear-text")?.addEventListener("click", () => {
      if (this.dom.recognizedText) {
        this.dom.recognizedText.value = "";
      }
    });

    // Metrics panel toggle & 30s recording
    document.getElementById("btn-toggle-metrics")?.addEventListener("click", () => {
      this.toggleMetricsPanel();
    });

    this.dom.btnRecordMetrics?.addEventListener("click", () => {
      if (this.metricsTracker.isRecording) {
        this.metricsTracker.cancelRecording();
        if (this.dom.btnRecordMetrics) this.dom.btnRecordMetrics.textContent = "Record 30s Metrics";
        this.showToast("Recording cancelled");
      } else {
        this.dom.btnRecordMetrics.textContent = "Recording (30s)...";
        this.showToast("Recording 30 seconds of performance metrics...");
        this.metricsTracker.startRecording(
          (remainingSec, count) => {
            if (this.dom.btnRecordMetrics) {
              this.dom.btnRecordMetrics.textContent = `Recording (${remainingSec}s)...`;
            }
          },
          (csvContent) => {
            if (this.dom.btnRecordMetrics) this.dom.btnRecordMetrics.textContent = "Record 30s Metrics";
            this.showToast("30s Benchmark complete! CSV downloaded.");
          }
        );
      }
    });

    // Help modal toggle
    document.getElementById("btn-help")?.addEventListener("click", () => {
      this.dom.helpModal?.classList.toggle("hidden");
    });
    document.getElementById("btn-close-help")?.addEventListener("click", () => {
      this.dom.helpModal?.classList.add("hidden");
    });
  }

  /**
   * Toggles between Draw mode and Handwriting Write mode.
   */
  toggleAppMode() {
    if (this.appMode === "draw") {
      this.appMode = "write";
      this.dom.writeOutputBar?.classList.remove("hidden");
      this.showToast("Write Mode: Draw letters or digits in the air");
    } else {
      this.appMode = "draw";
      this.dom.writeOutputBar?.classList.add("hidden");
      this.showToast("Draw Mode");
    }

    const modeBtn = document.getElementById("btn-toggle-mode");
    if (modeBtn) {
      modeBtn.classList.toggle("active", this.appMode === "write");
      modeBtn.setAttribute("aria-pressed", this.appMode === "write" ? "true" : "false");
    }
  }

  /**
   * Helper to download data URL as a file.
   */
  triggerDownload(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  _updateBrushSizeDisplay() {
    if (this.dom.brushSizeDisplay) {
      this.dom.brushSizeDisplay.textContent = `${this.strokeManager.activeSize}px`;
    }
    this.showToast(`Brush Size: ${this.strokeManager.activeSize}px`);
  }

  /**
   * Registers global keyboard shortcuts for full accessibility.
   */
  _setupKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      // Don't intercept typing inside input/textarea fields
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      const key = e.key.toLowerCase();

      // Undo: Ctrl+Z or Z
      if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
        e.preventDefault();
        document.getElementById("btn-undo")?.click();
      } else if ((e.ctrlKey || e.metaKey) && ((key === "z" && e.shiftKey) || key === "y")) {
        e.preventDefault();
        document.getElementById("btn-redo")?.click();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (key) {
          case "z":
            document.getElementById("btn-undo")?.click();
            break;
          case "y":
            document.getElementById("btn-redo")?.click();
            break;
          case "c":
            document.getElementById("btn-clear")?.click();
            break;
          case "s":
            document.getElementById("btn-save-png")?.click();
            break;
          case "t":
            document.getElementById("btn-save-transparent")?.click();
            break;
          case "v":
            document.getElementById("btn-save-svg")?.click();
            break;
          case "b":
            document.getElementById("btn-toggle-bg")?.click();
            break;
          case "w":
            document.getElementById("btn-toggle-mode")?.click();
            break;
          case "p":
            this.toggleMetricsPanel();
            break;
          case "[":
            document.getElementById("btn-size-down")?.click();
            break;
          case "]":
            document.getElementById("btn-size-up")?.click();
            break;
          case "?":
            this.dom.helpModal?.classList.toggle("hidden");
            break;
          case "1":
          case "2":
          case "3":
          case "4":
          case "5":
          case "6": {
            const swatches = document.querySelectorAll(".color-swatch");
            const idx = parseInt(key, 10) - 1;
            if (swatches[idx]) swatches[idx].click();
            break;
          }
        }
      }
    });
  }

  /**
   * Sets up light / dark theme toggle with localStorage persistence and system preference fallback.
   */
  _setupTheme() {
    const savedTheme = localStorage.getItem("air_canvas_theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = savedTheme || (prefersDark ? "dark" : "light");

    this.setTheme(initialTheme);

    this.dom.themeToggle?.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      this.setTheme(next);
      this.showToast(`Theme: ${next === "dark" ? "Dark Mode" : "Light Mode"}`);
    });
  }

  setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("air_canvas_theme", theme);
    if (this.dom.themeToggle) {
      this.dom.themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
      this.dom.themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`);
    }
  }

  toggleMetricsPanel() {
    this.dom.metricsPanel?.classList.toggle("hidden");
  }

  /**
   * Processes contactless touchless air dwell hover in "select" mode.
   * If user hovers over an interactive button for DWELL_DURATION_MS, triggers click!
   * @param {{x: number, y: number}} screenPoint - Smoothed cursor coordinate in canvas space
   * @returns {{isHovering: boolean, progress: number, targetRect: DOMRect|null}}
   */
  processDwell(screenPoint) {
    if (!screenPoint || !this.dom.viewCanvas) {
      this._resetDwell();
      return { isHovering: false, progress: 0, targetRect: null };
    }

    // Convert canvas coordinates to client window coordinates.
    // Map Y smoothly from header top (0) to canvas bottom so touchless air hover reaches the header toolbar.
    const rect = this.dom.viewCanvas.getBoundingClientRect();
    const clientX = rect.left + (screenPoint.x / this.dom.viewCanvas.width) * rect.width;
    const clientY = (screenPoint.y / this.dom.viewCanvas.height) * rect.bottom;

    // Test for interactive element under cursor
    const element = document.elementFromPoint(clientX, clientY);
    const interactiveTarget = element?.closest(
      "button, .color-swatch, .style-btn, [data-interactive='true']"
    );

    const now = performance.now();

    if (interactiveTarget) {
      // Add visual hover class
      interactiveTarget.classList.add("air-hovered");

      if (this.hoveredElement === interactiveTarget) {
        // Continuing hover on the same element
        const elapsed = now - this.dwellStartTime;
        this.dwellProgress = Math.min(1.0, elapsed / UI_CONFIG.DWELL_DURATION_MS);

        if (this.dwellProgress >= 1.0 && !this.hasTriggeredDwell) {
          // Trigger contactless dwell click!
          this.hasTriggeredDwell = true;
          this.lastDwellTriggerTime = now;
          interactiveTarget.click();
          this._flashElement(interactiveTarget);
        }
      } else {
        // Switched to a new element
        if (this.hoveredElement) {
          this.hoveredElement.classList.remove("air-hovered");
        }
        this.hoveredElement = interactiveTarget;
        this.dwellStartTime = now;
        this.dwellProgress = 0;
        this.hasTriggeredDwell = false;
      }

      return {
        isHovering: true,
        progress: this.dwellProgress,
        targetRect: interactiveTarget.getBoundingClientRect()
      };
    } else {
      this._resetDwell();
      return { isHovering: false, progress: 0, targetRect: null };
    }
  }

  _resetDwell() {
    if (this.hoveredElement) {
      this.hoveredElement.classList.remove("air-hovered");
      this.hoveredElement = null;
    }
    this.dwellStartTime = 0;
    this.dwellProgress = 0;
    this.hasTriggeredDwell = false;
  }

  _flashElement(el) {
    el.classList.add("air-triggered");
    setTimeout(() => el.classList.remove("air-triggered"), 350);
  }

  /**
   * Displays an accessible toast message.
   */
  showToast(message, duration = UI_CONFIG.TOAST_DURATION_MS) {
    if (!this.dom.toastContainer) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = message;

    this.dom.toastContainer.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
      toast.classList.add("toast-fade");
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * Updates HUD status indicators (Gesture badge, hand tracking dot, FPS).
   */
  updateHUD(gestureMode, handDetected, fps, latencyMs) {
    if (this.dom.statusBadge) {
      this.dom.statusBadge.textContent = gestureMode.toUpperCase();
      this.dom.statusBadge.setAttribute("data-mode", gestureMode);
    }

    if (this.dom.handPresence) {
      this.dom.handPresence.classList.toggle("detected", handDetected);
      this.dom.handPresence.setAttribute(
        "title",
        handDetected ? "Hand Detected" : "No Hand Detected"
      );
    }

    if (this.dom.liveFps) {
      this.dom.liveFps.textContent = fps.toFixed(1);
    }
    if (this.dom.liveLatency) {
      this.dom.liveLatency.textContent = `${latencyMs.toFixed(1)} ms`;
    }
  }

  /**
   * Appends recognized handwriting character to the UI output box.
   */
  appendHandwritingResult(result) {
    if (!result) return;
    if (this.dom.recognizedText) {
      this.dom.recognizedText.value += result.char;
    }
    if (this.dom.confidenceBadge) {
      this.dom.confidenceBadge.textContent = `'${result.char}' (${result.confidence}%)`;
    }
    this.showToast(`Recognized '${result.char}' (${result.confidence}%)`);
  }
}
