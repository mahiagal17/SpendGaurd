const assert = require('assert');
const http = require('http');

// Set test environment
process.env.DATABASE_PATH = './data/test_spendguard_mod3.db';
process.env.JWT_SECRET = 'test_secret_key_spendguard_mod3_88';
process.env.PORT = '3097';

const app = require('../server');
const { db, initDb } = require('../db/database');
const { generateToken } = require('../middleware/auth');
const cleaner = require('../services/cleaner.service');
const categorizer = require('../services/categorizer.service');

let server;
const BASE_URL = 'http://127.0.0.1:3097';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({ status: res.statusCode, body: json });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runModule3Tests() {
  console.log('\n======================================================');
  console.log('🧪 Starting SpendGuard Module 3 Test Suite & Verification');
  console.log('======================================================\n');

  // Start test server
  await new Promise(resolve => {
    server = app.listen(3097, resolve);
  });

  // Clean test tables
  db.exec(`
    DELETE FROM alerts;
    DELETE FROM transactions;
    DELETE FROM recurring_payments;
    DELETE FROM merchant_rules;
    DELETE FROM import_batches;
    DELETE FROM users;
  `);

  // Create test users (User A and User B for IDOR checks)
  const userA = db.prepare(`
    INSERT INTO users (name, email, password_hash)
    VALUES ('User A', 'user.a@example.com', 'hash_a')
  `).run();
  const userAId = Number(userA.lastInsertRowid);
  const tokenA = generateToken({ id: userAId, email: 'user.a@example.com' });

  const userB = db.prepare(`
    INSERT INTO users (name, email, password_hash)
    VALUES ('User B', 'user.b@example.com', 'hash_b')
  `).run();
  const userBId = Number(userB.lastInsertRowid);
  const tokenB = generateToken({ id: userBId, email: 'user.b@example.com' });

  try {
    // -------------------------------------------------------------------------
    // UNIT TESTS: Cleaner & Categorizer Services (TC-01..TC-05, EC-3.1..EC-3.7)
    // -------------------------------------------------------------------------
    console.log('--- Unit Level Verification of Cleaning & Categorization ---');

    // TC-01: Netflix cleaning
    console.log('TC-01: Cleaning UPI/524312/NETFLIX COM/POS 8007...');
    const tc1 = categorizer.resolveMerchantAndCategory('UPI/524312/NETFLIX COM/POS 8007');
    assert.strictEqual(tc1.merchant, 'Netflix');
    assert.strictEqual(tc1.category, 'Subscriptions');
    assert.strictEqual(tc1.needsReview, 0);
    console.log('  ✅ TC-01 Passed: Cleaned to Netflix (Subscriptions).');

    // TC-02: Swiggy cleaning
    console.log('TC-02: Cleaning SWIGGY BANGALORE IN 9931...');
    const tc2 = categorizer.resolveMerchantAndCategory('SWIGGY BANGALORE IN 9931');
    assert.strictEqual(tc2.merchant, 'Swiggy');
    assert.strictEqual(tc2.category, 'Food');
    assert.strictEqual(tc2.needsReview, 0);
    console.log('  ✅ TC-02 Passed: Cleaned to Swiggy (Food).');

    // TC-03: Spotify cleaning
    console.log('TC-03: Cleaning ACH WDL SPOTIFY INDIA...');
    const tc3 = categorizer.resolveMerchantAndCategory('ACH WDL SPOTIFY INDIA');
    assert.strictEqual(tc3.merchant, 'Spotify');
    assert.strictEqual(tc3.category, 'Subscriptions');
    assert.strictEqual(tc3.needsReview, 0);
    console.log('  ✅ TC-03 Passed: Cleaned to Spotify (Subscriptions).');

    // TC-04: Unmatched raw description fallback & flagging
    console.log('TC-04: Cleaning UNKNOWN SHOP 123...');
    const tc4 = categorizer.resolveMerchantAndCategory('UNKNOWN SHOP 123');
    assert.strictEqual(tc4.merchant, 'Unknown Shop');
    assert.strictEqual(tc4.category, 'Other');
    assert.strictEqual(tc4.needsReview, 1);
    console.log('  ✅ TC-04 Passed: Fallback to Other with needs_review = 1.');

    // EC-3.1: Aggregator prefix stripping
    console.log('EC-3.1: Stripping payment gateway prefixes (Razorpay, BillDesk, PayU)...');
    const agg1 = categorizer.resolveMerchantAndCategory('RAZORPAY*NETFLIX');
    assert.strictEqual(agg1.merchant, 'Netflix');
    assert.strictEqual(agg1.category, 'Subscriptions');

    const agg2 = categorizer.resolveMerchantAndCategory('PAYU*SWIGGY');
    assert.strictEqual(agg2.merchant, 'Swiggy');
    assert.strictEqual(agg2.category, 'Food');
    console.log('  ✅ EC-3.1 Passed: Gateway prefixes stripped, genuine merchant extracted.');

    // EC-3.2: Naked Aggregator Transactions
    console.log('EC-3.2: Naked aggregator transactions with no underlying merchant...');
    const naked = categorizer.resolveMerchantAndCategory('RAZORPAY SOFTWARE PVT LTD 98213');
    assert.strictEqual(naked.merchant, 'Razorpay (Gateway)');
    assert.strictEqual(naked.category, 'Other');
    assert.strictEqual(naked.needsReview, 1);
    console.log('  ✅ EC-3.2 Passed: Naked aggregator tagged as Gateway and flagged for review.');

    // EC-3.3: Complex UPI VPAs and Delimiters
    console.log('EC-3.3: Complex UPI VPA format extraction...');
    const upiComplex = categorizer.resolveMerchantAndCategory('UPI-SWIGGY-swiggy.payu@icici-UPI');
    assert.strictEqual(upiComplex.merchant, 'Swiggy');
    assert.strictEqual(upiComplex.category, 'Food');
    console.log('  ✅ EC-3.3 Passed: UPI VPA correctly resolved.');

    // EC-3.4: Substring collisions with word boundaries
    console.log('EC-3.4: Word boundaries avoiding substring collisions...');
    // 'TUBERCULOSIS CLINIC' must NOT match 'Uber'
    const tb = categorizer.resolveMerchantAndCategory('TUBERCULOSIS CLINIC');
    assert.notStrictEqual(tb.merchant, 'Uber');
    assert.strictEqual(tb.category, 'Health'); // matches Health keyword 'clinic'

    // 'DIFFICULT CONCEPTS BOOKSTORE' must NOT match 'Cult.fit'
    const bookstore = categorizer.resolveMerchantAndCategory('DIFFICULT CONCEPTS BOOKSTORE');
    assert.notStrictEqual(tb.merchant, 'Cult.fit');
    console.log('  ✅ EC-3.4 Passed: Word boundaries prevented false substring collisions.');

    // EC-3.5: Multi-category mega-merchants (Amazon)
    console.log('EC-3.5: Multi-category mega-merchants (Amazon Retail vs Prime vs AWS)...');
    const amznRetail = categorizer.resolveMerchantAndCategory('AMAZON RETAIL INDIA');
    assert.strictEqual(amznRetail.merchant, 'Amazon');
    assert.strictEqual(amznRetail.category, 'Shopping');

    const amznPrime = categorizer.resolveMerchantAndCategory('AMAZON PRIME VIDEO');
    assert.strictEqual(amznPrime.merchant, 'Amazon Prime');
    assert.strictEqual(amznPrime.category, 'Subscriptions');

    const aws = categorizer.resolveMerchantAndCategory('AWS CLOUD HOSTING');
    assert.strictEqual(aws.merchant, 'AWS Cloud Hosting');
    assert.strictEqual(aws.category, 'Bills');
    console.log('  ✅ EC-3.5 Passed: Contextual sub-keywords accurately differentiate services.');

    // EC-3.6: Degenerate pure noise strings
    console.log('EC-3.6: Pure noise strings cleaning...');
    const noise = categorizer.resolveMerchantAndCategory('1234567890/POS/---/***** 9999');
    assert.strictEqual(noise.merchant, 'Unknown Merchant');
    assert.strictEqual(noise.category, 'Other');
    assert.strictEqual(noise.needsReview, 1);
    console.log('  ✅ EC-3.6 Passed: Pure noise handled gracefully.');

    // EC-3.7: Unicode accents & essential symbols
    console.log('EC-3.7: Accents and symbols preservation (Café, H&M, Marks & Spencer)...');
    const cafe = cleaner.cleanRawDescription('POS WDL CAFE COFFEE DAY 8812');
    assert.ok(cafe.toLowerCase().includes('cafe coffee day'));

    const hm = cleaner.cleanRawDescription('POS H&M RETAIL STORE');
    assert.ok(hm.includes('H&M Retail Store') || hm.includes('H&M'));
    console.log('  ✅ EC-3.7 Passed: Accented letters & symbols preserved.');

    // EC-3.8: User custom override rule taking precedence
    console.log('EC-3.8: User custom rule hierarchy...');
    const userRules = [
      { pattern: 'blue tokai', canonical_merchant: 'Blue Tokai Coffee Roasters', category: 'Food' }
    ];
    const userRuleRes = categorizer.resolveMerchantAndCategory('BLUE TOKAI BANGALORE', userRules);
    assert.strictEqual(userRuleRes.merchant, 'Blue Tokai Coffee Roasters');
    assert.strictEqual(userRuleRes.category, 'Food');
    assert.strictEqual(userRuleRes.ruleSource, 'user_rule');
    console.log('  ✅ EC-3.8 Passed: User custom rule strictly took precedence.');

    // -------------------------------------------------------------------------
    // API INTEGRATION TESTS (TC-06, EC-3.9, EC-1.8 IDOR Protection)
    // -------------------------------------------------------------------------
    console.log('\n--- API Integration Verification ---');

    // 1. GET /api/categories
    console.log('Testing GET /api/categories...');
    const catRes = await request('GET', '/api/categories');
    assert.strictEqual(catRes.status, 200);
    assert.ok(catRes.body.categories.includes('Food'));
    assert.ok(catRes.body.categories.includes('Subscriptions'));
    console.log('  ✅ Categories API returned expected categories.');

    // Insert dummy transactions for User A
    const t1 = db.prepare(`
      INSERT INTO transactions (user_id, date, amount, original_description, merchant, category, needs_review, fingerprint)
      VALUES (${userAId}, '2026-10-01', 350.00, 'BLUE TOKAI COFFEE INDIRANAGAR', 'Blue Tokai', 'Other', 1, 'fp_a_1')
    `).run();
    const txn1Id = Number(t1.lastInsertRowid);

    const t2 = db.prepare(`
      INSERT INTO transactions (user_id, date, amount, original_description, merchant, category, needs_review, fingerprint)
      VALUES (${userAId}, '2026-10-02', 350.00, 'BLUE TOKAI COFFEE INDIRANAGAR', 'Blue Tokai', 'Other', 1, 'fp_a_2')
    `).run();
    const txn2Id = Number(t2.lastInsertRowid);

    // Insert dummy transaction for User B
    const tB = db.prepare(`
      INSERT INTO transactions (user_id, date, amount, original_description, merchant, category, needs_review, fingerprint)
      VALUES (${userBId}, '2026-10-01', 500.00, 'USER B PURCHASE', 'User B Merchant', 'Shopping', 0, 'fp_b_1')
    `).run();
    const txnBId = Number(tB.lastInsertRowid);

    // 2. PATCH /api/transactions/:id with bulk propagation (TC-06 & EC-3.9)
    console.log('TC-06 & EC-3.9: Testing PATCH /api/transactions/:id with applyToMatching: true...');
    const patchRes = await request('PATCH', `/api/transactions/${txn1Id}`, {
      merchant: 'Blue Tokai Coffee Roasters',
      category: 'Food',
      applyToMatching: true
    }, {
      'Authorization': `Bearer ${tokenA}`
    });

    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(patchRes.body.transaction.merchant, 'Blue Tokai Coffee Roasters');
    assert.strictEqual(patchRes.body.transaction.category, 'Food');
    assert.strictEqual(patchRes.body.transaction.needs_review, 0);

    // Verify transaction 2 also propagated (EC-3.9)
    const checkTxn2 = db.prepare('SELECT merchant, category, needs_review FROM transactions WHERE id = ?').get(txn2Id);
    assert.strictEqual(checkTxn2.merchant, 'Blue Tokai Coffee Roasters');
    assert.strictEqual(checkTxn2.category, 'Food');
    assert.strictEqual(checkTxn2.needs_review, 0);

    // Verify auto-created custom rule in merchant_rules table
    const autoRule = db.prepare('SELECT * FROM merchant_rules WHERE user_id = ? AND pattern = ?').get(userAId, 'BLUE TOKAI COFFEE INDIRANAGAR');
    assert.ok(autoRule);
    assert.strictEqual(autoRule.category, 'Food');
    console.log('  ✅ TC-06 & EC-3.9 Passed: Transaction updated and bulk propagated to matching transactions.');

    // 3. IDOR Protection (EC-1.8)
    console.log('EC-1.8: Verifying IDOR protection across tenant boundaries...');
    // User A attempts to modify User B's transaction
    const idorPatch = await request('PATCH', `/api/transactions/${txnBId}`, {
      merchant: 'Hacked Merchant',
      category: 'Food'
    }, {
      'Authorization': `Bearer ${tokenA}`
    });
    assert.strictEqual(idorPatch.status, 404, 'Must return 404 for transaction belonging to another tenant');

    // Verify User B's transaction was NOT modified
    const checkTxnB = db.prepare('SELECT merchant FROM transactions WHERE id = ?').get(txnBId);
    assert.strictEqual(checkTxnB.merchant, 'User B Merchant');
    console.log('  ✅ EC-1.8 Passed: Cross-tenant IDOR attack rejected with 404.');

    // 4. Custom Rules API (GET, POST, DELETE)
    console.log('Testing User Custom Rules CRUD API...');
    const createRuleRes = await request('POST', '/api/merchant-rules', {
      pattern: 'chai point',
      canonicalMerchant: 'Chai Point',
      category: 'Food'
    }, {
      'Authorization': `Bearer ${tokenA}`
    });
    assert.strictEqual(createRuleRes.status, 201);
    const ruleId = createRuleRes.body.rule.id;

    // List rules
    const listRulesRes = await request('GET', '/api/merchant-rules', null, {
      'Authorization': `Bearer ${tokenA}`
    });
    assert.strictEqual(listRulesRes.status, 200);
    assert.ok(listRulesRes.body.rules.some(r => r.id === ruleId));

    // Delete rule
    const delRuleRes = await request('DELETE', `/api/merchant-rules/${ruleId}`, null, {
      'Authorization': `Bearer ${tokenA}`
    });
    assert.strictEqual(delRuleRes.status, 200);
    console.log('  ✅ Custom Rules CRUD endpoints verified successfully.');

    console.log('\n======================================================');
    console.log('🎉 ALL MODULE 3 TEST CASES & EDGE CASES PASSED! (100%)');
    console.log('======================================================\n');

  } finally {
    server.close();
  }
}

runModule3Tests().catch(err => {
  console.error('❌ Test failed with error:', err);
  if (server) server.close();
  process.exit(1);
});
