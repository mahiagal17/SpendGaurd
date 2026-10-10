const crypto = require('crypto');

/**
 * Month names map for alpha dates like '05-Aug-2026' or '5 Oct 26'
 */
const MONTH_NAMES = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

/**
 * Check if a year is a leap year
 */
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Get number of days in a specific month of a year
 */
function getDaysInMonth(month, year) {
  const days = [0, 31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month] || 0;
}

/**
 * Strip UTF-8 BOM sequence if present (EC-2.2)
 */
function stripBOM(content) {
  if (typeof content !== 'string') {
    content = content.toString('utf8');
  }
  return content.replace(/^\uFEFF/, '');
}

/**
 * Detect delimiter by analyzing candidate characters in first few lines (EC-2.3)
 */
function detectDelimiter(text) {
  const sampleLines = text.split(/\r?\n/).filter(line => line.trim().length > 0).slice(0, 10);
  if (sampleLines.length === 0) return ',';

  let commaCount = 0;
  let semiCount = 0;
  let tabCount = 0;

  for (const line of sampleLines) {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes) {
        if (c === ',') commaCount++;
        else if (c === ';') semiCount++;
        else if (c === '\t') tabCount++;
      }
    }
  }

  if (tabCount > commaCount && tabCount > semiCount) return '\t';
  if (semiCount > commaCount && semiCount > tabCount) return ';';
  return ',';
}

/**
 * Parse a single CSV line into an array of cell values according to RFC-4180 (EC-2.4)
 */
function parseCsvLine(line, delimiter = ',') {
  const cells = [];
  let currentCell = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // Escaped quote: "" -> "
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // End of quoted value
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentCell += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        cells.push(currentCell.trim());
        currentCell = '';
        i++;
        continue;
      } else {
        currentCell += char;
        i++;
        continue;
      }
    }
  }

  cells.push(currentCell.trim());
  return cells;
}

/**
 * Header keyword regex patterns
 */
const DATE_KEYWORDS = /^(date|txn[\s_]?date|transaction[\s_]?date|value[\s_]?dt|value[\s_]?date|booking[\s_]?date)$/i;
const DESC_KEYWORDS = /^(description|narration|particulars|details|merchant|remarks|transaction[\s_]?details|transaction[\s_]?remarks)$/i;
const DEBIT_KEYWORDS = /^(debit|debit[\s_]?amount|withdrawal|withdrawal[\s_]?amt\.?|dr|dr[\s_]?amount|spent)$/i;
const CREDIT_KEYWORDS = /^(credit|credit[\s_]?amount|deposit|deposit[\s_]?amt\.?|cr|cr[\s_]?amount)$/i;
const AMOUNT_KEYWORDS = /^(amount|transaction[\s_]?amount|amt|net[\s_]?amount|total[\s_]?amount)$/i;
const TYPE_KEYWORDS = /^(type|txn[\s_]?type|cr\/dr|dr\/cr|type[\s_]?code)$/i;
const REF_KEYWORDS = /^(chq\/ref[\s_]?no|ref[\s_]?no|reference|utr|txn[\s_]?id|cheque[\s_]?no)$/i;

/**
 * Check if a cell name matches date keywords
 */
function matchesDate(col) {
  const s = col.trim().toLowerCase();
  return DATE_KEYWORDS.test(s) || /date/i.test(s);
}

/**
 * Check if a cell name matches description keywords
 */
function matchesDesc(col) {
  const s = col.trim().toLowerCase();
  return DESC_KEYWORDS.test(s) || /narration|particulars|description/i.test(s);
}

/**
 * Check if a cell name matches debit / amount keywords
 */
function matchesAmount(col) {
  const s = col.trim().toLowerCase();
  return AMOUNT_KEYWORDS.test(s) || DEBIT_KEYWORDS.test(s) || /amount|debit|withdrawal/i.test(s);
}

/**
 * Detect table header row and skip bank metadata preambles (EC-2.1)
 */
function findHeaderRowIndex(rawLines, delimiter) {
  const maxScan = Math.min(rawLines.length, 30);

  for (let i = 0; i < maxScan; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    const cells = parseCsvLine(line, delimiter);
    if (cells.length < 2) continue;

    let hasDate = false;
    let hasDesc = false;
    let hasAmt = false;

    for (const cell of cells) {
      if (matchesDate(cell)) hasDate = true;
      if (matchesDesc(cell)) hasDesc = true;
      if (matchesAmount(cell)) hasAmt = true;
    }

    // A valid table header will match at least two of Date, Description, Amount
    const matchCount = (hasDate ? 1 : 0) + (hasDesc ? 1 : 0) + (hasAmt ? 1 : 0);
    if (matchCount >= 2) {
      return i;
    }
  }

  // Fallback to line 0 if no clear header was matched
  return 0;
}

