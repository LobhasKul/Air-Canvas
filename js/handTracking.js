/**
 * handTracking.js - MediaPipe Hand Landmarker initialization and camera stream management
 *
 * Pinned version: @mediapipe/tasks-vision@0.10.14 via jsDelivr
 * Hardware Acceleration: Tries GPU delegate first; falls back gracefully to CPU if GPU fails.
 */

import {
  HandLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

export const TRACKING_CONFIG = {
  WASM_CDN: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  MODEL_ASSET_PATH:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  NUM_HANDS: 1,
  MIN_HAND_DETECTION_CONFIDENCE: 0.5,
  MIN_HAND_PRESENCE_CONFIDENCE: 0.5,
  MIN_TRACKING_CONFIDENCE: 0.5,
  TARGET_WIDTH: 1280,
  TARGET_HEIGHT: 720
};

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.activeDelegate = null; // "GPU" or "CPU"
    this.videoElement = null;
    this.stream = null;
    this.isReady = false;
    this.lastVideoTime = -1;
  }

  /**
   * Validates browser environment for camera API support and secure context.
   */
  static checkEnvironment() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return {
        supported: false,
        reason: "Your browser does not support webcam capture (navigator.mediaDevices is unavailable)."
      };
    }

    // Camera access strictly requires HTTPS, localhost, or 127.0.0.1
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "[::1]";

    if (!window.isSecureContext && !isLocalhost) {
      return {
        supported: false,
        reason: "Webcam access requires a secure connection (HTTPS) or localhost. Please load this page over HTTPS."
      };
    }

    return { supported: true, reason: "" };
  }

  /**
   * Initializes the MediaPipe HandLandmarker with GPU delegate first,
   * falling back gracefully to CPU if GPU initialization throws.
   * @param {function(string): void} [onStatusUpdate] - Optional status callback for UI loading feedback
   */
  async initModel(onStatusUpdate = () => {}) {
    onStatusUpdate("Loading vision runtime (WebAssembly)...");
    const fileset = await FilesetResolver.forVisionTasks(TRACKING_CONFIG.WASM_CDN);

    // 1. Attempt GPU delegate
    try {
      onStatusUpdate("Initializing Hand Landmarker (GPU delegate)...");
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: TRACKING_CONFIG.MODEL_ASSET_PATH,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: TRACKING_CONFIG.NUM_HANDS,
        minHandDetectionConfidence: TRACKING_CONFIG.MIN_HAND_DETECTION_CONFIDENCE,
        minHandPresenceConfidence: TRACKING_CONFIG.MIN_HAND_PRESENCE_CONFIDENCE,
        minTrackingConfidence: TRACKING_CONFIG.MIN_TRACKING_CONFIDENCE
      });
      this.activeDelegate = "GPU";
    } catch (gpuError) {
      console.warn("GPU delegate initialization failed; falling back to CPU delegate:", gpuError);
      onStatusUpdate("GPU unavailable. Falling back to CPU delegate...");

      // 2. Fall back to CPU delegate
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: TRACKING_CONFIG.MODEL_ASSET_PATH,
          delegate: "CPU"
        },
        runningMode: "VIDEO",
        numHands: TRACKING_CONFIG.NUM_HANDS,
        minHandDetectionConfidence: TRACKING_CONFIG.MIN_HAND_DETECTION_CONFIDENCE,
        minHandPresenceConfidence: TRACKING_CONFIG.MIN_HAND_PRESENCE_CONFIDENCE,
        minTrackingConfidence: TRACKING_CONFIG.MIN_TRACKING_CONFIDENCE
      });
      this.activeDelegate = "CPU";
    }

    this.isReady = true;
    onStatusUpdate(`Hand Tracker ready (${this.activeDelegate} mode).`);
    return this.activeDelegate;
  }

  /**
   * Requests camera permission and connects webcam feed to the supplied video element.
   * @param {HTMLVideoElement} videoElement
   */
  async startCamera(videoElement) {
    const env = HandTracker.checkEnvironment();
    if (!env.supported) {
      throw new Error(env.reason);
    }

    this.videoElement = videoElement;

    // Mobile-friendly constraints prioritizing facingMode: "user" (front camera)
    const constraints = {
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: TRACKING_CONFIG.TARGET_WIDTH },
        height: { ideal: TRACKING_CONFIG.TARGET_HEIGHT }
      }
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = this.stream;
      this.videoElement.setAttribute("playsinline", "true"); // Crucial for iOS / Android Chrome inline play
      this.videoElement.muted = true;
      await this.videoElement.play();
      return true;
    } catch (err) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        throw new Error("Camera permission was denied. Please allow camera access in your browser settings to use Air Canvas.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        throw new Error("No camera device was detected on your system. Please plug in a webcam and refresh.");
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        throw new Error("Webcam is already in use by another application or tab. Please close other camera apps.");
      }
      throw err;
    }
  }

  /**
   * Processes a video frame through HandLandmarker if a new frame is ready.
   * @param {number} timestamp - performance.now()
   * @returns {{landmarks: Array|null, latencyMs: number, handDetected: boolean}}
   */
  detect(timestamp) {
    if (!this.landmarker || !this.videoElement || this.videoElement.readyState < 2) {
      return { landmarks: null, latencyMs: 0, handDetected: false };
    }

    // Only process when video frame has advanced
    if (this.videoElement.currentTime === this.lastVideoTime) {
      return { landmarks: null, latencyMs: 0, handDetected: false, skipped: true };
    }
    this.lastVideoTime = this.videoElement.currentTime;

    const tStart = performance.now();
    const result = this.landmarker.detectForVideo(this.videoElement, timestamp);
    const latencyMs = performance.now() - tStart;

    const hasHand = Boolean(result && result.landmarks && result.landmarks.length > 0);
    const landmarks = hasHand ? result.landmarks[0] : null;

    return {
      landmarks,
      latencyMs,
      handDetected: hasHand
    };
  }

  /**
   * Stops video stream and releases camera hardware resources.
   */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
    this.isReady = false;
  }
}
