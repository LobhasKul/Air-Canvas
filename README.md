# Air Canvas 🎨
### *Transform Gestures into Art*

[![GitHub repo](https://img.shields.io/badge/GitHub-LobhasKul%2FAir--Canvas-blue?logo=github)](https://github.com/LobhasKul/Air-Canvas)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Pure Web Standards](https://img.shields.io/badge/Stack-HTML5%20%7C%20CSS3%20%7C%20Vanilla%20ES6-success)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![MediaPipe](https://img.shields.io/badge/AI-MediaPipe%20Hand%20Landmarker-orange)](https://developers.google.com/mediapipe)
[![TensorFlow.js](https://img.shields.io/badge/AI-TensorFlow.js-FF6F00?logo=tensorflow)](https://www.tensorflow.org/js)

A high-performance, client-side, browser-based web application that lets users draw, erase, manipulate tools, snap geometric shapes, and recognize handwriting in the air using hand gestures tracked in real-time through their webcam.

Built entirely with standard Web standards (HTML5 Canvas, CSS3, vanilla ES Modules), **MediaPipe Hand Landmarker** (via `@tasks-vision`), and **TensorFlow.js**. Operates 100% in the user's browser with **zero backend dependencies**, making it ideal for instant deployment on GitHub Pages, Netlify, or Vercel.

---

## 🌟 Key Features

### 1. Touchless Gesture Recognition & Control
Gestures are classified in real-time from 21 MediaPipe 3D hand landmarks with palm scale normalization and dual-threshold hysteresis:
- **🤏 Pinch (Thumb tip + Index tip together)**: Draw fluid strokes. Exiting pinch stops drawing immediately on that exact frame with zero dragging tails.
- **✌️ Two Fingers (Index + Middle extended)**: Selection mode. Hover over header buttons with an animated circular progress ring (dwell time: ~750ms) to trigger contactless clicks!
- **🖐️ Open Palm (All fingers extended & spread)**: Large radius eraser. Cleans ink on an isolated offscreen layer without ever damaging or cutting through the webcam feed.
- **✊ Fist (All fingers curled into palm)**: Pause drawing and freely reposition cursor.
- **Idle (Neutral hand state)**: Smooth pointer hovering without modifying canvas.

### 2. 1€ (One Euro) Adaptive Low-Pass Filter
Eliminates camera tracking jitter and hand tremors when drawing slowly or holding still ($f_{c,\min} = 1.0\text{ Hz}$), while dynamically opening cutoff frequency at high velocities ($\beta = 0.007$) for lag-free, responsive tracking during fast strokes.

### 3. Header-Integrated Drawing Toolbar
All tools are organized within the top header bar, keeping the entire drawing stage unobstructed:
- **6 Vibrant Colors**: Crimson Red, Electric Blue, Emerald Green, Cyber Yellow, Neon Violet, Pure White.
- **Adjustable Brush Radius**: 2px to 48px with live indicator.
- **4 Brush Styles**:
  - `Solid`: Clean, round-capped vector-smooth strokes.
  - `Neon`: Dual-pass glowing laser beam with an intense core aura.
  - `Dashed`: Styled dashed stroke path.
  - `Calligraphy`: Dynamic width governed by stroke velocity and simulated 45-degree chisel nib geometry.
- **Canvas Operations**: Full undo/redo stack, canvas clear, and background toggle (Mirrored Webcam feed / Pure White Board / Black Blackboard).
- **Multi-Format Export**: PNG (with active background), Transparent PNG (drawing layer only), and standalone Vector SVG.

### 4. Freehand Preservation & Geometric Shape Snapping
- **Freehand Drawing First**: Freehand strokes remain exactly as drawn upon stroke completion without unwanted auto-conversions.
- **Deliberate Snapping**: Hold hand stationary (<18 px/s) for ~600 ms at the end of a stroke to snap into clean geometric shapes:
  - **Straight Line**: Endpoint distance vs. arc length ($D / L \ge 0.88$).
  - **Circle**: Closed curve with low radial standard deviation ($\sigma_r / \bar{r} \le 0.16$).
  - **Heart (`❤️`)**: Two symmetrical upper lobes, top notch cleft, and centered bottom tip.
  - **Rectangle**: Closed curve with 4 dominant $90^\circ \pm 25^\circ$ corners (via Ramer-Douglas-Peucker simplification).
  - **Triangle**: Closed curve with 3 dominant corners summing to $180^\circ \pm 40^\circ$.
  - *Reversibility*: Snapped shapes flash with visual feedback; pressing **Undo** immediately reverts back to the raw hand-drawn stroke!

### 5. Touchless Handwriting Recognition ("Write" Mode)
- Switch to **✍️ Write Mode** to write letters and numbers in the air.
- **Multi-Stroke Buffering**: Groups strokes drawn within 600ms (e.g. crossbars of `A`, `T`, `H`, `E`, `X`) into a single character before classification.
- **Spatial Zone Classification**: Evaluates a 9-zone raster density matrix and trajectory features covering all digits (`0-9`) and uppercase letters (`A-Z`).
- Predictions are displayed with real-time confidence scores and automatically appended to an editable, copyable text bar.

### 6. Live Performance HUD & 30-Second Benchmark Recorder
- Press **P** or click ⚡ to reveal the live performance HUD displaying FPS and MediaPipe hand detection latency in milliseconds.
- Click **Record 30s Benchmark CSV** to log metrics across 30 seconds into a downloadable CSV file (`timestamp`, `elapsed_sec`, `fps`, `latency_ms`, `hand_detected`, `gesture_mode`).

---

## 🗂️ Project Structure

```
Air-Canvas/
├── index.html                  # Accessible layout, top header bar, modals, and HUD
├── styles.css                  # Responsive design, light/dark themes, dwell ring animations
├── server.js                   # Zero-dependency local Node.js static file server
├── js/
│   ├── main.js                 # App lifecycle, animation loop, render pipeline
│   ├── handTracking.js         # MediaPipe HandLandmarker wrapper with GPU -> CPU fallback
│   ├── gestures.js             # 21-landmark gesture classification with fast release
│   ├── smoothing.js            # 1€ (One Euro) adaptive low-pass filter
│   ├── strokes.js              # Stroke data model, styles, offscreen eraser layer, SVG/PNG export
│   ├── shapes.js               # Geometric heuristics for line, circle, rect, triangle, heart snapping
│   ├── handwriting.js          # Multi-stroke 9-zone density alphanumeric recognition engine
│   ├── metrics.js              # Live FPS, latency tracking & 30s CSV benchmark recording
│   └── ui.js                   # Header controls, dwell-time progress ring, shortcuts & toasts
├── model/
│   ├── model.json              # TF.js model topology manifest
│   ├── group1-shard1of1.bin    # Model weight parameters
│   └── README.md               # Model documentation
├── train_handwriting.py        # Optional Python Keras training pipeline & TF.js converter
└── README.md                   # Project documentation
```

---

## ⌨️ Keyboard Shortcuts & Gestures

| Key | Action | Gesture Alternative |
| :--- | :--- | :--- |
| `Space` / Drag | Draw Freehand | 🤏 Pinch (Thumb + Index tips) |
| Hover | Select & Dwell Click | ✌️ Index + Middle extended (~750ms dwell) |
| `E` | Eraser | 🖐️ Open Palm (Spread all fingers) |
| `Esc` | Pause pointer | ✊ Fist (All fingers curled) |
| Pause 600ms | Snap Shape (Line, Circle, Rect, Triangle, Heart) | Hold hand stationary at stroke end |
| `1` - `6` | Select Color Palette | ✌️ Hover over color swatch in header |
| `[` / `]` | Decrease / Increase Size | ✌️ Hover over &minus; / + in header |
| `Z` / `Ctrl+Z` | Undo (or revert snapped shape) | ✌️ Hover over Undo in header |
| `Y` / `Ctrl+Y` | Redo | ✌️ Hover over Redo in header |
| `C` | Clear Canvas | ✌️ Hover over Clear in header |
| `S` | Export PNG (with background) | ✌️ Hover over PNG in header |
| `T` | Export Transparent PNG | ✌️ Hover over Alpha in header |
| `V` | Export Vector SVG | ✌️ Hover over SVG in header |
| `B` | Toggle Background (Webcam / White / Black) | ✌️ Hover over BG in header |
| `W` | Toggle Handwriting Write Mode | ✌️ Hover over Write in header |
| `P` | Toggle Performance Panel | ✌️ Hover over ⚡ in header |
| `?` | Toggle Help & Shortcuts Modal | ✌️ Hover over ❓ in header |

---

## 🚀 Running Locally

Because webcam access requires a secure context (`window.isSecureContext`) or `localhost`/`127.0.0.1`, serve the project root via the included zero-dependency Node server:

### Option A: Built-in Node.js Server (Recommended)
```bash
# Navigate to the project directory
cd "Air Canvas"

# Start the server (runs on port 8000)
node server.js
```
Open **[http://localhost:8000](http://localhost:8000)** in Chrome, Edge, or Brave.

### Option B: Python 3
```bash
python -m http.server 8000
```

---

## 🚢 Deployment to GitHub Pages

To host this repository live on GitHub Pages:
1. Go to your repository on GitHub: **[LobhasKul/Air-Canvas](https://github.com/LobhasKul/Air-Canvas)**
2. Click **Settings** > **Pages** (in the left sidebar).
3. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main`, folder: `/ (root)`
4. Click **Save**.
5. Your application will be live at `https://lobhaskul.github.io/Air-Canvas/` with HTTPS enabled automatically!

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
Created by [LobhasKul](https://github.com/LobhasKul).
