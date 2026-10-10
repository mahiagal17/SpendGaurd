const { db } = require('../db/database');
const { CATEGORIES } = require('../config/merchantRules');

/**
 * Get available predefined categories
 * GET /api/categories
 */
function getCategories(req, res) {
  return res.status(200).json({ categories: CATEGORIES });
}

/**
 * Get paginated list of transactions with filtering and search
 * GET /api/transactions
 */
function getTransactions(req, res) {
  try {
    const userId = req.userId;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const search = (req.query.search || '').trim();
    const category = (req.query.category || '').trim();
    const needsReview = req.query.needsReview;
    const startDate = (req.query.startDate || '').trim();
    const endDate = (req.query.endDate || '').trim();

    const conditions = ['user_id = ?'];
    const params = [userId];

    // Search query with SQL wildcard escaping (EC-5.7)
    if (search) {
      const sanitized = search.replace(/[%_\\]/g, '\\$&');
      conditions.push('(merchant LIKE ? ESCAPE "\\" OR original_description LIKE ? ESCAPE "\\")');
      params.push(`%${sanitized}%`, `%${sanitized}%`);
    }

    // Category filter
    if (category && category !== 'All') {
      conditions.push('category = ?');
      params.push(category);
    }

    // Needs review filter
    if (needsReview === '1' || needsReview === 'true') {
      conditions.push('needs_review = 1');
    }

    // Date range filter
    if (startDate) {
      conditions.push('date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('date <= ?');
      params.push(endDate);
    }

    const whereClause = conditions.join(' AND ');

    // Total count for pagination
    const countRow = db.prepare(`SELECT COUNT(*) as total FROM transactions WHERE ${whereClause}`).get(...params);
    const total = countRow ? countRow.total : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    // Fetch transactions
    const transactions = db.prepare(`
      SELECT id, date, amount, original_description, merchant, category, needs_review, created_at
      FROM transactions
      WHERE ${whereClause}
      ORDER BY date DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return res.status(200).json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });

  } catch (error) {
    console.error('Get transactions error:', error);
    return res.status(500).json({ error: 'Failed to retrieve transactions' });
  }
}

/**
 * Update transaction merchant or category with optional bulk propagation (EC-1.8, EC-3.9)
 * PATCH /api/transactions/:id
 */
function updateTransaction(req, res) {
  try {
    const userId = req.userId;
    const txnId = parseInt(req.params.id, 10);
    const { merchant, category, applyToMatching, createRule } = req.body || {};

    if (isNaN(txnId)) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    // IDOR Protection: verify transaction belongs to this user (EC-1.8)
    const existing = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(txnId, userId);
    if (!existing) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const newMerchant = (merchant !== undefined && merchant !== null ? String(merchant).trim() : existing.merchant);
    const newCategory = (category && CATEGORIES.includes(category) ? category : existing.category);

    // Update single transaction inside transaction block
    const updateTx = db.transaction(() => {
      db.prepare(`
        UPDATE transactions
        SET merchant = ?, category = ?, needs_review = 0
        WHERE id = ? AND user_id = ?
      `).run(newMerchant, newCategory, txnId, userId);

      // Bulk re-categorization propagation (EC-3.9)
      if (applyToMatching) {
        db.prepare(`
          UPDATE transactions
          SET merchant = ?, category = ?, needs_review = 0
          WHERE user_id = ? AND original_description = ?
        `).run(newMerchant, newCategory, userId, existing.original_description);
      }

      // Automatically create or update custom rule if requested (EC-3.8)
      if (createRule || applyToMatching) {
        // Check if rule already exists for this pattern
        const existingRule = db.prepare(`
          SELECT id FROM merchant_rules
          WHERE user_id = ? AND pattern = ?
        `).get(userId, existing.original_description);

        if (existingRule) {
          db.prepare(`
            UPDATE merchant_rules
            SET canonical_merchant = ?, category = ?
            WHERE id = ? AND user_id = ?
          `).run(newMerchant, newCategory, existingRule.id, userId);
        } else {
          db.prepare(`
            INSERT INTO merchant_rules (user_id, pattern, canonical_merchant, category)
            VALUES (?, ?, ?, ?)
          `).run(userId, existing.original_description, newMerchant, newCategory);
        }
      }
    });

    updateTx();

    const updated = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(txnId, userId);

    return res.status(200).json({
      message: 'Transaction updated successfully',
      transaction: updated
    });

  } catch (error) {
    console.error('Update transaction error:', error);
    return res.status(500).json({ error: 'Failed to update transaction' });
  }
}

/**
 * Get user custom merchant rules
 * GET /api/merchant-rules
 */
function getMerchantRules(req, res) {
  try {
    const userId = req.userId;
    const rules = db.prepare(`
      SELECT id, pattern, canonical_merchant, category, created_at
      FROM merchant_rules
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId);

    return res.status(200).json({ rules });
  } catch (error) {
    console.error('Get rules error:', error);
    return res.status(500).json({ error: 'Failed to retrieve merchant rules' });
  }
}

/**
 * Create a user custom merchant rule (EC-3.8)
 * POST /api/merchant-rules
 */
function createMerchantRule(req, res) {
  try {
    const userId = req.userId;
    const { pattern, canonicalMerchant, category } = req.body || {};

    if (!pattern || typeof pattern !== 'string' || !pattern.trim()) {
      return res.status(400).json({ error: 'Match pattern is required' });
    }
    if (!canonicalMerchant || typeof canonicalMerchant !== 'string' || !canonicalMerchant.trim()) {
      return res.status(400).json({ error: 'Canonical merchant name is required' });
    }
    if (!category || !CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Valid category is required. Supported: ${CATEGORIES.join(', ')}` });
    }

    const cleanPattern = pattern.trim();
    const cleanMerchant = canonicalMerchant.trim();

    const result = db.prepare(`
      INSERT INTO merchant_rules (user_id, pattern, canonical_merchant, category)
      VALUES (?, ?, ?, ?)
    `).run(userId, cleanPattern, cleanMerchant, category);

    const rule = db.prepare('SELECT * FROM merchant_rules WHERE id = ?').get(result.lastInsertRowid);

    return res.status(201).json({
      message: 'Custom merchant rule created successfully',
      rule
    });

  } catch (error) {
    console.error('Create rule error:', error);
    return res.status(500).json({ error: 'Failed to create merchant rule' });
  }
}

/**
 * Delete a user custom merchant rule (EC-1.8 IDOR Protection)
 * DELETE /api/merchant-rules/:id
 */
function deleteMerchantRule(req, res) {
  try {
    const userId = req.userId;
    const ruleId = parseInt(req.params.id, 10);

    if (isNaN(ruleId)) {
      return res.status(400).json({ error: 'Invalid rule ID' });
    }

    const result = db.prepare(`
      DELETE FROM merchant_rules
      WHERE id = ? AND user_id = ?
    `).run(ruleId, userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    return res.status(200).json({ message: 'Rule successfully deleted' });

  } catch (error) {
    console.error('Delete rule error:', error);
    return res.status(500).json({ error: 'Failed to delete rule' });
  }
}

module.exports = {
  getCategories,
  getTransactions,
  updateTransaction,
  getMerchantRules,
  createMerchantRule,
  deleteMerchantRule
};