/**
 * Heuristically detect column mappings from headers
 */
function detectColumnMapping(headers) {
  const mapping = {
    date: null,
    description: null,
    amount: null,
    debit: null,
    credit: null,
    type: null,
    ref: null
  };

  headers.forEach((h, index) => {
    const col = h.trim();
    const clean = col.toLowerCase();

    // Date
    if (!mapping.date && matchesDate(clean)) {
      mapping.date = col;
    }

    // Description
    if (!mapping.description && matchesDesc(clean)) {
      mapping.description = col;
    }

    // Separate Debit
    if (!mapping.debit && DEBIT_KEYWORDS.test(clean)) {
      mapping.debit = col;
    }

    // Separate Credit
    if (!mapping.credit && CREDIT_KEYWORDS.test(clean)) {
      mapping.credit = col;
    }

    // Single Amount
    if (!mapping.amount && AMOUNT_KEYWORDS.test(clean)) {
      mapping.amount = col;
    }

    // Type (DR/CR)
    if (!mapping.type && TYPE_KEYWORDS.test(clean)) {
      mapping.type = col;
    }

    // Ref / UTR
    if (!mapping.ref && REF_KEYWORDS.test(clean)) {
      mapping.ref = col;
    }
  });

  // If separate debit column found, prefer it as amount
  if (mapping.debit) {
    mapping.amount = mapping.debit;
  } else if (!mapping.amount) {
    // Fallback: look for any header containing 'amount' or 'amt'
    const amtHeader = headers.find(h => /amount|amt|withdrawal/i.test(h));
    if (amtHeader) mapping.amount = amtHeader;
  }

  // Fallback defaults if not matched
  if (!mapping.date) mapping.date = headers[0] || 'Date';
  if (!mapping.description) {
    mapping.description = headers.find(h => h !== mapping.date && h !== mapping.amount) || headers[1] || 'Description';
  }
  if (!mapping.amount) {
    mapping.amount = headers.find(h => h !== mapping.date && h !== mapping.description) || headers[2] || 'Amount';
  }

  return mapping;
}

/**
 * Scan sample rows to detect whether date format is likely DD/MM/YYYY or MM/DD/YYYY (EC-2.5)
 */
function inferDateFormat(rows, dateCol) {
  if (!dateCol || !rows || rows.length === 0) return 'DD/MM/YYYY';

  for (const row of rows) {
    const val = (row[dateCol] || '').trim();
    if (!val) continue;

    // ISO format YYYY-MM-DD
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(val)) {
      return 'YYYY-MM-DD';
    }

    // Textual month format e.g. 05-Aug-2026
    if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(val)) {
      return 'DD-MMM-YYYY';
    }

    // Slash/dash/dot date: check first number vs second number
    const parts = val.split(/[-/.]/);
    if (parts.length >= 2) {
      const p1 = parseInt(parts[0], 10);
      const p2 = parseInt(parts[1], 10);

      // If first number > 12, it MUST be day -> DD/MM/YYYY
      if (p1 > 12) return 'DD/MM/YYYY';
      // If second number > 12, it MUST be day -> MM/DD/YYYY
      if (p2 > 12) return 'MM/DD/YYYY';
    }
  }

  // Default to standard Indian bank format DD/MM/YYYY
  return 'DD/MM/YYYY';
}

/**
 * Parse and normalize date into ISO format YYYY-MM-DD.
 * Strictly validates calendar dates (EC-2.6, EC-2.7).
 */
