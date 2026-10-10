/**
 * SpendGuard — Predefined Merchant Dictionaries & Category Rules (Module 3)
 * Offline, rule-based canonical resolution and classification.
 */

const CATEGORIES = [
  'Food',
  'Shopping',
  'Entertainment',
  'Bills',
  'Transport',
  'Health',
  'Subscriptions',
  'Other'
];

/**
 * Payment Gateways / Aggregator noise prefixes (EC-3.1)
 */
const AGGREGATOR_PREFIXES = /^(?:razorpay|billdesk|payu|ccavenue|cashfree|paytm|airpay|instamojo|phonepe)[\s*\/_\-:]+/i;

/**
 * Naked Aggregator patterns (EC-3.2)
 */
const NAKED_AGGREGATORS = [
  { pattern: /\brazorpay(?:\s+software|\s+pvt|\s+ltd)?\b/i, name: 'Razorpay (Gateway)' },
  { pattern: /\bbilldesk(?:\s+india|\s+tech)?\b/i, name: 'Billdesk (Gateway)' },
  { pattern: /\bpayu(?:\s+payments|\s+money)?\b/i, name: 'PayU (Gateway)' },
  { pattern: /\bccavenue\b/i, name: 'CCAvenue (Gateway)' },
  { pattern: /\bcashfree(?:\s+payments)?\b/i, name: 'Cashfree (Gateway)' }
];

/**
 * Canonical Merchant Mapping with Word Boundaries (EC-3.4, EC-3.5)
 */
