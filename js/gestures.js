/**
 * gestures.js - Scale-invariant hand gesture recognition with hysteresis and debouncing
 *
 * Recognized Modes:
 * - "draw": Pinch gesture (Thumb tip + Index tip close together).
 * - "select": Index + Middle finger extended; Ring + Pinky curled.
 * - "erase": Open palm (All 4 fingers extended + Thumb spread).
 * - "pause": Fist (All fingers curled into palm).
 * - "idle": Neutral hand state / transitioning.
 *
 * All distance checks are normalized by palm scale (distance from WRIST to MIDDLE_MCP)
 * to ensure robust detection regardless of hand distance from camera.
 */

export const GESTURE_CONFIG = {
  // Pinch distance normalized by palm scale
  PINCH_ENTER_THRESHOLD: 0.35, // Distance ratio to ENTER pinch/draw mode
  PINCH_EXIT_THRESHOLD: 0.40,  // Distance ratio to EXIT pinch/draw mode (fast, responsive release)

  // Finger extension threshold (distance from tip to wrist vs pip to wrist)
  FINGER_EXTEND_RATIO: 1.15,

  // Thumb extension threshold (distance from thumb tip to pinky MCP normalized by palm scale)
  THUMB_SPREAD_THRESHOLD: 0.70,

  // Debounce frames required before confirming a mode switch
  DEBOUNCE_FRAMES: 3
};

// MediaPipe 21 Hand Landmarks Reference:
export const LANDMARKS = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20
};

/**
 * 3D Euclidean distance between two landmarks.
 */
function dist3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.hypot(dx, dy, dz);
}

/**
 * 2D Euclidean distance in normalized coordinate space.
 */
