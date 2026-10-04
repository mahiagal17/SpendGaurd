# Edge Cases & Failure Modes: Module 3 — Merchant Cleaning & Categorization

> **Module:** 03 — Merchant Cleaning and Categories  
> **Source Documents:** [SRS_SpendGuard.pdf](file:///c:/Projects/project%20spendgaurd/SRS_SpendGuard.pdf), [content.md](file:///c:/Projects/project%20spendgaurd/content.md), [03_merchant_cleaning_and_categories.md](file:///c:/Projects/project%20spendgaurd/docs/plans/03_merchant_cleaning_and_categories.md)  
> **Target Path:** `docs/edge-cases/03_merchant_cleaning_and_categories.md`

---

## 1. Overview
The cleaning and categorization module relies on deterministic heuristics, regex patterns, and alias dictionaries rather than black-box AI models. 

This document analyzes edge cases involving noisy payment aggregator prefixes, substring collision false positives, multi-category merchants, pure noise strings, and manual user override synchronization.

---

## 2. Noisy Descriptions & Obfuscation Edge Cases

### EC-3.1: Payment Gateway & Aggregator Prefixes
- **Scenario:** The bank statement description obscures the merchant name behind payment gateway notations:
  - `RAZORPAY*NETFLIX`
  - `BILLDESK*AIRTEL FIBER`
  - `PAYU*SWIGGY`
  - `CCAVENUE*BOOKMYSHOW`
  - `CASHFREE PAYMENTS / ZOMATO`
- **Risk:** Without handling aggregator tokens, the merchant is misclassified as `"Razorpay"` or `"Billdesk"`, merging disparate expenses into one fake merchant.
- **Expected Behavior:** 
  - Strip aggregator prefixes (`/(razorpay|billdesk|payu|ccavenue|cashfree)[\s*\/_-]+/i`).
  - Extract the trailing true merchant name (`Netflix`, `Airtel Fiber`, `Swiggy`).

### EC-3.2: Naked Aggregator Transactions
- **Scenario:** The description provides only the gateway name without the underlying merchant: `RAZORPAY SOFTWARE PVT LTD 98213`.
- **Risk:** Cannot determine if this was food, a software subscription, or shopping.
- **Expected Behavior:** 
  - Normalize to `Razorpay (Gateway)`.
  - Assign category `Other`.
  - Mark `needs_review = 1` so the user is prompted to categorize it.

### EC-3.3: Complex Indian UPI Handles and VPA Formats
- **Scenario:** Raw UPI strings:
  - `UPI/5243128912/NETFLIX COM/ICICI/8007/Payment from user`
  - `UPI-SWIGGY-swiggy.payu@icici-UPI`
  - `PAYTM-12345678@paytm`
- **Expected Behavior:** 
  - Extract the meaningful merchant token between standard UPI delimiters or examine the VPA prefix before `@` (e.g., `swiggy.payu` $\to$ `Swiggy`).
  - Discard transaction reference numbers and bank IFSC/VPA handles (`@icici`, `@oksbi`, `@paytm`).

---

## 3. Substring Collisions & False Positives

### EC-3.4: Substring Matching Without Word Boundaries
- **Scenario:** A regex naive search for `uber` matches:
  - `TUBERCULOSIS CLINIC` $\to$ incorrectly labeled `Uber` (Transport).
  - `AMAZON` matching `AMAZONIAN CAFE` $\to$ incorrectly labeled `Amazon` (Shopping).
  - `APPLE` matching `GREEN APPLE GROCERIES` $\to$ incorrectly labeled `Apple` (Subscriptions).
  - `CULT` matching `DIFFICULT CONCEPTS BOOKSTORE` $\to$ incorrectly labeled `Cult.fit` (Health).
- **Risk:** Highly embarrassing and incorrect categorization.
- **Expected Behavior:** 
  - All keyword regexes must enforce strict word boundaries: `/\buber\b/i`, `/\bapple\b(?!\s*(grocer|fruit|orchard))/i`.
  - Prioritize specific compound phrases (`Green Apple Groceries` $\to$ `Food`) over single generic brand tokens.

### EC-3.5: Multi-Category Mega Merchants
- **Scenario:** A merchant offers multiple unrelated services under a single corporate umbrella:
  - `Amazon`: Amazon Retail (`Shopping`) vs. Amazon Prime Video (`Subscriptions` / `Entertainment`) vs. AWS (`Bills` / Cloud).
  - `Google`: Google Play Store (`Entertainment`) vs. Google Workspace (`Bills`) vs. YouTube Premium (`Subscriptions`).
  - `Tata`: Tata Neu (`Shopping`) vs. Tata Play (`Bills` / DTH) vs. Tata 1mg (`Health`).
- **Expected Behavior:** 
  - Check contextual sub-keywords in description:
    - `Amazon Prime` or `Prime Video` $\to$ `Subscriptions`.
    - `AWS` or `Amazon Web Services` $\to$ `Bills`.
    - Generic `Amazon` $\to$ `Shopping`.
    - `YouTube` or `Google Play` $\to$ `Subscriptions` / `Entertainment`.
    - `Google Cloud` or `Google Workspace` $\to$ `Bills`.

---

## 4. Degenerate Strings & Fallback Edge Cases

### EC-3.6: Descriptions Composed Purely of Numbers and Noise
- **Scenario:** Raw description: `1234567890/POS/---/***** 9999`.
- **Risk:** After stripping noise, the cleaned merchant string is empty (`""`).
- **Expected Behavior:** 
  - Fallback check: if `cleanedMerchant.trim().length === 0`, set merchant to `"Unknown Merchant"`.
  - Set category to `"Other"` and flag `needs_review = 1`.

### EC-3.7: Special Unicode, Accents, and Emojis
- **Scenario:** Descriptions containing accents or symbols: `Café Coffee Day`, `H&M Retail`, `Marks & Spencer`, `7-Eleven`.
- **Risk:** Overly aggressive noise cleaning stripping `&`, `-`, or accented letters (`Café` $\to$ `Caf Coffee Day`).
- **Expected Behavior:** 
  - Retain valid alphanumeric characters across Unicode latin/accent ranges, plus essential punctuation (`&`, `-`, `'`).
  - Collapse multiple spaces into a single space.

---

## 5. User Overrides & Rule Consistency

### EC-3.8: Conflict Between Global Dictionary and User Custom Rule
- **Scenario:** The global system classifies `"Local Store"` as `"Other"`. The user edits a transaction to `"Shopping"`.
- **Risk:** On next import, the same merchant reverts to `"Other"`.
- **Expected Behavior:** 
  - Evaluation hierarchy:
    1. User custom override rules (`merchant_rules` table for `user_id`).
    2. Exact canonical merchant dictionary (`CANONICAL_MERCHANTS`).
    3. Category keyword heuristics (`CATEGORY_KEYWORDS`).
    4. Fallback to `"Other"` with `needs_review = 1`.
  - User rules take absolute precedence over global defaults for that specific user.

### EC-3.9: Bulk Re-Categorization Propagation
- **Scenario:** User modifies a merchant name/category for transaction $X$. Should historical transactions for that same merchant update automatically?
- **Expected Behavior:** 
  - Prompt user with an option: *"Apply this category to all 14 past transactions from this merchant?"*
  - If confirmed, execute a scoped update:
    ```sql
    UPDATE transactions 
    SET category = ?, merchant = ? 
    WHERE user_id = ? AND original_description LIKE ?;
    ```

---

## 6. Summary Matrix

| ID | Edge Case | Severity | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **EC-3.1** | Aggregator prefixes (`Razorpay*`, etc.) | High | Strip gateway prefixes before merchant canonical matching. |
| **EC-3.2** | Naked aggregator transactions | Medium | Normalize to `Gateway Name`, categorize as `Other`, flag review. |
| **EC-3.3** | Complex UPI VPAs & references | High | Parse VPA handle token and remove bank reference codes. |
| **EC-3.4** | Substring collisions (`Tuberculosis` $\to$ `Uber`) | Critical | Enforce word boundaries `\b` and priority ranking. |
| **EC-3.5** | Multi-category mega-merchants (Amazon/Google) | High | Contextual secondary keyword evaluation (e.g. `Prime`, `AWS`). |
| **EC-3.6** | Pure noise descriptions cleaning to `""` | Medium | Fallback to `Unknown Merchant`, `Other`, `needs_review = 1`. |
| **EC-3.7** | Unicode accents & valid symbols (`Café`, `H&M`)| Medium | Preserve Latin accents and symbols `&`, `-`, `'`. |
| **EC-3.8** | User custom rule conflicts | High | User rules strictly supersede global dictionary rules. |
| **EC-3.9** | Propagating manual category edits | Medium | Modal confirmation to apply updates to matching past records. |