const CANONICAL_MERCHANTS = [
  // 1. Subscriptions & Streaming
  { pattern: /\bnetflix(?:\.com)?\b/i, name: 'Netflix', category: 'Subscriptions' },
  { pattern: /\bspotify(?:\.com)?\b/i, name: 'Spotify', category: 'Subscriptions' },
  { pattern: /\byoutube\s*(?:sub|premium|red)?\b/i, name: 'YouTube Premium', category: 'Subscriptions' },
  { pattern: /\b(?:disney\+?\s*hotstar|hotstar)\b/i, name: 'Disney+ Hotstar', category: 'Subscriptions' },
  { pattern: /\b(?:amazon\s*prime|prime\s*video|amzn\s*prime)\b/i, name: 'Amazon Prime', category: 'Subscriptions' },
  { pattern: /\b(?:apple\s*(?:music|tv|one|services)|itunes(?:\.com)?)\b/i, name: 'Apple Services', category: 'Subscriptions' },
  { pattern: /\b(?:sonyliv|zee5|jiocinema|mx\s*player)\b/i, name: 'Streaming Media', category: 'Subscriptions' },
  { pattern: /\b(?:github|chatgpt|openai|notion|figma|canva|adobe|dropbox)\b/i, name: 'SaaS Software', category: 'Subscriptions' },

  // 2. Food & Dining
  { pattern: /\bswiggy(?:\s*instamart|\s*genie)?\b/i, name: 'Swiggy', category: 'Food' },
  { pattern: /\bzomato(?:\s*gold|\s*pro)?\b/i, name: 'Zomato', category: 'Food' },
  { pattern: /\b(?:blinkit|zepto|dunzo|bbdaily|bigbasket|instamart)\b/i, name: 'Quick Commerce / Grocery', category: 'Food' },
  { pattern: /\b(?:mcdonald'?s|domino'?s|kfc|burger\s*king|subway|pizza\s*hut)\b/i, name: 'Fast Food', category: 'Food' },
  { pattern: /\b(?:starbucks|blue\s*tokai|third\s*wave|chaayos|chai\s*point|cafe\s*coffee\s*day)\b/i, name: 'Cafe & Beverages', category: 'Food' },

  // 3. Transport & Commute (EC-3.4: Strict word boundary avoids 'Tuberculosis')
  { pattern: /\buber(?:\s*trips|\s*india)?\b/i, name: 'Uber', category: 'Transport' },
  { pattern: /\b(?:ola\s*cabs|ola\s*money|rapido|namma\s*yatri)\b/i, name: 'Cab & Auto Services', category: 'Transport' },
  { pattern: /\b(?:irctc|indian\s*railways|makemytrip|redbus|abhibus)\b/i, name: 'Travel & Railway', category: 'Transport' },
  { pattern: /\b(?:indigo|air\s*india|spicejet|vistara|akasa)\b/i, name: 'Airlines', category: 'Transport' },
  { pattern: /\b(?:fastag|iocl|bpcl|hpcl|petrol|fuel\s*pump|shell)\b/i, name: 'Fuel & Fastag', category: 'Transport' },

  // 4. Bills & Utilities (EC-3.5: Multi-category contextual evaluation)
  { pattern: /\b(?:airtel|bharti\s*airtel)(?:\s*broadband|\s*fiber|\s*prepaid|\s*postpaid|\s*bill)?\b/i, name: 'Airtel', category: 'Bills' },
  { pattern: /\b(?:jio|reliance\s*jio)(?:\s*fiber|\s*infocomm|\s*prepaid)?\b/i, name: 'Jio Telecom', category: 'Bills' },
  { pattern: /\b(?:vodafone|vi\s*india|vi\s*bill|bsnl)\b/i, name: 'Telecom & Internet', category: 'Bills' },
  { pattern: /\b(?:bescom|tneb|mseb|cesc|adani\s*electricity|tata\s*power)\b/i, name: 'Electricity Utility', category: 'Bills' },
  { pattern: /\b(?:aws|amazon\s*web\s*services)\b/i, name: 'AWS Cloud Hosting', category: 'Bills' },
  { pattern: /\b(?:google\s*cloud|google\s*workspace)\b/i, name: 'Google Cloud Services', category: 'Bills' },

  // 5. Shopping (EC-3.4, EC-3.5)
  { pattern: /\b(?:amazon|amzn|amazon\s*seller|amazon\s*pay)\b/i, name: 'Amazon', category: 'Shopping' },
  { pattern: /\b(?:flipkart|myntra|ajio|meesho|nykaa|tata\s*cliq|tata\s*neu)\b/i, name: 'E-Commerce Shopping', category: 'Shopping' },
  { pattern: /\b(?:ikea|zara|h&m|decathlon|uniqlo|lifestyle|westside)\b/i, name: 'Retail & Fashion', category: 'Shopping' },

  // 6. Health & Fitness (EC-3.4: Word boundary avoids 'difficult')
  { pattern: /\b(?:cult\.?fit|cure\.?fit|gold'?s\s*gym|anytime\s*fitness)\b/i, name: 'Cult.fit / Fitness', category: 'Health' },
  { pattern: /\b(?:apollo\s*pharmacy|pharmeasy|tata\s*1mg|netmeds|medplus)\b/i, name: 'Pharmacy & Medicines', category: 'Health' },
  { pattern: /\b(?:max\s*healthcare|fortis|manipal|narayana\s*health|dr\s*lal|pathlabs)\b/i, name: 'Healthcare & Diagnostics', category: 'Health' },

  // 7. Entertainment
  { pattern: /\b(?:bookmyshow|pvr|inox|cinepolis|steam|playstation|xbox)\b/i, name: 'Entertainment & Gaming', category: 'Entertainment' }
];

/**
 * Category Keyword Heuristics Dictionary with Word Boundaries (EC-3.4)
 */
const CATEGORY_KEYWORDS = {
  Food: [
    /\b(?:restaurant|cafe|bakery|kitchen|food|dining|bistro|dhabha|sweets|pizzeria|grill|barbeque)\b/i
  ],
  Shopping: [
    /\b(?:retail|supermarket|mart|hypermarket|store|apparel|footwear|jewellers|boutique|cloth)\b/i
  ],
  Transport: [
    /\b(?:fuel|petrol|diesel|gas\s*station|metro|toll|commute|cab|taxi|parking)\b/i
  ],
  Bills: [
    /\b(?:electricity|water\s*board|gas\s*utility|broadband|recharge|dth|cable|postpaid)\b/i
  ],
  Health: [
    /\b(?:hospital|clinic|dental|diagnostic|pharmacy|chemist|pathology|opticals|fitness)\b/i
  ],
  Entertainment: [
    /\b(?:cinema|theatre|movies|multiplex|amusement|gaming|arcade|concert|event)\b/i
  ]
};

module.exports = {
  CATEGORIES,
  AGGREGATOR_PREFIXES,
  NAKED_AGGREGATORS,
  CANONICAL_MERCHANTS,
  CATEGORY_KEYWORDS
};
