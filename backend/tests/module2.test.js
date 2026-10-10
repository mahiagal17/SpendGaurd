const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Set test environment
process.env.DATABASE_PATH = './data/test_spendguard_mod2.db';
process.env.JWT_SECRET = 'test_secret_key_spendguard_mod2_99';
process.env.PORT = '3098';

const app = require('../server');
const { db, initDb } = require('../db/database');
const { generateToken } = require('../middleware/auth');
const csvParser = require('../services/csvParser.service');

let server;
const BASE_URL = 'http://127.0.0.1:3098';

function multipartUpload(token, endpoint, filename, fileContent, fields = {}) {
  return new Promise((resolve, reject) => {
    const boundary = '----SpendGuardBoundary' + Math.random().toString(36).substring(2);
    let body = '';

    // Append extra fields (e.g. columnMapping, dateFormat)
    for (const [key, val] of Object.entries(fields)) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
      body += `${val}\r\n`;
    }

    // Append file part
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
    body += `Content-Type: text/csv\r\n\r\n`;
    body += fileContent;
    body += `\r\n--${boundary}--\r\n`;

    const bodyBuffer = Buffer.from(body, 'utf8');

    const options = {
      method: 'POST',
      hostname: '127.0.0.1',
      port: 3098,
      path: endpoint,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length
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
    req.write(bodyBuffer);
    req.end();
  });
}

function getRequest(token, endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      hostname: '127.0.0.1',
      port: 3098,
      path: endpoint,
      headers: {
        'Authorization': `Bearer ${token}`
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
    req.end();
  });
}

