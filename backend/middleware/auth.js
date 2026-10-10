const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'spendguard_default_secret_key_change_in_prod';

/**
 * Authentication Middleware ensuring request has a valid Bearer JWT.
 * Handles Edge Cases:
 * - EC-1.5: Missing or malformed Authorization header (e.g., 'Bearer null', 'Bearer undefined', missing token)
 * - EC-1.6: Expired JWT tokens (returns TOKEN_EXPIRED code)
 * - EC-1.7: Forged, tampered, or invalid signature tokens
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || typeof authHeader !== 'string') {
    return res.status(401).json({
      error: 'Invalid or missing authentication token',
      code: 'AUTH_REQUIRED'
    });
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({
      error: 'Invalid or missing authentication token format. Expected Bearer <token>',
      code: 'INVALID_HEADER_FORMAT'
    });
  }

  const token = parts[1];

  // Guard against common frontend bugs sending literal 'undefined' or 'null' strings
  if (!token || token === 'undefined' || token === 'null') {
    return res.status(401).json({
      error: 'Invalid or missing authentication token',
      code: 'INVALID_TOKEN'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        error: 'Invalid token payload',
        code: 'INVALID_TOKEN_PAYLOAD'
      });
    }

    req.userId = Number(decoded.userId);
    req.userEmail = decoded.email;
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Your session has expired. Please log in again.',
        code: 'TOKEN_EXPIRED'
      });
    }

    return res.status(401).json({
      error: 'Invalid or forged authentication token',
      code: 'INVALID_SIGNATURE'
    });
  }
}

/**
 * Generate a signed JWT token for a user.
 * @param {object} user - User payload { id, email }
 * @param {string} expiresIn - Token validity duration (default: 7d)
 * @returns {string} Signed JWT
 */
function generateToken(user, expiresIn = '7d') {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn }
  );
}

module.exports = {
  requireAuth,
  generateToken,
  JWT_SECRET
};