function parseAndValidateDate(rawDateStr, preferredFormat = 'DD/MM/YYYY') {
  if (!rawDateStr || typeof rawDateStr !== 'string') {
    throw new Error('Date string is empty or missing');
  }

  const trimmed = rawDateStr.trim();
  if (!trimmed) {
    throw new Error('Date string is blank');
  }

  let year, month, day;

  // Pattern 1: ISO YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10);
    day = parseInt(isoMatch[3], 10);
  } else {
    // Pattern 2: Textual month e.g. '05-Aug-2026' or '5 Aug 26'
    const alphaMatch = trimmed.match(/^(\d{1,2})[-/\s]([a-zA-Z]{3,9})[-/\s](\d{2,4})/);
    if (alphaMatch) {
      day = parseInt(alphaMatch[1], 10);
      const monthStr = alphaMatch[2].toLowerCase();
      month = MONTH_NAMES[monthStr];
      if (!month) {
        throw new Error(`Invalid month name in date: '${alphaMatch[2]}'`);
      }
      let rawYear = parseInt(alphaMatch[3], 10);
      if (rawYear < 100) {
        // EC-2.6: 2-digit years
        rawYear = rawYear <= 50 ? 2000 + rawYear : 1900 + rawYear;
      }
      year = rawYear;
    } else {
      // Pattern 3: Numeric separated by / or - or .
      const numMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
      if (!numMatch) {
        throw new Error(`Unrecognized date format: '${trimmed}'`);
      }

      let p1 = parseInt(numMatch[1], 10);
      let p2 = parseInt(numMatch[2], 10);
      let rawYear = parseInt(numMatch[3], 10);

      if (rawYear < 100) {
        // EC-2.6: 2-digit years
        rawYear = rawYear <= 50 ? 2000 + rawYear : 1900 + rawYear;
      }
      year = rawYear;

      if (preferredFormat === 'MM/DD/YYYY') {
        month = p1;
        day = p2;
      } else {
        // DD/MM/YYYY default
        day = p1;
        month = p2;
      }
    }
  }

  // Strict Calendar Date Validation (EC-2.7)
  if (isNaN(year) || year < 1900 || year > 2100) {
    throw new Error(`Year ${year} is out of realistic range (1900-2100)`);
  }

  if (isNaN(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month ${month} in date: '${trimmed}'`);
  }

  const maxDays = getDaysInMonth(month, year);
  if (isNaN(day) || day < 1 || day > maxDays) {
    throw new Error(`Invalid calendar date '${trimmed}': Month ${month} has ${maxDays} days`);
  }

  const yStr = String(year);
  const mStr = String(month).padStart(2, '0');
  const dStr = String(day).padStart(2, '0');

  return `${yStr}-${mStr}-${dStr}`;
}

/**
 * Parse numeric amount string from Indian and international conventions (EC-2.8)
 */
function parseAmount(rawStr) {
  if (rawStr === null || rawStr === undefined) return null;
  const s = String(rawStr).trim();
  if (!s) return null;

  // Remove currency signs (₹, Rs, INR, $), commas, trailing Dr/Cr, and whitespace
  // e.g., '₹ 1,25,000.50 Dr' -> '125000.50'
  const cleaned = s
    .replace(/[₹$€£]/g, '')
    .replace(/\b(rs\.?|inr|usd)\b/gi, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/(dr|cr)$/i, '');

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;

  return Math.abs(num);
}

/**
 * Generate SHA-256 fingerprint for deduplication with batch occurrence index (EC-2.11)
 */
function generateFingerprint(userId, date, amount, description, occurrenceIndex = 0) {
  const normDesc = description.trim().toLowerCase().replace(/\s+/g, ' ');
  const normAmount = Number(amount).toFixed(2);
  const rawKey = `${userId}:${date}:${normAmount}:${normDesc}:${occurrenceIndex}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Full CSV Parse Previewer
 */
function previewCsv(csvContent) {
  const text = stripBOM(csvContent);
  const delimiter = detectDelimiter(text);
  const rawLines = text.split(/\r?\n/).filter(line => line.trim().length > 0);

  if (rawLines.length === 0) {
    throw new Error('The uploaded CSV file is empty');
  }

  // Find header row (EC-2.1)
  const headerIdx = findHeaderRowIndex(rawLines, delimiter);
  const headerLine = rawLines[headerIdx];
  const headers = parseCsvLine(headerLine, delimiter);

  // Column heuristic mapping
  const suggestedMapping = detectColumnMapping(headers);

  // Parse sample preview rows (up to 15 rows)
  const previewRows = [];
  const allRowsSample = [];
  const maxSample = Math.min(rawLines.length, headerIdx + 30);

  for (let i = headerIdx + 1; i < maxSample; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    const cells = parseCsvLine(line, delimiter);
    if (cells.length === 0) continue;

    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = cells[idx] || '';
    });

    allRowsSample.push(rowObj);
    if (previewRows.length < 10) {
      previewRows.push(rowObj);
    }
  }

  // Infer best date format
  const detectedDateFormat = inferDateFormat(allRowsSample, suggestedMapping.date);

  return {
    headers,
    delimiter,
    headerLineNumber: headerIdx + 1,
    suggestedMapping,
    detectedDateFormat,
    previewRows,
    totalRowsSampled: allRowsSample.length
  };
}

/**
 * Full CSV Processing Iterator
 * Returns structured transactions and error report (EC-2.12)
 */
