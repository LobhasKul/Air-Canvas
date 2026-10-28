/**
 * metrics.js - Live FPS, Hand Tracking Latency, and 30-Second CSV Benchmark Recorder
 *
 * CSV Output Schema:
 * timestamp (ISO 8601), elapsed_sec, fps, latency_ms, hand_detected, gesture_mode
 */

export const METRICS_CONFIG = {
  FPS_WINDOW_SIZE: 30,             // Number of frames for smoothed FPS moving average
  RECORDING_DURATION_SEC: 30,      // Benchmark recording length
  RECORDING_SAMPLE_INTERVAL_MS: 50 // Minimum interval between metric log entries
};

export class MetricsTracker {
  constructor() {
    this.fps = 0;
    this.latencyMs = 0;
    this.handDetected = false;
    this.gestureMode = "idle";

    // FPS calculation state
    this.frameTimes = [];
    this.lastFrameTime = performance.now();

    // 30s Recording state
    this.isRecording = false;
    this.recordingStartTime = 0;
    this.recordedSamples = [];
    this.lastSampleTime = 0;
    this.onProgressCallback = null;
    this.onCompleteCallback = null;
  }

  /**
   * Updates frame rate metrics on each animation frame.
   * @param {number} timestamp - performance.now()
   */
  updateFrame(timestamp) {
    const delta = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    if (delta > 0) {
      const instantFps = 1000.0 / delta;
      this.frameTimes.push(instantFps);
      if (this.frameTimes.length > METRICS_CONFIG.FPS_WINDOW_SIZE) {
        this.frameTimes.shift();
      }
      const sum = this.frameTimes.reduce((acc, v) => acc + v, 0);
      this.fps = Math.round((sum / this.frameTimes.length) * 10) / 10;
    }

    // Handle active benchmark recording
    if (this.isRecording) {
      const elapsedMs = timestamp - this.recordingStartTime;
      const elapsedSec = elapsedMs / 1000.0;

      if (timestamp - this.lastSampleTime >= METRICS_CONFIG.RECORDING_SAMPLE_INTERVAL_MS) {
        this.lastSampleTime = timestamp;
        this.recordedSamples.push({
          timestamp: new Date().toISOString(),
          elapsed_sec: Math.round(elapsedSec * 1000) / 1000,
          fps: this.fps,
          latency_ms: Math.round(this.latencyMs * 10) / 10,
          hand_detected: this.handDetected,
          gesture_mode: this.gestureMode
        });
      }

      const remainingSec = Math.max(0, Math.ceil(METRICS_CONFIG.RECORDING_DURATION_SEC - elapsedSec));
      if (this.onProgressCallback) {
        this.onProgressCallback(remainingSec, this.recordedSamples.length);
      }

      if (elapsedSec >= METRICS_CONFIG.RECORDING_DURATION_SEC) {
        this.stopRecordingAndDownload();
      }
    }
  }

  /**
   * Updates tracking metrics received from the hand tracker.
   * @param {number} latencyMs - Time taken by detectForVideo()
   * @param {boolean} handDetected - Whether hand landmarks were found
   * @param {string} gestureMode - Active gesture classification
   */
  updateTracking(latencyMs, handDetected, gestureMode) {
    this.latencyMs = latencyMs;
    this.handDetected = handDetected;
    this.gestureMode = gestureMode;
  }

  /**
   * Starts a 30-second benchmark recording.
   * @param {function(number, number): void} [onProgress] - (remainingSec, sampleCount) => {}
   * @param {function(string): void} [onComplete] - (csvContent) => {}
   */
  startRecording(onProgress = null, onComplete = null) {
    if (this.isRecording) return;

    this.isRecording = true;
    this.recordingStartTime = performance.now();
    this.lastSampleTime = 0;
    this.recordedSamples = [];
    this.onProgressCallback = onProgress;
    this.onCompleteCallback = onComplete;
  }

  /**
   * Stops recording, builds the CSV string, and prompts browser download.
   */
  stopRecordingAndDownload() {
    this.isRecording = false;

    const headers = ["timestamp", "elapsed_sec", "fps", "latency_ms", "hand_detected", "gesture_mode"];
    const csvRows = [headers.join(",")];

    for (const sample of this.recordedSamples) {
      csvRows.push(
        [
          sample.timestamp,
          sample.elapsed_sec,
          sample.fps,
          sample.latency_ms,
          sample.hand_detected,
          `"${sample.gesture_mode}"`
        ].join(",")
      );
    }

    const csvContent = csvRows.join("\n");

    // Create and trigger blob download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `air-canvas-metrics-${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (this.onCompleteCallback) {
      this.onCompleteCallback(csvContent);
    }
  }

  /**
   * Cancels active recording without saving.
   */
  cancelRecording() {
    this.isRecording = false;
    this.recordedSamples = [];
  }
}