function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class GestureClassifier {
  constructor() {
    this.currentMode = "idle";
    this.isPinched = false;

    // Debounce state tracking
    this.candidateMode = "idle";
    this.candidateFrames = 0;
  }

  /**
   * Computes the palm scale reference (distance between WRIST and MIDDLE_FINGER_MCP).
   * @param {Array} lm - 21 normalized landmarks
   * @returns {number} Scale reference length
   */
  getPalmScale(lm) {
    const scale = dist3D(lm[LANDMARKS.WRIST], lm[LANDMARKS.MIDDLE_MCP]);
    // Prevent division by zero if hand is partially occluded
    return Math.max(scale, 0.05);
  }

  /**
   * Determines whether individual fingers are extended outward or curled into the palm.
   * @param {Array} lm - 21 normalized landmarks
   * @param {number} palmScale - Reference palm scale
   */
  analyzeFingers(lm, palmScale) {
    const wrist = lm[LANDMARKS.WRIST];

    // Check extension for the four main fingers
    const checkFinger = (tipIdx, pipIdx, mcpIdx) => {
      const tipDist = dist3D(lm[tipIdx], wrist);
      const pipDist = dist3D(lm[pipIdx], wrist);
      const mcpDist = dist3D(lm[mcpIdx], wrist);

      // Extended: tip is significantly farther from wrist than PIP is
      const isExtended = tipDist > pipDist * GESTURE_CONFIG.FINGER_EXTEND_RATIO && tipDist > mcpDist;
      // Curled: tip is close to MCP/wrist
      const isCurled = tipDist < pipDist || tipDist < mcpDist * 1.1;

      return { isExtended, isCurled };
    };

    const index = checkFinger(LANDMARKS.INDEX_TIP, LANDMARKS.INDEX_PIP, LANDMARKS.INDEX_MCP);
    const middle = checkFinger(LANDMARKS.MIDDLE_TIP, LANDMARKS.MIDDLE_PIP, LANDMARKS.MIDDLE_MCP);
    const ring = checkFinger(LANDMARKS.RING_TIP, LANDMARKS.RING_PIP, LANDMARKS.RING_MCP);
    const pinky = checkFinger(LANDMARKS.PINKY_TIP, LANDMARKS.PINKY_PIP, LANDMARKS.PINKY_MCP);

    // Thumb extension check: distance between thumb tip and pinky MCP
    const thumbDistToPinky = dist3D(lm[LANDMARKS.THUMB_TIP], lm[LANDMARKS.PINKY_MCP]) / palmScale;
    const thumbSpread = thumbDistToPinky > GESTURE_CONFIG.THUMB_SPREAD_THRESHOLD;

    // Thumb curled check: thumb tip near index MCP
    const thumbDistToIndexMCP = dist3D(lm[LANDMARKS.THUMB_TIP], lm[LANDMARKS.INDEX_MCP]) / palmScale;
    const thumbCurled = thumbDistToIndexMCP < 0.45;

    return { index, middle, ring, pinky, thumbSpread, thumbCurled };
  }

  /**
   * Classifies the raw instantaneous gesture mode from 21 hand landmarks.
   * Uses hysteresis on the pinch threshold to prevent boundary oscillation.
   * @param {Array} lm - 21 normalized landmarks
   * @returns {{mode: string, pointer: {x: number, y: number}, pinchDistanceRatio: number}}
   */
  classifyRaw(lm) {
    const palmScale = this.getPalmScale(lm);
    const thumbTip = lm[LANDMARKS.THUMB_TIP];
    const indexTip = lm[LANDMARKS.INDEX_TIP];
    const middleTip = lm[LANDMARKS.MIDDLE_TIP];

    // 1. Pinch Detection with Hysteresis
    const pinchDist = dist3D(thumbTip, indexTip);
    const pinchRatio = pinchDist / palmScale;

    if (this.isPinched) {
      if (pinchRatio > GESTURE_CONFIG.PINCH_EXIT_THRESHOLD) {
        this.isPinched = false;
      }
    } else {
      if (pinchRatio < GESTURE_CONFIG.PINCH_ENTER_THRESHOLD) {
        this.isPinched = true;
      }
    }

    const fingers = this.analyzeFingers(lm, palmScale);

    let rawMode = "idle";
    let pointer = { x: indexTip.x, y: indexTip.y };

    if (this.isPinched) {
      // PINCH -> DRAW
      rawMode = "draw";
      // Pointer is the intuitive midpoint between thumb tip and index tip
      pointer = {
        x: (thumbTip.x + indexTip.x) / 2,
        y: (thumbTip.y + indexTip.y) / 2
      };
    } else if (
      fingers.index.isExtended &&
      fingers.middle.isExtended &&
      !fingers.ring.isExtended &&
      !fingers.pinky.isExtended
    ) {
      // INDEX + MIDDLE UP -> SELECTION MODE
      rawMode = "select";
      // Pointer at midpoint of index and middle tips for natural target pointing
      pointer = {
        x: (indexTip.x + middleTip.x) / 2,
        y: (indexTip.y + middleTip.y) / 2
      };
    } else if (
      fingers.index.isExtended &&
      fingers.middle.isExtended &&
      fingers.ring.isExtended &&
      fingers.pinky.isExtended &&
      fingers.thumbSpread
    ) {
      // OPEN PALM -> ERASER
      rawMode = "erase";
      // Pointer at palm center (midpoint between middle MCP and wrist)
      const palmCenter = {
        x: (lm[LANDMARKS.WRIST].x + lm[LANDMARKS.MIDDLE_MCP].x) / 2,
        y: (lm[LANDMARKS.WRIST].y + lm[LANDMARKS.MIDDLE_MCP].y) / 2
      };
      pointer = palmCenter;
    } else if (
      fingers.index.isCurled &&
      fingers.middle.isCurled &&
      fingers.ring.isCurled &&
      fingers.pinky.isCurled &&
      fingers.thumbCurled
    ) {
      // FIST -> PAUSE
      rawMode = "pause";
      pointer = { x: lm[LANDMARKS.MIDDLE_MCP].x, y: lm[LANDMARKS.MIDDLE_MCP].y };
    } else {
      // Neutral state (e.g., single index finger hovering without pinch)
      rawMode = "idle";
      pointer = { x: indexTip.x, y: indexTip.y };
    }

    return { mode: rawMode, pointer, pinchDistanceRatio: pinchRatio };
  }

  /**
   * Processes hand landmarks with temporal debouncing.
   * A state transition only occurs if candidate mode stays stable for DEBOUNCE_FRAMES.
   * @param {Array} landmarks - 21 normalized landmarks from HandLandmarker
   * @returns {{mode: string, pointer: {x: number, y: number}, isModeChanged: boolean, pinchRatio: number}}
   */
  process(landmarks) {
    if (!landmarks || landmarks.length === 0) {
      const modeChanged = this.currentMode !== "idle";
      this.currentMode = "idle";
      this.candidateMode = "idle";
      this.candidateFrames = 0;
      this.isPinched = false;
      return {
        mode: "idle",
        pointer: null,
        isModeChanged: modeChanged,
        pinchRatio: 1.0
      };
    }

    const raw = this.classifyRaw(landmarks);

    // Fast Draw Release: when user unpinches, stop drawing immediately without delay
    if (this.currentMode === "draw" && raw.mode !== "draw") {
      this.currentMode = raw.mode;
      this.candidateMode = raw.mode;
      this.candidateFrames = GESTURE_CONFIG.DEBOUNCE_FRAMES;
      return {
        mode: this.currentMode,
        pointer: raw.pointer,
        isModeChanged: true,
        pinchRatio: raw.pinchDistanceRatio
      };
    }

    // Debounce filter: require mode to persist for N consecutive frames
    if (raw.mode === this.candidateMode) {
      this.candidateFrames++;
    } else {
      this.candidateMode = raw.mode;
      this.candidateFrames = 1;
    }

    let isModeChanged = false;
    if (this.candidateFrames >= GESTURE_CONFIG.DEBOUNCE_FRAMES && this.currentMode !== this.candidateMode) {
      this.currentMode = this.candidateMode;
      isModeChanged = true;
    }

    return {
      mode: this.currentMode,
      pointer: raw.pointer,
      isModeChanged,
      pinchRatio: raw.pinchDistanceRatio
    };
  }

  /**
   * Resets classifier state when hand is lost.
   */
  reset() {
    this.currentMode = "idle";
    this.candidateMode = "idle";
    this.candidateFrames = 0;
    this.isPinched = false;
  }
}
