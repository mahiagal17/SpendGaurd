const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { generateToken } = require('../middleware/auth');

// RFC-5322 Compliant Email Regex supporting plus-addressing (EC-1.2)
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Validate and normalize email string.
 * Mitigates EC-1.1 (casing & whitespace) and EC-1.2 (plus-addressing & RFC-5322).
 */
function normalizeAndValidateEmail(rawEmail) {
  if (!rawEmail || typeof rawEmail !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  const normalized = rawEmail.trim().toLowerCase();

  if (normalized.length === 0) {
    return { valid: false, error: 'Email cannot be empty' };
  }

  if (normalized.length > 254) {
    return { valid: false, error: 'Email address exceeds maximum length' };
  }

  if (normalized.includes('..')) {
    return { valid: false, error: 'Email contains consecutive dots' };
  }

  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, error: 'Please enter a valid email address' };
  }

  return { valid: true, email: normalized };
}

/**
 * Validate password requirements.
 * Mitigates EC-1.3 (bcrypt 72-byte truncation) and EC-1.4 (whitespace-only).
 */
function validatePassword(rawPassword) {
  if (!rawPassword || typeof rawPassword !== 'string') {
    return { valid: false, error: 'Password is required' };
  }

  // EC-1.4: Disallow whitespace-only passwords
  const trimmed = rawPassword.trim();
  if (trimmed.length < 6) {
    return { valid: false, error: 'Password must be at least 6 non-whitespace characters' };
  }

  // EC-1.3: Bcrypt truncates at 72 bytes; enforce safe max character limit
  if (rawPassword.length > 72) {
    return { valid: false, error: 'Password cannot exceed 72 characters' };
  }

  return { valid: true, password: rawPassword };
}

/**
 * Register a new user account.
 * POST /api/auth/register
 */
async function register(req, res) {
  try {
    const { name, email, password } = req.body || {};

    // Validate Name
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({
        error: 'Full name is required and must be at least 2 characters'
      });
    }
    const cleanName = name.trim();

    // Validate & Normalize Email (EC-1.1, EC-1.2)
    const emailResult = normalizeAndValidateEmail(email);
    if (!emailResult.valid) {
      return res.status(400).json({ error: emailResult.error });
    }
    const cleanEmail = emailResult.email;

    // Validate Password (EC-1.3, EC-1.4)
    const passwordResult = validatePassword(password);
    if (!passwordResult.valid) {
      return res.status(400).json({ error: passwordResult.error });
    }

    // Pre-check for existing email
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(409).json({
        error: 'An account with this email already exists'
      });
    }

    // Hash password with bcryptjs salt factor 10
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(passwordResult.password, salt);

    // Insert user into SQLite database
    let insertResult;
    try {
      const insertStmt = db.prepare(`
        INSERT INTO users (name, email, password_hash)
        VALUES (?, ?, ?)
      `);
      insertResult = insertStmt.run(cleanName, cleanEmail, passwordHash);
    } catch (dbErr) {
      // EC-1.9: Race condition handling on concurrent duplicate registration
      const errMsg = dbErr.message || '';
      if (errMsg.includes('UNIQUE constraint') || dbErr.code === 'ERR_SQLITE_ERROR') {
        return res.status(409).json({
          error: 'An account with this email already exists'
        });
      }
      throw dbErr;
    }

    const userId = Number(insertResult.lastInsertRowid);
    const newUser = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(userId);

    // Generate JWT
    const token = generateToken({ id: userId, email: cleanEmail });

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        createdAt: newUser.created_at
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      error: 'An unexpected internal error occurred during registration'
    });
  }
}

/**
 * Authenticate existing user credentials.
 * POST /api/auth/login
 */
async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    // Validate & Normalize Email (EC-1.1)
    const emailResult = normalizeAndValidateEmail(email);
    if (!emailResult.valid) {
      return res.status(400).json({ error: emailResult.error });
    }
    const cleanEmail = emailResult.email;

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Fetch user by normalized email
    const user = db.prepare('SELECT id, name, email, password_hash, created_at FROM users WHERE email = ?').get(cleanEmail);

    // Generic error to prevent email enumeration (TC-05)
    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    // Generate JWT
    const token = generateToken({ id: user.id, email: user.email });

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      error: 'An unexpected internal error occurred during login'
    });
  }
}

/**
 * Fetch currently authenticated user session.
 * GET /api/auth/me
 */
async function getMe(req, res) {
  try {
    // EC-1.8: Data strictly scoped to req.userId
    const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.userId);

    if (!user) {
      return res.status(404).json({
        error: 'User account not found'
      });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('GetMe error:', error);
    return res.status(500).json({
      error: 'Failed to retrieve user profile'
    });
  }
}

/**
 * Delete current user account and cascade delete all associated data.
 * DELETE /api/auth/me (EC-1.10)
 */
async function deleteAccount(req, res) {
  try {
    const { password } = req.body || {};

    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        error: 'Password confirmation is required to delete your account'
      });
    }

    const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Incorrect password. Account deletion aborted.'
      });
    }

    // Execute deletion inside an atomic transaction (EC-1.10)
    const deleteTx = db.transaction(() => {
      // PRAGMA foreign_keys = ON ensures child rows in transactions, recurring_payments, alerts, etc. cascade delete
      db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
    });

    deleteTx();

    return res.status(200).json({
      message: 'Account and all associated financial data have been permanently deleted'
    });
  } catch (error) {
    console.error('Account deletion error:', error);
    return res.status(500).json({
      error: 'Failed to delete account. Please try again.'
    });
  }
}

module.exports = {
  register,
  login,
  getMe,
  deleteAccount,
  normalizeAndValidateEmail,
  validatePassword
};
