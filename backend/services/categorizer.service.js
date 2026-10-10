const {
  CANONICAL_MERCHANTS,
  CATEGORY_KEYWORDS,
  NAKED_AGGREGATORS
} = require('../config/merchantRules');
const { cleanRawDescription, toTitleCase } = require('./cleaner.service');

/**
 * Categorize a transaction by evaluating the hierarchy:
 * 1. User Custom Rules (EC-3.8) - Highest Priority
 * 2. Canonical Merchant Dictionary (EC-3.4, EC-3.5)
 * 3. Category Keyword Heuristics
 * 4. Naked Aggregator detection (EC-3.2)
 * 5. Fallback to "Other" with needs_review = 1 (EC-3.6)
 *
 * @param {string} rawDescription 
 * @param {Array} userCustomRules - Array of { pattern, canonical_merchant, category }
 * @returns {object} { merchant, category, needsReview, ruleSource }
 */
function resolveMerchantAndCategory(rawDescription, userCustomRules = []) {
  if (!rawDescription || typeof rawDescription !== 'string') {
    return {
      merchant: 'Unknown Merchant',
      category: 'Other',
      needsReview: 1,
      ruleSource: 'fallback'
    };
  }

  const cleaned = cleanRawDescription(rawDescription);

  // -----------------------------------------------------------------
  // 1. User Custom Override Rules (EC-3.8)
  // User rules have highest priority and supersede global rules
  // -----------------------------------------------------------------
  if (Array.isArray(userCustomRules) && userCustomRules.length > 0) {
    for (const rule of userCustomRules) {
      if (!rule.pattern) continue;
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(rawDescription) || regex.test(cleaned)) {
          return {
            merchant: rule.canonical_merchant || rule.canonicalMerchant,
            category: rule.category,
            needsReview: 0,
            ruleSource: 'user_rule'
          };
        }
      } catch (regexErr) {
        // Fallback to substring matching if pattern isn't a valid regex
        const patLower = rule.pattern.toLowerCase();
        if (rawDescription.toLowerCase().includes(patLower) || cleaned.toLowerCase().includes(patLower)) {
          return {
            merchant: rule.canonical_merchant || rule.canonicalMerchant,
            category: rule.category,
            needsReview: 0,
            ruleSource: 'user_rule'
          };
        }
      }
    }
  }

  // -----------------------------------------------------------------
  // 2. Canonical Merchant Resolution (EC-3.1, EC-3.4, EC-3.5)
  // Test cleaned text and rawDescription with strict word boundaries
  // -----------------------------------------------------------------
  for (const m of CANONICAL_MERCHANTS) {
    if (m.pattern.test(cleaned) || m.pattern.test(rawDescription)) {
      return {
        merchant: m.name,
        category: m.category,
        needsReview: 0,
        ruleSource: 'canonical_dict'
      };
    }
  }

  // -----------------------------------------------------------------
  // 3. Category Keyword Heuristics
  // Match generic business categories if brand is not specifically known
  // -----------------------------------------------------------------
  for (const [category, patterns] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const regex of patterns) {
      if (regex.test(cleaned) || regex.test(rawDescription)) {
        const candidateName = cleaned.length > 0 ? toTitleCase(cleaned) : 'Merchant';
        return {
          merchant: candidateName,
          category,
          needsReview: 0,
          ruleSource: 'category_keyword'
        };
      }
    }
  }

  // -----------------------------------------------------------------
  // 4. Naked Aggregator Detection (EC-3.2)
  // When payment description is purely the gateway with no merchant info
  // -----------------------------------------------------------------
  for (const agg of NAKED_AGGREGATORS) {
    if (agg.pattern.test(cleaned) || agg.pattern.test(rawDescription)) {
      return {
        merchant: agg.name,
        category: 'Other',
        needsReview: 1,
        ruleSource: 'naked_aggregator'
      };
    }
  }

  // -----------------------------------------------------------------
  // 5. Fallback & Review Flag (EC-3.6)
  // If no category matched or string was pure noise
  // -----------------------------------------------------------------
  if (!cleaned || cleaned.length === 0) {
    return {
      merchant: 'Unknown Merchant',
      category: 'Other',
      needsReview: 1,
      ruleSource: 'fallback_empty'
    };
  }

  return {
    merchant: toTitleCase(cleaned),
    category: 'Other',
    needsReview: 1,
    ruleSource: 'fallback'
  };
}

module.exports = {
  resolveMerchantAndCategory
};
