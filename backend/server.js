const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initDb } = require('./db/database');
const authRoutes = require('./routes/auth.routes');
const importRoutes = require('./routes/import.routes');
const transactionRoutes = require('./routes/transaction.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure database schema is initialized
initDb();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
const frontendDir = path.resolve(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/import', importRoutes);
app.use('/api', transactionRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SpendGuard API',
    modules: ['01_authentication', '02_csv_import', '03_merchant_cleaning_and_categories'],
    timestamp: new Date().toISOString()
  });
});

// Root route redirect to frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: `API route not found: ${req.method} ${req.originalUrl}`
  });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Only start listening if not imported by test runner
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🛡️  SpendGuard Server running at http://localhost:${PORT}`);
    console.log(`📁 Frontend serving from: ${frontendDir}`);
    console.log(`🔐 Module 1: Authentication & User Isolation active`);
    console.log(`===============================================`);
  });
}

module.exports = app;
