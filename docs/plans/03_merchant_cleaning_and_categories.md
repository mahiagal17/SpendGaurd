# Implementation Plan: Module 3 — Merchant Cleaning & Categorization

> **Module:** 03 — Merchant Cleaning and Categories  
> **Source Documents:** [SRS_SpendGuard.pdf](file:///c:/Projects/project%20spendgaurd/SRS_SpendGuard.pdf), [content.md](file:///c:/Projects/project%20spendgaurd/content.md)  
> **Target Path:** `docs/plans/03_merchant_cleaning_and_categories.md`

---

## 1. Overview & Objectives
Raw bank transaction descriptions contain noise such as channel prefixes (`UPI/`, `POS/`), authorization codes, merchant account numbers, and special symbols. This module provides a fast, deterministic, rule-based pipeline that cleans raw descriptions into canonical merchant names (e.g., `UPI/NETFLIX COM/8802/CA` $\to$ `Netflix`) and categorizes each transaction into predefined expense classes without relying on paid AI services.

---

## 2. Requirements & Scope

### Core Requirements
- **Noise Stripping Pipeline:**
  - Remove standard banking prefixes and acronyms: `UPI`, `POS`, `NEFT`, `IMPS`, `RTGS`, `ACH`, `ATM`, `INB`, `BIL`, `ECOM`, `WDL`.
  - Remove terminal IDs, reference numbers, hex strings, trailing bank codes, and digits.
  - Remove special characters (`/`, `*`, `-`, `_`, `:`, `@`, `#`), preserving alphanumeric text and spaces.
  - Collapse multiple spaces and trim whitespace.
- **Canonical Merchant Resolution:**
  - Rule-based alias dictionary mapping variations to one standard proper name.
  - Example: `netflix com`, `netflix india`, `netflix.com` $\to$ `Netflix`.
  - Example: `swiggy in`, `swiggy bangalore`, `swiggy instamart` $\to$ `Swiggy`.
  - Example: `uber trips`, `uber india` $\to$ `Uber`.
  - Example: `spotify in`, `spotify ab` $\to$ `Spotify`.
  - Example: `amazon pay`, `amazon seller`, `amzn mktp` $\to$ `Amazon`.
  - Example: `airtel broadband`, `airtel pre` $\to$ `Airtel`.
- **Predefined Expense Categories:**
  - Categories: `Food`, `Shopping`, `Entertainment`, `Bills`, `Transport`, `Health`, `Subscriptions`, `Other`.
  - Keyword & pattern mapping dictionary mapping merchants/keywords to categories.
- **Default Fallback & Review Flag:**
  - If no category matches, assign `Other` and set `needs_review = 1` for user attention.

### Optional Features
- **User Override:**
  - User can edit the cleaned merchant name or change the category of any transaction.
  - Optionally save custom user rules: if a user changes `"XYZ Cafe"` to category `Food`, future imports automatically inherit this rule.

---

## 3. Database Schema Updates

Ensure `transactions` table contains category and review flags:

```sql
-- Fields in transactions table
-- merchant TEXT NOT NULL,
-- category TEXT NOT NULL DEFAULT 'Other',
-- needs_review INTEGER DEFAULT 0

-- Optional: User Custom Merchant Rules Table
CREATE TABLE IF NOT EXISTS merchant_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    pattern TEXT NOT NULL,                       -- Regex or substring to match
    canonical_merchant TEXT NOT NULL,           -- Cleaned name to assign
    category TEXT NOT NULL,                      -- Category to assign
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rules_user ON merchant_rules(user_id);
```

---

## 4. API Endpoints Specification

| Method | Endpoint | Auth | Description | Payload | Response (Success) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `PATCH` | `/api/transactions/:id` | Bearer | Update merchant name or category (Optional) | `{ "merchant": "Netflix", "category": "Subscriptions" }` | `200 OK`: `{ "transaction": { ... } }` |
| `GET` | `/api/categories` | Bearer | List available categories | None | `200 OK`: `{ "categories": ["Food", "Shopping", "Entertainment", "Bills", "Transport", "Health", "Subscriptions", "Other"] }` |
| `GET` | `/api/merchant-rules` | Bearer | Get user's custom merchant rules (Optional) | None | `200 OK`: `{ "rules": [...] }` |
| `POST` | `/api/merchant-rules` | Bearer | Add a custom merchant rule (Optional) | `{ "pattern": "blue tokai", "canonicalMerchant": "Blue Tokai Coffee", "category": "Food" }` | `201 Created`: `{ "rule": { ... } }` |

---

## 5. Cleaning & Categorization Architecture

```
Raw Description: "UPI/524312/NETFLIX COM/POS 8007"
                       │
                       ▼
       [ Step 1: Strip Noise Tokens ]
       Remove UPI, POS, numbers, special characters
       Intermediate: "NETFLIX COM"
                       │
                       ▼
    [ Step 2: Canonical Merchant Matching ]
       Pattern: /netflix/i --> "Netflix"
       Intermediate: "Netflix"
                       │
                       ▼
     [ Step 3: Category Rule Matching ]
       Rule: "Netflix" in Entertainment / Subscriptions
       Resolved: Category = "Subscriptions"
                       │
                       ▼
     [ Step 4: Fallback & Flagging ]
       If not found: Category = "Other", needs_review = 1
```

### Predefined Rule Dictionary Structure (`backend/config/merchantRules.js`):
```javascript
const CANONICAL_MERCHANTS = [
  { pattern: /netflix/i, name: "Netflix", category: "Subscriptions" },
  { pattern: /spotify/i, name: "Spotify", category: "Subscriptions" },
  { pattern: /youtube.*(?:sub|premium|google)/i, name: "YouTube Premium", category: "Subscriptions" },
  { pattern: /hotstar|disney/i, name: "Disney+ Hotstar", category: "Subscriptions" },
  { pattern: /prime.*(?:video|mem)|amzn.*prime/i, name: "Amazon Prime", category: "Subscriptions" },
  { pattern: /swiggy/i, name: "Swiggy", category: "Food" },
  { pattern: /zomato/i, name: "Zomato", category: "Food" },
  { pattern: /blinkit|zepto|instamart/i, name: "Quick Commerce", category: "Food" },
  { pattern: /uber/i, name: "Uber", category: "Transport" },
  { pattern: /ola.*cabs|rapido/i, name: "Cab Services", category: "Transport" },
  { pattern: /amazon|amzn|flipkart|myntra/i, name: "Shopping", category: "Shopping" },
  { pattern: /airtel|jio|vodafone|vi.*bill|bescom|tneb/i, name: "Utility / Telecom", category: "Bills" },
  { pattern: /apollo|pharmeasy|1mg|cult\.fit/i, name: "Health & Pharmacy", category: "Health" }
];

const CATEGORY_KEYWORDS = {
  Food: [/restaurant/i, /cafe/i, /baker/i, /kitchen/i, /food/i, /dining/i],
  Shopping: [/retail/i, /mart/i, /store/i, /fashion/i, /apparel/i],
  Transport: [/fuel/i, /petrol/i, /metro/i, /toll/i, /fastag/i],
  Bills: [/electricity/i, /water/i, /gas/i, /broadband/i, /recharge/i],
  Health: [/hospital/i, /clinic/i, /dental/i, /diagnostic/i, /pharmacy/i],
  Entertainment: [/cinema/i, /theatre/i, /bookmyshow/i, /gaming/i]
};
```

---

## 6. Implementation Steps

1. **Noise Cleaner Service (`backend/services/cleaner.service.js`):**
   - Create `cleanRawDescription(rawText)`:
     - Uppercase/lowercase normalization.
     - Strips reference tags (`UPI/[0-9]+/`, `POS/`, etc.).
     - Strips trailing numbers, special characters, and repeated punctuation.
2. **Canonical & Category Resolver (`backend/services/categorizer.service.js`):**
   - Create `resolveMerchantAndCategory(cleanedText, rawText, userCustomRules = [])`:
     - Checks user-defined custom rules first.
     - Checks canonical dictionary (`CANONICAL_MERCHANTS`).
     - If canonical name matched, assigns corresponding default category.
     - If not matched, runs generic `CATEGORY_KEYWORDS` regex tests.
     - If still unmatched, capitalizes cleaned description words, assigns category `"Other"`, and sets `needs_review = 1`.
3. **Integration with CSV Import Pipeline:**
   - Call `resolveMerchantAndCategory()` for every valid expense transaction during the CSV ingestion loop before inserting into SQLite.
4. **UI Transaction Category & Merchant Editor:**
   - In the Transactions view, provide an inline edit or modal permitting users to change the merchant name or pick another category from a dropdown.
   - Send `PATCH /api/transactions/:id` to persist updates.

---

## 7. Test Cases & Verification Checklist

- [ ] **TC-01:** `UPI/524312/NETFLIX COM/POS 8007` cleans to merchant `Netflix` and category `Subscriptions`.
- [ ] **TC-02:** `SWIGGY BANGALORE IN 9931` cleans to merchant `Swiggy` and category `Food`.
- [ ] **TC-03:** `ACH WDL SPOTIFY INDIA` cleans to merchant `Spotify` and category `Subscriptions`.
- [ ] **TC-04:** Unmatched raw descriptions (e.g. `UNKNOWN SHOP 123`) clean to `Unknown Shop` with category `Other` and `needs_review = 1`.
- [ ] **TC-05:** Categorization performs entirely offline with zero external network or paid AI API dependencies.
- [ ] **TC-06:** (Optional) Updating a transaction's merchant or category via `PATCH` persists correctly to SQLite.