function processCsv(csvContent, options = {}) {
  const text = stripBOM(csvContent);
  const delimiter = options.delimiter || detectDelimiter(text);
  const rawLines = text.split(/\r?\n/).filter(line => line.trim().length > 0);

  if (rawLines.length === 0) {
    throw new Error('The uploaded CSV file is empty');
  }

  const headerIdx = options.headerLineIndex !== undefined 
    ? options.headerLineIndex 
    : findHeaderRowIndex(rawLines, delimiter);

  const headerLine = rawLines[headerIdx];
  const headers = parseCsvLine(headerLine, delimiter);

  const mapping = options.columnMapping || detectColumnMapping(headers);
  const dateFormat = options.dateFormat || 'DD/MM/YYYY';

  const dateCol = mapping.date;
  const descCol = mapping.description;
  const amountCol = mapping.amount;
  const debitCol = mapping.debit;
  const creditCol = mapping.credit;
  const typeCol = mapping.type;

  const validTransactions = [];
  const errorRows = [];
  let skippedCreditsCount = 0;
  let skippedZeroCount = 0;

  // Occurrence tracker per unique (date + amount + description) for EC-2.11
  const occurrenceMap = new Map();

  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const lineNumber = i + 1;

    if (!rawLine.trim()) continue;

    const cells = parseCsvLine(rawLine, delimiter);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] !== undefined ? cells[idx] : '';
    });

    try {
      // 1. Description extraction
      const description = (row[descCol] || '').trim();
      if (!description) {
        errorRows.push({
          row: lineNumber,
          reason: `Missing description in column '${descCol}'`,
          raw: rawLine
        });
        continue;
      }

      // 2. Date parsing (EC-2.5, EC-2.6, EC-2.7)
      const rawDate = row[dateCol];
      let normalizedDate;
      try {
        normalizedDate = parseAndValidateDate(rawDate, dateFormat);
      } catch (dateErr) {
        errorRows.push({
          row: lineNumber,
          reason: dateErr.message,
          raw: rawLine
        });
        continue;
      }

      // 3. Amount & Debit filtering (EC-2.8, EC-2.9, EC-2.10)
      let amount = null;
      let isExpense = 1;

      // Check if separate Debit & Credit columns exist
      if (debitCol && creditCol && debitCol !== creditCol) {
        const debitVal = parseAmount(row[debitCol]);
        const creditVal = parseAmount(row[creditCol]);

        if (debitVal && debitVal > 0) {
          amount = debitVal;
          isExpense = 1;
        } else if (creditVal && creditVal > 0) {
          // Deposit/credit row -> skip as per spec
          skippedCreditsCount++;
          continue;
        } else {
          skippedZeroCount++;
          continue;
        }
      } else {
        // Single amount column with Type (DR/CR) or signed amount
        const rawAmt = row[amountCol];
        amount = parseAmount(rawAmt);

        if (amount === null || isNaN(amount)) {
          errorRows.push({
            row: lineNumber,
            reason: `Invalid non-numeric amount: '${rawAmt}' in column '${amountCol}'`,
            raw: rawLine
          });
          continue;
        }

        // Check Type column
        if (typeCol && row[typeCol]) {
          const typeStr = row[typeCol].trim().toUpperCase();
          if (typeStr === 'CR' || typeStr === 'CREDIT' || typeStr === 'DEPOSIT') {
            skippedCreditsCount++;
            continue;
          }
        }

        // EC-2.10: Zero amount charges
        if (amount <= 0) {
          skippedZeroCount++;
          continue;
        }
      }

      // 4. Occurrence indexing for same-day identical transactions (EC-2.11)
      const key = `${normalizedDate}|${amount.toFixed(2)}|${description.toLowerCase()}`;
      const count = occurrenceMap.get(key) || 0;
      occurrenceMap.set(key, count + 1);

      validTransactions.push({
        lineNumber,
        date: normalizedDate,
        amount,
        originalDescription: description,
        occurrenceIndex: count,
        rawLine
      });

    } catch (rowErr) {
      errorRows.push({
        row: lineNumber,
        reason: `Unexpected parsing error: ${rowErr.message}`,
        raw: rawLine
      });
    }
  }

  return {
    headers,
    totalRows: rawLines.length - headerIdx - 1,
    validTransactions,
    errorRows,
    skippedCreditsCount,
    skippedZeroCount
  };
}

module.exports = {
  stripBOM,
  detectDelimiter,
  parseCsvLine,
  findHeaderRowIndex,
  detectColumnMapping,
  inferDateFormat,
  parseAndValidateDate,
  parseAmount,
  generateFingerprint,
  previewCsv,
  processCsv
};
