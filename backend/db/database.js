const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || './data/spendguard.db';
const resolvedDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(__dirname, '..', dbPath);

// Ensure the directory for the database file exists
const dbDir = path.dirname(resolvedDbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(resolvedDbPath);

// Enforce Foreign Keys (EC-1.10) & WAL mode for performance/safety
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

/**
 * Execute a function within an SQLite transaction block.
 * Automatically rolls back on any error and commits on success (EC-1.10, EC-2.12).
 * @param {Function} fn 
 * @returns {*} Result of fn
 */
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn(...args);
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch (rollbackError) {
        // Rollback failed (e.g., if already rolled back)
      }
      throw error;
    }
  };
};

/**
 * Initialize all database tables and indexes for SpendGuard.
 */
function initDb() {
  db.exec(`
    -- Users Table (Module 1)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

    -- Transactions Table (Modules 2 & 3)
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      original_description TEXT NOT NULL,
      merchant TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      is_expense INTEGER DEFAULT 1,
      needs_review INTEGER DEFAULT 0,
      fingerprint TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_user_fingerprint ON transactions(user_id, fingerprint);
    CREATE INDEX IF NOT EXISTS idx_txn_user_date ON transactions(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_txn_user_category ON transactions(user_id, category);
    CREATE INDEX IF NOT EXISTS idx_txn_user_merchant ON transactions(user_id, merchant);

    -- Recurring Payments Table (Module 4)
    CREATE TABLE IF NOT EXISTS recurring_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      merchant TEXT NOT NULL,
      interval TEXT NOT NULL,
      amount REAL NOT NULL,
      monthly_amount REAL NOT NULL,
      next_expected_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      price_changed INTEGER DEFAULT 0,
      last_payment_date TEXT NOT NULL,
      is_user_created INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_user_merchant ON recurring_payments(user_id, merchant);
    CREATE INDEX IF NOT EXISTS idx_recurring_next_date ON recurring_payments(user_id, next_expected_date);

    -- Alerts Table (Module 6)
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      recurring_payment_id INTEGER NOT NULL,
      renewal_date TEXT NOT NULL,
      message TEXT NOT NULL,
      read_status INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recurring_payment_id) REFERENCES recurring_payments(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_unique_cycle ON alerts(user_id, recurring_payment_id, renewal_date);
    CREATE INDEX IF NOT EXISTS idx_alerts_user_status ON alerts(user_id, read_status);

    -- Merchant Rules Table (Module 3 Optional)
    CREATE TABLE IF NOT EXISTS merchant_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pattern TEXT NOT NULL,
      canonical_merchant TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_rules_user ON merchant_rules(user_id);

    -- Import Batches Table (Module 2 Optional)
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      total_rows INTEGER DEFAULT 0,
      imported_count INTEGER DEFAULT 0,
      duplicate_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_batches_user ON import_batches(user_id);
  `);
}

// Automatically initialize schema
initDb();

module.exports = {
  db,
  initDb
};
