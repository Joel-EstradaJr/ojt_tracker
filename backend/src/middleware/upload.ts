// ============================================================
// Multer Upload Middleware
// Stores uploaded files in memory (buffer) for processing.
// ============================================================

import multer from "multer";

// Use in-memory storage so we can access the buffer directly
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    // Only accept CSV files
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed."));
    }
  },
});

export const uploadBackup = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max for ZIP backups
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const isCsv = file.mimetype === "text/csv" || name.endsWith(".csv");
    const isZip = file.mimetype === "application/zip"
      || file.mimetype === "application/x-zip-compressed"
      || name.endsWith(".zip");

    if (isCsv || isZip) {
      cb(null, true);
      return;
    }

    cb(new Error("Only CSV and ZIP files are allowed."));
  },
});