async function runModule2Tests() {
  console.log('\n======================================================');
  console.log('🧪 Starting SpendGuard Module 2 Test Suite & Verification');
  console.log('======================================================\n');

  // Start test server
  await new Promise(resolve => {
    server = app.listen(3098, resolve);
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

  // Create test user
  const userInsert = db.prepare(`
    INSERT INTO users (name, email, password_hash)
    VALUES ('Rohan Verma', 'rohan.verma@example.com', 'hashed_pass')
  `).run();
  const testUserId = Number(userInsert.lastInsertRowid);
  const testToken = generateToken({ id: testUserId, email: 'rohan.verma@example.com' });

  try {
    // -------------------------------------------------------------------------
    // UNIT EDGE CASES: csvParser.service.js
    // -------------------------------------------------------------------------
    console.log('--- Unit Level Verification of CSV Parser & Edge Cases ---');

    // EC-2.2: UTF-8 BOM Stripping
    console.log('EC-2.2: UTF-8 BOM stripping...');
    const withBom = '\uFEFFDate,Description,Amount\n2026-10-01,Netflix,649';
    const stripped = csvParser.stripBOM(withBom);
    assert.strictEqual(stripped.charCodeAt(0), 'D'.charCodeAt(0));
    console.log('  ✅ EC-2.2 Passed: Leading BOM correctly stripped.');

    // EC-2.1: Leading Metadata Rows in Bank Exports (HDFC Style)
    console.log('EC-2.1: Pre-header metadata rows scan & stripping...');
    const hdfcBankContent = `Account Number: 501002341234
Customer Name: Rohan Verma
Statement Period: 01/08/2026 to 31/08/2026

Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
05/08/2026,UPI/NETFLIX COM,REF01,05/08/2026,649.00,,50000.00
10/08/2026,SWIGGY BANGALORE,REF02,10/08/2026,450.00,,49550.00
`;
    const previewHdfc = csvParser.previewCsv(hdfcBankContent);
    assert.strictEqual(previewHdfc.headerLineNumber, 4, 'Should detect line 4 in non-empty lines as table headers');
    assert.strictEqual(previewHdfc.suggestedMapping.date, 'Date');
    assert.strictEqual(previewHdfc.suggestedMapping.description, 'Narration');
    assert.strictEqual(previewHdfc.suggestedMapping.amount, 'Withdrawal Amt.');
    console.log('  ✅ EC-2.1 Passed: Metadata rows trimmed; correct headers detected.');

    // EC-2.3: Delimiter Variations (; and \t)
    console.log('EC-2.3: Non-comma delimiter auto-detection...');
    const semiContent = 'Date;Description;Amount\n2026-10-01;Netflix;649\n2026-10-02;Spotify;119';
    const tabContent = 'Date\tDescription\tAmount\n2026-10-01\tNetflix\t649\n2026-10-02\tSpotify\t119';
    assert.strictEqual(csvParser.detectDelimiter(semiContent), ';');
    assert.strictEqual(csvParser.detectDelimiter(tabContent), '\t');
    console.log('  ✅ EC-2.3 Passed: Semicolon and Tab delimiters auto-detected.');

    // EC-2.4: RFC-4180 Commas and Escaped Quotes inside fields
    console.log('EC-2.4: RFC-4180 embedded commas and quotes parsing...');
    const quotedLine = '2026-10-01,"SWIGGY, KORAMANGALA, BANGALORE","₹ 450.00"';
    const parsedCells = csvParser.parseCsvLine(quotedLine, ',');
    assert.strictEqual(parsedCells.length, 3);
    assert.strictEqual(parsedCells[1], 'SWIGGY, KORAMANGALA, BANGALORE');
    console.log('  ✅ EC-2.4 Passed: Quoted commas parsed without fragmenting columns.');

    // EC-2.6 & EC-2.7: Date normalization and strict invalid calendar date checking
    console.log('EC-2.6 & EC-2.7: Date parsing & strict calendar validation...');
    // Normalizations
    assert.strictEqual(csvParser.parseAndValidateDate('05/08/2026', 'DD/MM/YYYY'), '2026-08-05');
    assert.strictEqual(csvParser.parseAndValidateDate('08/05/2026', 'MM/DD/YYYY'), '2026-08-05');
    assert.strictEqual(csvParser.parseAndValidateDate('2026-08-05', 'YYYY-MM-DD'), '2026-08-05');
    assert.strictEqual(csvParser.parseAndValidateDate('05-Aug-2026'), '2026-08-05');
    assert.strictEqual(csvParser.parseAndValidateDate('05-Aug-26'), '2026-08-05'); // 2-digit year (EC-2.6)

    // Strict validation: Feb 31 must throw (EC-2.7)
    assert.throws(() => {
      csvParser.parseAndValidateDate('31/02/2026', 'DD/MM/YYYY');
    }, /Invalid calendar date/);

    // Leap year verification
    assert.strictEqual(csvParser.parseAndValidateDate('29/02/2024', 'DD/MM/YYYY'), '2024-02-29'); // 2024 is leap year
    assert.throws(() => {
      csvParser.parseAndValidateDate('29/02/2026', 'DD/MM/YYYY'); // 2026 is NOT leap year
    }, /Invalid calendar date/);
    console.log('  ✅ EC-2.6 & EC-2.7 Passed: Uniform ISO format produced; impossible dates strictly rejected.');

    // EC-2.8 & EC-2.10: Indian numbering system & zero amounts
    console.log('EC-2.8 & EC-2.10: Indian numbering system and currency symbol parsing...');
    assert.strictEqual(csvParser.parseAmount('₹ 1,25,000.50'), 125000.50);
    assert.strictEqual(csvParser.parseAmount('INR 649.00 Dr'), 649.00);
    assert.strictEqual(csvParser.parseAmount('649.00'), 649.00);
    assert.strictEqual(csvParser.parseAmount('0.00'), 0.00);
    console.log('  ✅ EC-2.8 & EC-2.10 Passed: Indian commas & symbols parsed accurately.');

    // -------------------------------------------------------------------------
    // INTEGRATION TEST: POST /api/import/preview (TC-01, TC-02)
    // -------------------------------------------------------------------------
    console.log('\n--- API Integration Verification ---');
    console.log('TC-01: Testing POST /api/import/preview with HDFC statement...');

    const sampleCsv = `Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
05/08/2026,UPI/524312/NETFLIX COM/POS 8007,REF001,05/08/2026,649.00,,42350.00
10/08/2026,SWIGGY BANGALORE IN 9931,REF002,10/08/2026,450.00,,41900.00
15/08/2026,SALARY CREDIT AUG 2026,REF003,15/08/2026,,85000.00,126900.00
20/08/2026,ACH WDL SPOTIFY INDIA,REF004,20/08/2026,119.00,,126781.00
25/08/2026,UPI/UBER TRIPS/150,REF005,25/08/2026,150.00,,126631.00
25/08/2026,UPI/UBER TRIPS/150,REF006,25/08/2026,150.00,,126481.00
31/02/2026,CORRUPT ROW FEB 31,REF007,31/02/2026,999.00,,125482.00
`;

    const previewRes = await multipartUpload(testToken, '/api/import/preview', 'statement.csv', sampleCsv);
    assert.strictEqual(previewRes.status, 200, `Expected 200, got ${previewRes.status}`);
    assert.ok(previewRes.body.headers.includes('Date'));
    assert.ok(previewRes.body.headers.includes('Narration'));
    assert.strictEqual(previewRes.body.suggestedMapping.date, 'Date');
    assert.strictEqual(previewRes.body.suggestedMapping.description, 'Narration');
    assert.strictEqual(previewRes.body.suggestedMapping.amount, 'Withdrawal Amt.');
    assert.strictEqual(previewRes.body.detectedDateFormat, 'DD/MM/YYYY');
    console.log('  ✅ TC-01 Passed: Preview endpoint detected headers and suggested mappings.');

    // -------------------------------------------------------------------------
    // INTEGRATION TEST: POST /api/import/process (TC-03, TC-04, TC-05, EC-2.11)
    // -------------------------------------------------------------------------
    console.log('TC-03, TC-04, TC-05, EC-2.11: Processing CSV import commit...');

    const processRes = await multipartUpload(testToken, '/api/import/process', 'statement.csv', sampleCsv, {
      columnMapping: JSON.stringify({
        date: 'Date',
        description: 'Narration',
        debit: 'Withdrawal Amt.',
        credit: 'Deposit Amt.'
      }),
      dateFormat: 'DD/MM/YYYY'
    });

    assert.strictEqual(processRes.status, 200);
    const summary = processRes.body.summary;

    // Check counts:
    // Total debit expenses in file:
    // 1. Netflix (649) -> Ingested
    // 2. Swiggy (450) -> Ingested
    // 3. Salary Credit (85000) -> Credit Skipped (TC-05)
    // 4. Spotify (119) -> Ingested
    // 5. Uber ride 1 (150) -> Ingested
    // 6. Uber ride 2 (150, same day) -> Ingested via occurrence index (EC-2.11)
    // 7. Feb 31 (corrupt) -> Error Row (TC-04, EC-2.7)
    assert.strictEqual(summary.imported, 5, `Expected 5 imported, got ${summary.imported}`);
    assert.strictEqual(summary.skippedCredits, 1, `Expected 1 skipped credit, got ${summary.skippedCredits}`);
    assert.strictEqual(summary.errors, 1, `Expected 1 error row, got ${summary.errors}`);
    assert.strictEqual(processRes.body.errorRows.length, 1);
    assert.ok(processRes.body.errorRows[0].reason.includes('Month 2 has 28 days'));
    console.log('  ✅ TC-03, TC-04, TC-05 & EC-2.11 Passed: Valid debits ingested, credit filtered, same-day purchases handled, invalid date reported.');

    // Verify transactions in SQLite
    const txnCount = db.prepare('SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ?').get(testUserId).cnt;
    assert.strictEqual(txnCount, 5, 'Database must have exactly 5 transactions');
    console.log('  ✅ Transactions persisted correctly in SQLite.');

    // -------------------------------------------------------------------------
    // INTEGRATION TEST: TC-06: Deduplication on Re-upload
    // -------------------------------------------------------------------------
    console.log('TC-06: Testing deduplication by re-uploading the exact same CSV...');
    const reimportRes = await multipartUpload(testToken, '/api/import/process', 'statement.csv', sampleCsv, {
      columnMapping: JSON.stringify({
        date: 'Date',
        description: 'Narration',
        debit: 'Withdrawal Amt.',
        credit: 'Deposit Amt.'
      }),
      dateFormat: 'DD/MM/YYYY'
    });

    assert.strictEqual(reimportRes.status, 200);
    assert.strictEqual(reimportRes.body.summary.imported, 0, 'Re-imported count must be 0');
    assert.strictEqual(reimportRes.body.summary.duplicates, 5, 'All 5 previously imported rows must be marked as duplicates');
    console.log('  ✅ TC-06 Passed: Re-importing returned 0 new inserts and 5 duplicates.');

    // -------------------------------------------------------------------------
    // INTEGRATION TEST: History Logs (GET /api/import/history)
    // -------------------------------------------------------------------------
    console.log('Testing GET /api/import/history...');
    const historyRes = await getRequest(testToken, '/api/import/history');
    assert.strictEqual(historyRes.status, 200);
    assert.strictEqual(historyRes.body.batches.length, 2, 'Should have 2 batch records');
    assert.strictEqual(historyRes.body.batches[0].filename, 'statement.csv');
    console.log('  ✅ Import history log recorded batches correctly.');

    console.log('\n======================================================');
    console.log('🎉 ALL MODULE 2 TEST CASES & EDGE CASES PASSED! (100%)');
    console.log('======================================================\n');

  } finally {
    server.close();
  }
}

runModule2Tests().catch(err => {
  console.error('❌ Test failed with error:', err);
  if (server) server.close();
  process.exit(1);
});
