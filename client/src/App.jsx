import { useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Crop,
  Crosshair,
  Download,
  FileVideo,
  GitBranch,
  HardDriveUpload,
  LoaderCircle,
  Maximize2,
  Moon,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Scissors,
  ServerOff,
  ShieldCheck,
  Sun,
  UploadCloud,
  WandSparkles,
} from 'lucide-react';

const API_ENDPOINT = 'http://localhost:3001/api/remove-watermark';

const WORKFLOW_STEPS = [
  { id: 'upload', label: 'Upload', icon: UploadCloud },
  { id: 'edit', label: 'Target', icon: Crosshair },
  { id: 'processing', label: 'Render', icon: LoaderCircle },
  { id: 'result', label: 'Export', icon: Download },
];

const OUTPUT_SETTINGS = [
  { label: 'Engine', value: 'FFmpeg delogo', icon: Scissors },
  { label: 'Codec', value: 'H.264 browser safe', icon: ShieldCheck },
  { label: 'Audio', value: 'Original stream', icon: Activity },
];

const formatFileSize = (bytes) => {
  if (!bytes) return 'No file';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Pending';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

const buildCommand = (coords) => {
  if (!coords) return 'Select a video area to prepare the FFmpeg filter.';
  return `ffmpeg -i input.mp4 -vf "delogo=x=${coords.x}:y=${coords.y}:w=${coords.w}:h=${coords.h},scale=1920:-2:flags=lanczos" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a copy output.mp4`;
};

function MetricRow({ icon: Icon, label, value }) {
  return (
    <div className="metric-row">
      <span className="metric-icon">
        <Icon size={17} strokeWidth={2} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkflowRail({ currentStep }) {
  const activeIndex = WORKFLOW_STEPS.findIndex((item) => item.id === currentStep);

  return (
    <div className="workflow-rail" aria-label="Workflow progress">
      {WORKFLOW_STEPS.map((item, index) => {
        const Icon = item.icon;
        const state = index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'idle';

        return (
          <div className={`workflow-step ${state}`} key={item.id}>
            <span className="workflow-step-icon">
              <Icon size={18} strokeWidth={2.2} />
            </span>
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [step, setStep] = useState('upload');
  const [file, setFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [outputUrl, setOutputUrl] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null);

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const simulationTimerRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [selection, setSelection] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [realCoords, setRealCoords] = useState(null);
  const [editorNotice, setEditorNotice] = useState('');

  const [progress, setProgress] = useState(0);
  const [processingText, setProcessingText] = useState('');
  const [isSimulated, setIsSimulated] = useState(false);

  const ffmpegCommand = useMemo(() => buildCommand(realCoords), [realCoords]);

  const fileSummary = useMemo(() => {
    if (!file) {
      return {
        name: 'Waiting for source',
        size: 'No file',
        type: 'Video',
      };
    }

    return {
      name: file.name,
      size: formatFileSize(file.size),
      type: file.type?.replace('video/', '').toUpperCase() || 'Video',
    };
  }, [file]);

  const activeVideoUrl = outputUrl || sourceUrl;
  const hasValidSelection = realCoords && realCoords.w >= 10 && realCoords.h >= 10;

  const clearSimulationTimer = () => {
    if (simulationTimerRef.current) {
      window.clearInterval(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }
  };

  const revokeUrl = (url) => {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  };

  const loadVideoFile = (videoFile) => {
    if (!videoFile?.type?.startsWith('video/')) {
      setEditorNotice('Choose a valid MP4, WebM, or MOV file.');
      return;
    }

    clearSimulationTimer();
    const nextUrl = URL.createObjectURL(videoFile);
    revokeUrl(sourceUrl);
    if (outputUrl && outputUrl !== sourceUrl) revokeUrl(outputUrl);

    setFile(videoFile);
    setSourceUrl(nextUrl);
    setOutputUrl(null);
    setVideoMeta(null);
    setSelection(null);
    setRealCoords(null);
    setEditorNotice('');
    setIsSimulated(false);
    setProgress(0);
    setProcessingText('');
    setIsPlaying(false);
    setStep('edit');
  };

  const handleFileUpload = (event) => {
    loadVideoFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleDrop = (event) => {
    event.preventDefault();
    loadVideoFile(event.dataTransfer.files?.[0]);
  };

  const getRenderedVideoMetrics = () => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return null;

    const rect = container.getBoundingClientRect();
    const videoWidth = video.videoWidth || videoMeta?.width || 0;
    const videoHeight = video.videoHeight || videoMeta?.height || 0;

    if (!videoWidth || !videoHeight || !rect.width || !rect.height) {
      return {
        displayedW: rect.width,
        displayedH: rect.height,
        offsetX: 0,
        offsetY: 0,
        scaleX: 1,
        scaleY: 1,
        videoWidth: rect.width,
        videoHeight: rect.height,
      };
    }

    const videoAspect = videoWidth / videoHeight;
    const containerAspect = rect.width / rect.height;

    let displayedW;
    let displayedH;
    let offsetX = 0;
    let offsetY = 0;

    if (containerAspect > videoAspect) {
      displayedH = rect.height;
      displayedW = rect.height * videoAspect;
      offsetX = (rect.width - displayedW) / 2;
    } else {
      displayedW = rect.width;
      displayedH = rect.width / videoAspect;
      offsetY = (rect.height - displayedH) / 2;
    }

    return {
      displayedW,
      displayedH,
      offsetX,
      offsetY,
      scaleX: videoWidth / displayedW,
      scaleY: videoHeight / displayedH,
      videoWidth,
      videoHeight,
    };
  };

  const getCoordinates = (event) => {
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const clampToVideo = (point) => {
    const metrics = getRenderedVideoMetrics();
    if (!metrics) return point;

    return {
      x: Math.max(metrics.offsetX, Math.min(point.x, metrics.offsetX + metrics.displayedW)),
      y: Math.max(metrics.offsetY, Math.min(point.y, metrics.offsetY + metrics.displayedH)),
    };
  };

  const calculateRealVideoCoordinates = (box) => {
    const metrics = getRenderedVideoMetrics();
    if (!metrics || box.width < 6 || box.height < 6) {
      setRealCoords(null);
      return;
    }

    const x = Math.max(0, Math.round((box.x - metrics.offsetX) * metrics.scaleX));
    const y = Math.max(0, Math.round((box.y - metrics.offsetY) * metrics.scaleY));
    const w = Math.min(metrics.videoWidth - x, Math.max(1, Math.round(box.width * metrics.scaleX)));
    const h = Math.min(metrics.videoHeight - y, Math.max(1, Math.round(box.height * metrics.scaleY)));

    setRealCoords({ x, y, w, h });
    setEditorNotice('');
  };

  const handlePointerDown = (event) => {
    if (step !== 'edit' || !sourceUrl) return;
    event.preventDefault();

    const point = clampToVideo(getCoordinates(event));
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setStartPos(point);
    setIsDrawing(true);
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
    setRealCoords(null);
  };

  const handlePointerMove = (event) => {
    if (!isDrawing || step !== 'edit') return;
    event.preventDefault();

    const current = clampToVideo(getCoordinates(event));
    const nextSelection = {
      x: Math.min(startPos.x, current.x),
      y: Math.min(startPos.y, current.y),
      width: Math.abs(current.x - startPos.x),
      height: Math.abs(current.y - startPos.y),
    };

    setSelection(nextSelection);
    calculateRealVideoCoordinates(nextSelection);
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
  };

  const clearSelection = () => {
    setSelection(null);
    setRealCoords(null);
    setEditorNotice('');
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      return;
    }

    video
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  };

  const runSimulation = () => {
    clearSimulationTimer();
    setIsSimulated(true);
    setStep('processing');
    setProgress(5);
    setProcessingText('Backend unavailable. Preview render is running locally.');

    let currentProgress = 5;
    simulationTimerRef.current = window.setInterval(() => {
      currentProgress += Math.random() * 14 + 7;

      if (currentProgress >= 100) {
        currentProgress = 100;
        clearSimulationTimer();
        setProgress(100);
        setProcessingText('Preview complete.');
        window.setTimeout(() => {
          setOutputUrl(sourceUrl);
          setStep('result');
        }, 450);
        return;
      }

      setProgress(currentProgress);
    }, 420);
  };

  const startProcessing = async () => {
    if (!file || !hasValidSelection) {
      setEditorNotice('Target a watermark area before rendering.');
      return;
    }

    clearSimulationTimer();
    setStep('processing');
    setProgress(0);
    setProcessingText('Preparing secure upload...');
    setIsSimulated(false);

    try {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('x', String(realCoords.x));
      formData.append('y', String(realCoords.y));
      formData.append('w', String(realCoords.w));
      formData.append('h', String(realCoords.h));

      const responseBlob = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', API_ENDPOINT);
        xhr.responseType = 'blob';

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) {
            setProgress(35);
            setProcessingText('Uploading source video...');
            return;
          }

          const percentComplete = (event.loaded / event.total) * 100;
          if (percentComplete < 100) {
            setProgress(percentComplete);
            setProcessingText(`Uploading source video... ${Math.round(percentComplete)}%`);
          } else {
            setProgress(99);
            setProcessingText('Rendering clean output on backend...');
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.response);
            return;
          }

          reject(new Error(`Backend returned status ${xhr.status}`));
        };

        xhr.onerror = () => reject(new Error('Network connection failed.'));
        xhr.send(formData);
      });

      if (outputUrl && outputUrl !== sourceUrl) revokeUrl(outputUrl);
      const finalUrl = URL.createObjectURL(responseBlob);
      setOutputUrl(finalUrl);
      setProgress(100);
      setProcessingText('Output ready.');
      setIsSimulated(false);
      setStep('result');
    } catch (error) {
      console.warn('Backend unavailable, falling back to simulation.', error);
      runSimulation();
    }
  };

  const resetApp = () => {
    clearSimulationTimer();
    revokeUrl(sourceUrl);
    if (outputUrl && outputUrl !== sourceUrl) revokeUrl(outputUrl);

    setStep('upload');
    setFile(null);
    setSourceUrl(null);
    setOutputUrl(null);
    setVideoMeta(null);
    setSelection(null);
    setRealCoords(null);
    setEditorNotice('');
    setProgress(0);
    setProcessingText('');
    setIsSimulated(false);
    setIsPlaying(false);
  };

  return (
    <div className="app-shell" data-theme={isDarkTheme ? 'dark' : 'light'}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <GitBranch size={23} strokeWidth={2.3} />
          </span>
          <span>
            <strong>ClearFrame</strong>
            <small>video-watermark-remover</small>
          </span>
        </div>

        <div className="topbar-actions">
          <button
            className="theme-toggle"
            type="button"
            aria-pressed={isDarkTheme}
            onClick={() => setIsDarkTheme((value) => !value)}
          >
            {isDarkTheme ? <Sun size={17} /> : <Moon size={17} />}
            {isDarkTheme ? 'Light' : 'Dark'}
          </button>
          <span className="connection-pill">
            <span aria-hidden="true" />
            API :3001
          </span>
          {step !== 'upload' && (
            <button className="ghost-button" type="button" onClick={resetApp}>
              <RefreshCw size={17} />
              New Video
            </button>
          )}
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="side-panel left-panel">
          <div className="panel-block">
            <span className="panel-kicker">Workspace</span>
            <WorkflowRail currentStep={step} />
          </div>

          <div className="panel-block">
            <span className="panel-kicker">Source</span>
            <div className="file-identity">
              <span className="file-icon">
                <FileVideo size={21} />
              </span>
              <span>
                <strong>{fileSummary.name}</strong>
                <small>{fileSummary.type}</small>
              </span>
            </div>
            <MetricRow icon={HardDriveUpload} label="Size" value={fileSummary.size} />
            <MetricRow icon={Maximize2} label="Frame" value={videoMeta ? `${videoMeta.width} x ${videoMeta.height}` : 'Pending'} />
            <MetricRow icon={Clock3} label="Length" value={formatDuration(videoMeta?.duration)} />
          </div>

          <div className="panel-block">
            <span className="panel-kicker">Output</span>
            {OUTPUT_SETTINGS.map((item) => (
              <MetricRow key={item.label} {...item} />
            ))}
          </div>
        </aside>

        <section className="main-panel" aria-live="polite">
          {step === 'upload' && (
            <div className="upload-view">
              <div className="upload-copy">
                <span className="eyebrow">
                  <GitBranch size={16} />
                  Repository workspace
                </span>
                <h1>Upload a video to start a clean render.</h1>
                <p>
                  Select a clip, draw a target box over the watermark, and export a processed file through your local FFmpeg action.
                </p>
              </div>

              <label className="upload-dropzone" onDragOver={handleDragOver} onDrop={handleDrop}>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={handleFileUpload}
                />
                <span className="dropzone-icon">
                  <UploadCloud size={31} strokeWidth={2.1} />
                </span>
                <span className="dropzone-content">
                  <strong>Upload source video</strong>
                  <small>Drag and drop a video here, or click to browse from your device.</small>
                </span>
                <div className="upload-specs" aria-hidden="true">
                  <span>MP4</span>
                  <span>WebM</span>
                  <span>MOV</span>
                  <span>local action</span>
                </div>
              </label>
            </div>
          )}

          {step === 'edit' && (
            <div className="editor-view">
              <div className="editor-titlebar">
                <div>
                  <span className="eyebrow">
                    <Crop size={16} />
                    Target area
                  </span>
                  <h2>{file?.name || 'Video editor'}</h2>
                </div>
                <button className="ghost-button" type="button" onClick={clearSelection} disabled={!selection}>
                  <RotateCcw size={17} />
                  Clear
                </button>
              </div>

              <div className="video-stage">
                <div
                  ref={containerRef}
                  className="video-frame"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                >
                  <video
                    ref={videoRef}
                    src={sourceUrl}
                    onEnded={() => setIsPlaying(false)}
                    onPause={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                    onLoadedMetadata={(event) => {
                      setVideoMeta({
                        width: event.currentTarget.videoWidth,
                        height: event.currentTarget.videoHeight,
                        duration: event.currentTarget.duration,
                      });
                      clearSelection();
                    }}
                  />

                  {!selection && (
                    <div className="target-reticle">
                      <Crosshair size={28} />
                      <span>Target watermark</span>
                    </div>
                  )}

                  {selection && selection.width > 0 && (
                    <div
                      className="selection-box"
                      style={{
                        left: `${selection.x}px`,
                        top: `${selection.y}px`,
                        width: `${selection.width}px`,
                        height: `${selection.height}px`,
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="transport-bar">
                <div className="transport-left">
                  <button className="icon-button" type="button" onClick={togglePlay} title={isPlaying ? 'Pause preview' : 'Play preview'}>
                    {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                  </button>
                  <span className="transport-label">{videoMeta ? `${videoMeta.height}p source` : 'Loading source'}</span>
                </div>

                <button className="primary-button" type="button" onClick={startProcessing} disabled={!hasValidSelection}>
                  <WandSparkles size={18} />
                  Render Clean Video
                </button>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="processing-view">
              <div className="progress-ring" style={{ '--progress': `${Math.round(progress)}%` }}>
                <span>{Math.round(progress)}%</span>
              </div>

              <span className="eyebrow">
                <LoaderCircle size={16} />
                Rendering
              </span>
              <h2>{isSimulated ? 'Preview render in progress' : 'Backend render in progress'}</h2>
              <p>{processingText}</p>

              <div className="command-strip">
                <code>{ffmpegCommand}</code>
              </div>
            </div>
          )}

          {step === 'result' && (
            <div className="result-view">
              <div className="result-header">
                <span className={`result-icon ${isSimulated ? 'warning' : 'success'}`}>
                  {isSimulated ? <ServerOff size={26} /> : <CheckCircle2 size={28} />}
                </span>
                <div>
                  <span className="eyebrow">{isSimulated ? 'Preview complete' : 'Export ready'}</span>
                  <h2>{isSimulated ? 'Simulation Complete' : 'Clean Video Ready'}</h2>
                </div>
              </div>

              {isSimulated && (
                <div className="notice-banner warning">
                  <AlertTriangle size={18} />
                  <span>The backend did not respond, so the downloadable file is the original source video.</span>
                </div>
              )}

              <video className="result-video" src={activeVideoUrl} controls />

              <div className="result-actions">
                <a className="primary-button" href={activeVideoUrl} download={`clean_${file?.name || 'video.mp4'}`}>
                  <Download size={18} />
                  Download Output
                </a>
                <button className="ghost-button" type="button" onClick={resetApp}>
                  <RefreshCw size={17} />
                  Start Again
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="side-panel inspector-panel">
          <div className="panel-block">
            <span className="panel-kicker">Selection</span>
            {editorNotice && (
              <div className="notice-banner compact">
                <AlertTriangle size={16} />
                <span>{editorNotice}</span>
              </div>
            )}

            <div className="coords-grid">
              <div>
                <span>X</span>
                <strong>{realCoords?.x ?? '-'}</strong>
              </div>
              <div>
                <span>Y</span>
                <strong>{realCoords?.y ?? '-'}</strong>
              </div>
              <div>
                <span>W</span>
                <strong>{realCoords?.w ?? '-'}</strong>
              </div>
              <div>
                <span>H</span>
                <strong>{realCoords?.h ?? '-'}</strong>
              </div>
            </div>
          </div>

          <div className="panel-block command-panel">
            <span className="panel-kicker">Render Command</span>
            <code>{ffmpegCommand}</code>
          </div>

          <div className="panel-block">
            <span className="panel-kicker">Quality Pass</span>
            <div className="quality-stack">
              <span className={file ? 'ready' : ''}>
                <CheckCircle2 size={15} />
                Source
              </span>
              <span className={hasValidSelection ? 'ready' : ''}>
                <CheckCircle2 size={15} />
                Target
              </span>
              <span className={step === 'result' ? 'ready' : ''}>
                <CheckCircle2 size={15} />
                Export
              </span>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
