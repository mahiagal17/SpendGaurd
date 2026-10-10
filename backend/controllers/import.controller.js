const { db } = require('../db/database');
const csvParser = require('../services/csvParser.service');
const categorizer = require('../services/categorizer.service');

/**
 * Preview uploaded CSV file and suggest column mappings
 * POST /api/import/preview
 */
async function preview(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Please upload a valid .csv file' });
    }

    const fileContent = req.file.buffer.toString('utf8');
    const previewData = csvParser.previewCsv(fileContent);

    return res.status(200).json({
      filename: req.file.originalname,
      ...previewData
    });
  } catch (error) {
    console.error('CSV Preview Error:', error);
    return res.status(400).json({
      error: error.message || 'Failed to parse CSV preview'
    });
  }
}

/**
 * Process and commit CSV file into SQLite transactions table
 * POST /api/import/process
 */
async function processImport(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Please upload a valid .csv file to process' });
    }

    const userId = req.userId;
    const fileContent = req.file.buffer.toString('utf8');
    const filename = req.file.originalname || 'statement.csv';

    // Parse options from body
    let columnMapping = null;
    if (req.body.columnMapping) {
      try {
        columnMapping = typeof req.body.columnMapping === 'string'
          ? JSON.parse(req.body.columnMapping)
          : req.body.columnMapping;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid columnMapping JSON payload' });
      }
    }

    const dateFormat = req.body.dateFormat || 'DD/MM/YYYY';

    // Process all CSV rows
    const parseResult = csvParser.processCsv(fileContent, {
      columnMapping,
      dateFormat
    });

    const { validTransactions, errorRows, skippedCreditsCount, skippedZeroCount } = parseResult;

    let importedCount = 0;
    let duplicateCount = 0;
    let batchId = null;

    // Load user's custom rules for cleaning & categorization (EC-3.8)
    const userRules = db.prepare('SELECT pattern, canonical_merchant, category FROM merchant_rules WHERE user_id = ?').all(userId);

    // Execute database operations in an atomic transaction block (EC-2.12)
    const runImportTransaction = db.transaction(() => {
      const checkStmt = db.prepare('SELECT id FROM transactions WHERE user_id = ? AND fingerprint = ?');
      const insertStmt = db.prepare(`
        INSERT INTO transactions (
          user_id, date, amount, original_description, merchant, category, is_expense, needs_review, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);

      for (const txn of validTransactions) {
        const fingerprint = csvParser.generateFingerprint(
          userId,
          txn.date,
          txn.amount,
          txn.originalDescription,
          txn.occurrenceIndex
        );

        // Check for deduplication
        const existing = checkStmt.get(userId, fingerprint);
        if (existing) {
          duplicateCount++;
          continue;
        }

        // Clean merchant and categorize via Module 3 pipeline
        const resolved = categorizer.resolveMerchantAndCategory(txn.originalDescription, userRules);

        insertStmt.run(
          userId,
          txn.date,
          txn.amount,
          txn.originalDescription,
          resolved.merchant,
          resolved.category,
          resolved.needsReview,
          fingerprint
        );

        importedCount++;
      }

      // Record batch metadata in import_batches table
      const batchStmt = db.prepare(`
        INSERT INTO import_batches (
          user_id, filename, total_rows, imported_count, duplicate_count, error_count
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const batchResult = batchStmt.run(
        userId,
        filename,
        validTransactions.length + errorRows.length,
        importedCount,
        duplicateCount,
        errorRows.length
      );

      batchId = Number(batchResult.lastInsertRowid);
    });

    // Execute atomic transaction
    runImportTransaction();

    return res.status(200).json({
      message: 'CSV import processed successfully',
      batchId,
      summary: {
        total: validTransactions.length + errorRows.length,
        imported: importedCount,
        duplicates: duplicateCount,
        skippedCredits: skippedCreditsCount,
        skippedZero: skippedZeroCount,
        errors: errorRows.length
      },
      errorRows
    });

  } catch (error) {
    console.error('CSV Process Error:', error);
    return res.status(500).json({
      error: 'An unexpected error occurred during CSV import',
      details: error.message
    });
  }
}

/**
 * Get user's import history logs
 * GET /api/import/history
 */
async function getHistory(req, res) {
  try {
    const userId = req.userId;
    const limit = parseInt(req.query.limit, 10) || 20;

    const batches = db.prepare(`
      SELECT id, filename, total_rows, imported_count, duplicate_count, error_count, created_at
      FROM import_batches
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit);

    return res.status(200).json({ batches });
  } catch (error) {
    console.error('Import History Error:', error);
    return res.status(500).json({ error: 'Failed to retrieve import history' });
  }
}

module.exports = {
  preview,
  processImport,
  getHistory
};
