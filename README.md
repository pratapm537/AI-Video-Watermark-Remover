# AI Video Watermark Remover - Product Requirements Document (PRD)

> **⚠️ WARNING:** For testing and regular usage, **always add short videos which are less than 1MB.**

---

## 1. Overview
The AI Video Watermark Remover is a full-stack application that allows users to seamlessly upload a video, graphically select a watermark or logo using an interactive bounding box, and process the video to remove the watermark utilizing FFmpeg's `delogo` filter. 

## 2. Project Architecture & Technologies
- **Frontend**: React (Vite), Tailwind CSS, Lucide React (for iconography)
- **Backend**: Node.js, Express, Multer (for handling `multipart/form-data`)
- **Core Processing Engine**: FFmpeg CLI

---

## 3. Environment Setup & Installation

### Prerequisites
1. **Node.js** (v16+)
2. **FFmpeg** installed and accessible in your system's PATH.

### FFmpeg Installation Steps
**Windows:**
1. Download a static build from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) or run `winget install ffmpeg` in PowerShell.
2. Extract the `.zip` file to a permanent folder, e.g., `C:\ffmpeg`.
3. Open Windows Start Menu, search for "Environment Variables", and edit the System Variables.
4. Add `C:\ffmpeg\bin` to your `Path` variable.
5. Verify installation by running `ffmpeg -version` in a new Command Prompt.

**macOS:**
1. Install Homebrew if not already installed: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
2. Run: `brew install ffmpeg`
3. Verify by running `ffmpeg -version` in the Terminal.

**Linux (Ubuntu/Debian):**
1. Run: `sudo apt update && sudo apt install ffmpeg`
2. Verify by running `ffmpeg -version`.

### Dependency Installation
**Backend Setup:**
```bash
cd server
npm install
```

**Frontend Setup:**
```bash
cd client
npm install
```

---

## 4. Step-by-Step Usage Instructions
1. **Start the Backend**: Open a terminal, navigate to the `server/` directory, and run `npm run dev`. The server will listen on port `3001`.
2. **Start the Frontend**: Open a second terminal, navigate to the `client/` directory, and run `npm run dev`.
3. **Open the App**: Navigate to the Vite URL (typically `http://localhost:5173`) in your web browser.
4. **Upload a Video**: Drag and drop a video file into the upload zone or click to select a file. *(Ensure the video is < 1MB).*
5. **Target the Watermark**: Click and drag your mouse over the watermark in the video player to draw a selection box. The application maps your screen coordinates to the intrinsic video pixels.
6. **Execute Processing**: Click the "Run FFmpeg Command" button.
7. **Download Output**: Wait for the processing wheel to hit 100%. Once completed, click "Download Output" to save your clean, watermark-free video.

---

## 5. Folder Structure & Key Files

```text
audio-studio-project-2/
├── client/                     # Frontend React Application
│   ├── src/
│   │   ├── App.jsx             # Core UI, bounding box logic, API integration, and simulation fallback
│   │   ├── index.css           # Tailwind base styles
│   │   └── main.jsx            # React entry point
│   ├── package.json            # Frontend dependencies
│   └── vite.config.js          # Vite configuration
├── server/                     # Backend Node.js Application
│   ├── uploads/                # Temporary directory for video processing (auto-cleaned)
│   ├── server.js               # Express server, Multer upload config, FFmpeg spawning & cleanup hooks
│   └── package.json            # Backend dependencies
└── PRD.md                      # This documentation
```

### Purpose of Important Files
- **`client/src/App.jsx`**: Manages the drag-and-drop file upload, custom bounding box drawing, coordinate scaling mapping (UI bounds to intrinsic video resolution), XHR upload with progress tracking, and fallback simulation logic if the backend is down.
- **`server/server.js`**: Handles CORS, receives uploads via Multer, spawns the child process to scale and remove watermarks using FFmpeg, captures `stderr` logs for debugging, and securely cleans up `input` and `output` files across success, failure, and aborted request states.

---

## 6. FFmpeg Commands & Explanations
The core command generated and executed by the backend is:
```bash
ffmpeg -i <inputPath> -vf "delogo=x=<X>:y=<Y>:w=<W>:h=<H>,scale=1920:-2:flags=lanczos" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a copy <outputPath>
```

**What each flag does:**
- `-i <inputPath>`: Specifies the source video file uploaded by the user.
- `-vf "delogo=...,scale=..."`: Applies a Video Filter chain.
  - `delogo`: A filter that surrounds the specified area (`x`, `y`, `w`, `h`) with a spatial interpolation of the surrounding pixels, visually blurring out the watermark.
  - `scale=1920:-2:flags=lanczos`: Universally scales the video output to 1080p (width `1920`, height auto-calculated to maintain an even aspect ratio `-2`) using the high-quality Lanczos scaling algorithm.
