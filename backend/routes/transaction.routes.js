const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transaction.controller');
const { requireAuth } = require('../middleware/auth');

// Public category list
router.get('/categories', transactionController.getCategories);

// Protected transaction routes
router.get('/transactions', requireAuth, transactionController.getTransactions);
router.patch('/transactions/:id', requireAuth, transactionController.updateTransaction);

// Protected custom merchant rules routes
router.get('/merchant-rules', requireAuth, transactionController.getMerchantRules);
router.post('/merchant-rules', requireAuth, transactionController.createMerchantRule);
router.delete('/merchant-rules/:id', requireAuth, transactionController.deleteMerchantRule);

module.exports = router;
