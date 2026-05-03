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

    // The exact filter string based on user coordinates
    const filterString = `delogo=x=${safeX}:y=${safeY}:w=${safeW}:h=${safeH}`;

    console.log(`\n--- RUNNING FFMPEG COMMAND ---`);
    console.log(`ffmpeg -i ${inputPath} -vf "${filterString}" -c:a copy ${outputPath}\n`);

    // Build the FFmpeg command
    const ffmpegArgs = [
        '-y',
        '-i', inputPath,
        '-vf', filterString,
        // Crucial: we still need to enforce video encoding so the browser plays the new file
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
        outputPath
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

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
        // Uncomment the line below if you want to see detailed FFmpeg progress logs in your terminal
        // console.log(`FFmpeg: ${data}`);
    });

    ffmpegProcess.on('close', (code) => {
        if (code !== 0) {
            console.error(`FFmpeg process exited with code ${code}`);
            // Cleanup files on failure
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            if (!res.headersSent) {
                return res.status(500).json({ error: 'Video processing failed.', logs: ffmpegLogs });
            }
            return;
        }

        console.log('Processing complete. Sending file to client...');

        // Send the processed video back to the client
        res.download(outputPath, 'clean_video.mp4', (err) => {
            if (err) console.error('Error sending file:', err);

            // Cleanup files after sending
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        });
    });
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 AI Video Backend running on port ${PORT}`);
    console.log(`   Waiting for video processing requests...`);
    console.log(`========================================\n`);
});