- `-c:v libx264`: Uses the universally compatible H.264 video encoder.
- `-preset fast`: Instructs the encoder to prioritize processing speed over file size compression.
- `-crf 18`: Sets the Constant Rate Factor to 18, ensuring a visually lossless quality output.
- `-pix_fmt yuv420p`: Enforces the pixel format to `yuv420p`, which is absolutely critical for ensuring the video plays natively in web browsers (Safari, Chrome, etc.).
- `-c:a copy`: Copies the original audio stream exactly as is without re-encoding, saving processing time and preserving audio fidelity.
- `<outputPath>`: The generated output file path.

---

## 7. Internal Workflow & API Flow

### 1. Upload & Coordinate Selection (Frontend)
- The user selects a video. The frontend creates a fast, local `URL.createObjectURL(file)` to preview the video instantly without uploading it.
- The user draws a box over the video element.
- The frontend computes intrinsic coordinates `(rx, ry, rw, rh)` by mapping the DOM layout bounds (including letterboxing/black bars from `object-fit: contain`) to the actual `video.videoWidth` and `videoHeight`. The coordinates are strictly clamped so they never exceed the video's physical bounds.

### 2. API Request (Frontend ➔ Backend)
- The user clicks "Run FFmpeg Command".
- The frontend utilizes `XMLHttpRequest` to send the file and bounding box coordinates via `multipart/form-data` to `POST /api/remove-watermark`.
- The `xhr.upload.onprogress` listener tracks byte transfer to display a real-time upload progress percentage in the UI (up to 99%).

### 3. Backend Processing (Node.js/Express)
- `multer` receives the stream and writes it to `server/uploads/input-<uuid>.mp4`.
- Express parses the body parameters `(x, y, w, h)` and strictly sanitizes/validates them as integers to prevent FFmpeg silent crashes.
- `child_process.spawn` invokes the `ffmpeg` command asynchronously.
- The `ffmpegProcess.stderr.on('data')` collects all internal FFmpeg logs for deep terminal debugging and error payload responses.

### 4. File Handling & Auto-Cleanup Logic
- **Success State (`code === 0`)**: The backend initiates `res.download()`. Once the download stream successfully completes to the client, the server executes a guaranteed `fs.unlinkSync` for both the input and output videos.
- **FFmpeg Failure (`code !== 0`)**: The server responds with a `500` status, logs the full FFmpeg `stderr` output to the console, and instantly cleans up both input and output files.
- **Client Disconnect**: If the user closes their browser tab or refreshes while the video is still processing (`req.on('close')`), the server actively traps the event, sends a `SIGKILL` to the FFmpeg process, waits 1 second to release Windows file locks, and forcefully deletes the leftover temporary files to prevent server storage bloat.

### 5. Final Delivery (Frontend)
- The frontend receives the processed `blob`, resolves it to a temporary `blob:` URL, updates the UI state to `result`, and presents the download button to the user.

---

## 8. Error Handling & UI States

- **Validation**: The frontend input field restricts uploads to video MIME types. The backend strictly verifies coordinates presence and integer format.
- **Simulation Fallback UI**: If the Node server is offline (or unreachable), the `catch` block intercepts the network error and triggers a graceful `runSimulation()` method instead of a jarring browser alert. The UI mimics the loading state with a fake progress interval up to 100%, eventually outputting the original unedited video.
- **Loading & Progress UI**: Features an SVG circular progress indicator with a dynamic numeric percentage. It includes a pulsing text status that accurately toggles between "Uploading video... XX%" and "Processing video on backend... (This may take a while)".

---

## 9. Deployment Instructions & Production Considerations

1. **Process Management**: Use [PM2](https://pm2.keymetrics.io/) to run the Express backend (`pm2 start server.js`) to ensure it auto-restarts upon crash or system reboot.
2. **Reverse Proxy**: Use Nginx or Caddy to proxy API requests (e.g., routing `/api` traffic to `localhost:3001`) and to serve the built static React frontend (`npm run build`).
3. **Containerization (Docker)**: If deploying via Docker, ensure you use a base image that has FFmpeg pre-installed (e.g., `linuxserver/ffmpeg` or a standard `node:18` image followed by `RUN apt-get update && apt-get install -y ffmpeg`).
4. **Disk Space Monitoring**: Even with robust cleanup hooks, high traffic or catastrophic crashes might orphan files in `/uploads`. Consider running a chron job or `node-cron` to automatically sweep the `/uploads` directory for files older than 1 hour.
5. **Concurrency & Scaling**: FFmpeg video encoding is incredibly CPU-intensive. For a production release, limit parallel processing using a queue system (like BullMQ + Redis) or deploy horizontal worker nodes to prevent the server from becoming unresponsive under heavy load.
6. **File Size Constraints**: Enforce a strict file size limit in Multer (e.g., `limits: { fileSize: 50 * 1024 * 1024 }` for 50MB) to prevent memory and disk exhaustion.
