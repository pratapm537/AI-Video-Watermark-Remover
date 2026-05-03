/**
 * AI Video Watermark Remover - Node.js Backend
 * * Prerequisites to run this locally:
 * 1. Install Node.js
 * 2. Install FFmpeg on your operating system (must be available in your system's PATH)
 * 3. Run: npm init -y
 * 4. Run: npm install express multer cors
 * 5. Run: node server.js
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 3001;

// Enable CORS so the React frontend can communicate with this API
app.use(cors());

// Configure Multer for handling file uploads (temporarily saving to an 'uploads' directory)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // Generate a unique filename
        const uniqueSuffix = crypto.randomBytes(8).toString('hex');
        cb(null, `input-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage });

// API Route: Remove Watermark
app.post('/api/remove-watermark', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file provided.' });
    }

    // Extract coordinates and dimensions from the request body
    const { x, y, w, h } = req.body;

    if (x === undefined || y === undefined || w === undefined || h === undefined) {
        // Cleanup uploaded file if parameters are missing
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Missing crop coordinates (x, y, w, h).' });
    }

    // Ensure they are strict integers to prevent FFmpeg silent failures
    const safeX = Math.max(0, Math.round(Number(x)));
    const safeY = Math.max(0, Math.round(Number(y)));
    const safeW = Math.max(1, Math.round(Number(w)));
    const safeH = Math.max(1, Math.round(Number(h)));

    if (isNaN(safeX) || isNaN(safeY) || isNaN(safeW) || isNaN(safeH)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid coordinate format. Expected numbers.' });
    }

    const inputPath = req.file.path;
    const outputPath = path.join(uploadDir, `output-${crypto.randomBytes(8).toString('hex')}.mp4`);

    // Combine delogo and universal 1080p (1K) scaling.
    // 'scale=1920:-2:flags=lanczos' does a high-quality 1080p scale using your CPU.
    const filterString = `delogo=x=${safeX}:y=${safeY}:w=${safeW}:h=${safeH},scale=1920:-2:flags=lanczos`;

    console.log(`\n--- RUNNING FFMPEG COMMAND ---`);
    console.log(`ffmpeg -i ${inputPath} -vf "${filterString}" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a copy ${outputPath}\n`);

    // Build the FFmpeg command
    const ffmpegArgs = [
        '-y',
        '-i', inputPath,
        '-vf', filterString,
        '-c:v', 'libx264',    // Universal high-compatibility encoder
        '-preset', 'fast',    // Good balance of speed and quality
        '-crf', '18',         // Visually lossless quality
        '-pix_fmt', 'yuv420p',// Crucial: ensures the video plays in web browsers
        '-c:a', 'copy',       // Crucial: keeps the original audio intact
        outputPath
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    // CRITICAL: Handle early client disconnect (user closes tab or cancels during processing)
    req.on('close', () => {
        if (!res.writableEnded) {
            console.log('\n⚠️ Client disconnected early. Terminating process and cleaning up...');
            ffmpegProcess.kill('SIGKILL');
            // Slight delay to ensure FFmpeg releases the file locks before deleting
            setTimeout(() => {
                try {
                    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                    console.log('🗑️  Cleaned up files from aborted request.');
                } catch (e) {
                    console.error('Failed to clean up aborted files:', e);
                }
            }, 1000);
        }
    });

    ffmpegProcess.on('error', (err) => {
        console.error('Failed to start FFmpeg process:', err);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'FFmpeg is not installed or not found in system PATH.' });
        }
    });

    let ffmpegLogs = '';
    ffmpegProcess.stderr.on('data', (data) => {
        ffmpegLogs += data.toString();
        // Uncomment to see live processing percentages in terminal
        // console.log(data.toString());
    });

    ffmpegProcess.on('close', (code) => {
        if (code !== 0) {
            console.error(`\n❌ FFMPEG ERROR: Process exited with code ${code}`);
            console.error(`--- FFMPEG LOGS START ---\n${ffmpegLogs}\n--- FFMPEG LOGS END ---`);
            // Cleanup files on failure
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            if (!res.headersSent) {
                return res.status(500).json({ error: 'Video processing failed. Check terminal for logs.' });
            }
            return;
        }

        console.log('Processing complete. Sending file to client...');

        // Send the processed video back to the client
        res.download(outputPath, 'clean_video.mp4', (err) => {
            if (err) {
                console.error('Error sending file to client:', err);
            } else {
                console.log('✅ File successfully downloaded by client.');
            }

            // GUARANTEED CLEANUP: Executes immediately after the stream ends or fails
            try {
                if (fs.existsSync(inputPath)) {
                    fs.unlinkSync(inputPath);
                    console.log('🗑️  Deleted uploaded source video.');
                }
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                    console.log('🗑️  Deleted generated output video.');
                }
            } catch (cleanupErr) {
                console.error('❌ Failed to clean up files (they might be locked by another process):', cleanupErr);
            }
        });
    });
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 AI Video Backend running on port ${PORT}`);
    console.log(`   Waiting for video processing requests...`);
    console.log(`========================================\n`);
});