const express = require('express');
const multer = require('multer');
const router = express.Router();
const importController = require('../controllers/import.controller');
const { requireAuth } = require('../middleware/auth');

// Multer in-memory storage for handling up to 10MB CSV uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Verify file is CSV or text
    const isCsv = file.mimetype === 'text/csv' || 
                  file.mimetype === 'application/vnd.ms-excel' ||
                  file.mimetype === 'text/plain' ||
                  file.originalname.toLowerCase().endsWith('.csv');
    if (isCsv) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv files are supported'));
    }
  }
});

// Import endpoints (All protected by requireAuth)
router.post('/preview', requireAuth, upload.single('file'), importController.preview);
router.post('/process', requireAuth, upload.single('file'), importController.processImport);
router.get('/history', requireAuth, importController.getHistory);

module.exports = router;
