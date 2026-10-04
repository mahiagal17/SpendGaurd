# Edge Cases & Failure Modes: Module 2 — CSV Import & Ingestion Engine

> **Module:** 02 — CSV Import  
> **Source Documents:** [SRS_SpendGuard.pdf](file:///c:/Projects/project%20spendgaurd/SRS_SpendGuard.pdf), [content.md](file:///c:/Projects/project%20spendgaurd/content.md), [02_csv_import.md](file:///c:/Projects/project%20spendgaurd/docs/plans/02_csv_import.md)  
> **Target Path:** `docs/edge-cases/02_csv_import.md`

---

## 1. Overview
Bank CSV files exported from various financial institutions are notorious for inconsistent structures, irregular metadata headers, varied character encodings, and divergent numerical conventions. 

This document details the edge cases encountered during CSV ingestion, date/amount parsing, debit filtering, and deduplication, along with the required mitigations.

---

## 2. File & Format Irregularities

### EC-2.1: Leading Metadata Rows in Bank Exports
- **Scenario:** Indian bank exports (e.g., HDFC, SBI, ICICI, Axis) often prepend 5–15 rows of account metadata before the actual transaction table (e.g., `"Account Number: 50100...", "Statement Period: 01/01/2026 to 31/03/2026", "Branch: Indiranagar"`, followed by empty lines, then the column headers).
- **Risk:** The CSV parser assumes line 1 is the header row, resulting in completely failed column detection.
- **Expected Behavior:** 
  - The preview and parsing service scans the first 25 lines looking for candidate header keywords (`date`, `description`, `amount`, `narration`, `withdrawal`, `debit`).
  - Rows preceding the detected header row are automatically trimmed, and the table starts at the identified header line.

### EC-2.2: UTF-8 Byte Order Mark (BOM) & Non-UTF8 Encodings
- **Scenario:** Many Windows-exported CSVs include a UTF-8 BOM (`\uFEFF`) at byte 0, or are encoded in `Windows-1252` / `ISO-8859-1`.
- **Risk:** A BOM causes the first column name to be read as `\uFEFFDate` instead of `Date`, failing regex matching.
- **Expected Behavior:** 
  - Strip the leading BOM sequence: `buffer.toString('utf8').replace(/^\uFEFF/, '')`.
  - Use an encoding detection/normalization stream (e.g., `iconv-lite`) to convert ANSI/Windows-1252 to UTF-8 before parsing.

### EC-2.3: Delimiter Variations (Semicolons, Tabs, Commas)
- **Scenario:** European banks or specific accounting exports utilize semicolons (`;`) or tabs (`\t`) instead of commas (`,`).
- **Expected Behavior:** 
  - Auto-detect the delimiter by evaluating frequency of `,`, `;`, and `\t` in the first few non-empty rows.

### EC-2.4: Commas and Quotes Inside Narration Fields
- **Scenario:** A merchant description contains commas without proper quote escaping: `SWIGGY, KORAMANGALA, BANGALORE`.
- **Risk:** Naive string `split(',')` fragments the description into multiple columns, misaligning date, description, and amount.
- **Expected Behavior:** 
  - Always use an RFC-4180 compliant CSV parser (such as `csv-parser` or `fast-csv`) that respects escaped quotes (`"..."`) and embedded commas.

---

## 3. Date Parsing & Ambiguities

### EC-2.5: `DD/MM/YYYY` vs `MM/DD/YYYY` Ambiguity
- **Scenario:** A date string is `05/08/2026`. Is it May 8th or August 5th? (In the SRS: `05/08/2026, NETFLIX.COM 8007 CA, 649.00`).
- **Risk:** Parsing as the wrong month alters spending trends, monthly reports, and renewal calendars.
- **Expected Behavior:** 
  - Default to `DD/MM/YYYY` (the standard in India and Commonwealth nations).
  - During the preview step (`POST /api/import/preview`), detect the presence of days $> 12$ across the dataset (e.g. `24/08/2026` proves `DD/MM` format).
  - Allow the user to explicitly select or toggle the Date Format (`DD/MM/YYYY` vs `MM/DD/YYYY` vs `YYYY-MM-DD`) in the import mapping UI before confirming.

### EC-2.6: Two-Digit Years (`YY`) and Non-Standard Delimiters
- **Scenario:** Dates formatted as `05-Aug-26`, `05.08.2026`, or `8/5/26`.
- **Expected Behavior:** 
  - The date normalizer must handle dashes (`-`), slashes (`/`), and dots (`.`).
  - Two-digit years: assume `20YY` if $YY \le 50$, else `19YY`.
  - Normalize all dates to standard ISO `YYYY-MM-DD`.

### EC-2.7: Invalid Calendar Dates
- **Scenario:** Row contains an impossible date such as `31/02/2026` or `31/04/2026`.
- **Expected Behavior:** 
  - JavaScript's `Date` constructor rolls over `Feb 31` to `Mar 3`. The parser must strictly validate calendar days against month lengths.
  - Reject the row, record an entry in `errorRows`: `Row 42: Invalid calendar date '31/02/2026'`, and continue processing subsequent rows.

---

## 4. Amount Parsing & Expense Filtering

### EC-2.8: Indian Numbering System & Formatting Artifacts
- **Scenario:** Amounts formatted as `1,25,000.50`, `₹ 649.00`, `INR 649.00`, or `649.00 Dr`.
- **Risk:** `parseFloat()` returns `NaN` or truncates at the first comma (e.g., `1,25,000` $\to$ `1`).
- **Expected Behavior:** 
  - Clean amount strings: remove currency symbols (`₹`, `Rs.`, `INR`), spaces, and commas (`str.replace(/[^0-9.-]/g, '')`).
  - Accurately parse as float.

### EC-2.9: Debit vs. Credit Separation
- **Scenario:** Bank exports structure debits and credits in different ways:
  1. Separate columns: `Debit` and `Credit`.
  2. Single `Amount` column with signed values (`-649.00` for debit, `+1000.00` for credit).
  3. Single `Amount` column with a `Type` column (`DR` / `CR`).
- **Expected Behavior:** 
  - If separate `Debit` / `Credit` columns exist, map `Debit` and ignore rows where `Debit` is empty or zero.
  - If a signed column is used, negative numbers are treated as debits (or vice versa based on user toggle).
  - Credit/deposit rows (salary, refunds, transfers into account) must be skipped since SpendGuard tracks expenses only.

### EC-2.10: Zero-Amount and Reversal Transactions
- **Scenario:** A bank row shows `0.00` (e.g., authorization check or micro-deposit) or a reversal charge (refund of subscription fee).
- **Expected Behavior:** 
  - Skip `0.00` rows.
  - If a user wishes to record a reversal, it is marked as credit and excluded from debit expense analytics.

---

## 5. Deduplication & Data Integrity

### EC-2.11: Legitimate Multiple Purchases on the Same Day
- **Scenario:** A user takes two separate Uber rides for ₹150.00 on the same date with identical raw descriptions (`UPI/UBER TRIPS/150`).
- **Risk:** A naive fingerprint `hash(userId + date + amount + description)` would treat the second valid ride as a duplicate and discard it.
- **Expected Behavior:** 
  - The deduplication fingerprint must include a row occurrence index or reference ID if present in the CSV.
  - When matching identically formatted transactions within the same batch, preserve distinct line instances while deduplicating only against transactions already committed in prior import batches.

### EC-2.12: Partial File Failure & Batch Atomicity
- **Scenario:** In a 1,000-row CSV, row 950 throws an unhandled parsing exception or database lock error.
- **Risk:** First 949 rows are committed, but the remaining rows are discarded, leaving the database in an inconsistent state.
- **Expected Behavior:** 
  - Ingestion runs inside an SQLite transaction (`BEGIN TRANSACTION ... COMMIT`).
  - If an unexpected fatal error occurs, rollback completely.
  - For normal validation errors, catch and collect them into an `errorRows` array and commit all valid rows.

---

## 6. Summary Matrix

| ID | Edge Case | Severity | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **EC-2.1** | Bank header metadata rows | High | Scan first 25 rows for table headers; trim metadata preambles. |
| **EC-2.2** | UTF-8 BOM & non-UTF8 encodings | Medium | Strip `\uFEFF` and convert to UTF-8 via iconv-lite. |
| **EC-2.3** | Non-comma delimiters (`;`, `\t`) | Medium | Auto-detect delimiter frequency in header detection. |
| **EC-2.4** | Embedded commas in description | High | Use compliant RFC-4180 streaming parser. |
| **EC-2.5** | `DD/MM` vs `MM/DD` date ambiguity | Critical | Default to `DD/MM/YYYY`, scan for values $> 12$, provide UI selector. |
| **EC-2.6** | 2-digit years (`YY`) | Medium | Map $\le 50$ to $20YY$, $> 50$ to $19YY$. |
| **EC-2.7** | Impossible dates (e.g. Feb 31) | Medium | Strict calendar date validator; skip and log to error report. |
| **EC-2.8** | Indian numbering commas / symbols | High | Strip non-numeric/period characters before `parseFloat`. |
| **EC-2.9** | Mixed Debit/Credit structures | High | Multi-mode detection (Separate columns, Sign, or Type code). |
| **EC-2.10**| Zero-amount / micro-charges | Low | Skip amounts $\le 0.00$. |
| **EC-2.11**| Same-day identical transactions | High | Contextual occurrence indexing to avoid false deduplication. |
| **EC-2.12**| Import failure mid-batch | High | SQLite transaction block with rollback on unhandled crash. |
