const { AGGREGATOR_PREFIXES } = require('../config/merchantRules');

/**
 * Noise channel acronyms and banking prefixes to remove
 */
const BANK_NOISE_TOKENS = /\b(?:upi|pos|neft|imps|rtgs|ach|atm|inb|bil|ecom|wdl|txn|ref|chq|trf|dr|cr|inf|cms)\b/gi;

/**
 * Common Indian bank handle suffixes in UPI VPAs (EC-3.3)
 */
const UPI_HANDLE_SUFFIX = /@(?:okaxis|oksbi|okhdfcbank|okicici|paytm|ybl|ibl|apl|axl|upi)\b/gi;

/**
 * Clean raw bank statement descriptions.
 * Handles:
 * - Stripping aggregator prefixes (EC-3.1)
 * - Complex UPI VPAs and references (EC-3.3)
 * - Preserving Latin accents and symbols like &, -, ' (EC-3.7)
 * - Degenerate empty noise strings (EC-3.6)
 * 
 * @param {string} rawDescription
 * @returns {string} Cleaned candidate merchant string
 */
function cleanRawDescription(rawDescription) {
  if (!rawDescription || typeof rawDescription !== 'string') {
    return '';
  }

  let text = rawDescription.trim();

  // 1. Strip Aggregator Prefixes (EC-3.1)
  // e.g., 'RAZORPAY*NETFLIX' -> 'NETFLIX'
  // e.g., 'PAYU*SWIGGY' -> 'SWIGGY'
  text = text.replace(AGGREGATOR_PREFIXES, '');

  // 2. Parse UPI VPA and Slash Delimited formats (EC-3.3)
  // e.g., 'UPI/524312/NETFLIX COM/POS 8007' or 'UPI-SWIGGY-swiggy.payu@icici-UPI'
  if (/^upi[\/-]/i.test(text)) {
    // If slash delimited (e.g., UPI/12345/NETFLIX/...)
    const slashParts = text.split('/').map(p => p.trim()).filter(Boolean);
    if (slashParts.length > 2) {
      // Find candidate part that isn't purely numbers or 'UPI'
      const candidate = slashParts.find(p => !/^\d+$/.test(p) && !/^upi$/i.test(p) && p.length > 2);
      if (candidate) {
        text = candidate;
      }
    } else {
      // If hyphen delimited (e.g., UPI-SWIGGY-swiggy.payu@icici-UPI)
      const dashParts = text.split('-').map(p => p.trim()).filter(Boolean);
      if (dashParts.length > 1) {
        const candidate = dashParts.find(p => !/^\d+$/.test(p) && !/^upi$/i.test(p) && !p.includes('@') && p.length > 2);
        if (candidate) {
          text = candidate;
        }
      }
    }
  }

  // Strip UPI VPA handles (e.g., 'swiggy.payu@icici')
  text = text.replace(UPI_HANDLE_SUFFIX, '');

  // 3. Strip Bank Channel Noise Acronyms
  text = text.replace(BANK_NOISE_TOKENS, ' ');

  // 4. Strip long reference sequences, card maskings, and standalone digits
  text = text.replace(/\b(?:xx|\*{2,})\d+\b/gi, ' ');
  text = text.replace(/(?<!-)\b\d+\b(?!-)/g, ' '); // Strip standalone sequence digits and terminal numbers

  // 5. Retain valid alphanumeric characters, latin accents, and symbols &, -, ' (EC-3.7)
  // Replace slashes, pipes, asterisks, hashes, and other punctuation with space
  text = text.replace(/[/\\|*#@~_+=;:<>^!?[\](){}]/g, ' ');

  // 6. Collapse multiple whitespace and trim
  text = text.replace(/\s+/g, ' ').trim();

  // 7. If text contains no alphanumeric characters or latin letters, it is pure noise (EC-3.6)
  if (!/[a-zA-Z0-9\u00C0-\u024F]/.test(text)) {
    return '';
  }

  return text;
}

/**
 * Format a string to clean Title Case.
 */
function toTitleCase(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

module.exports = {
  cleanRawDescription,
  toTitleCase
};
