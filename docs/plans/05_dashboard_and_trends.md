# Implementation Plan: Module 5 — Dashboard, Trends & Analytics

> **Module:** 05 — Dashboard and Trends  
> **Source Documents:** [SRS_SpendGuard.pdf](file:///c:/Projects/project%20spendgaurd/SRS_SpendGuard.pdf), [content.md](file:///c:/Projects/project%20spendgaurd/content.md)  
> **Target Path:** `docs/plans/05_dashboard_and_trends.md`

---

## 1. Overview & Objectives
The Dashboard serves as the central command center for SpendGuard. It gives users immediate, visual clarity into their financial health:
1. Current month's total expenditure and budget pulse.
2. Historical spending trend graph (last 3–6 months).
3. Category-wise expenditure breakdown (visual donut/pie chart and ranked list).
4. Subscription overhead overview (active count and monthly recurring expenditure).
5. Comprehensive searchable and filterable Transactions page.
6. Proactive anomaly flags (category spending spikes and unusual payment alerts).

---

## 2. Requirements & Scope

### Core Requirements
- **Key Metrics Overview Cards:**
  - **This Month's Spending:** Sum of all debit transactions in the current calendar month in ₹.
  - **Active Subscriptions:** Count of active recurring commitments.
  - **Monthly Subscription Commitment:** Sum of normalized monthly costs of all active subscriptions in ₹.
  - **Upcoming Renewals Count:** Count of renewals due in the next 7 days.
- **Historical Monthly Trends Chart:**
  - Aggregated monthly spending across the last 6 calendar months (`YYYY-MM`).
  - Rendered with an elegant, responsive chart (Chart.js or modern lightweight canvas/SVG).
- **Category Spending Distribution:**
  - Breakdown of expenses by category (`Food`, `Shopping`, `Entertainment`, `Bills`, `Transport`, `Health`, `Subscriptions`, `Other`) for the current month or custom period.
  - Donut/pie chart accompanied by a percentage and amount table.
- **Transactions Management View (`/transactions`):**
  - Full tabular transaction list with server-assisted or client-side filtering:
    - Search by merchant name or raw description.
    - Filter by category.
    - Filter by date range (from / to).
    - Sort by date (descending/ascending) or amount (high/low).
    - Pagination or infinite scrolling for smooth performance.

### Optional Features
- **Category Spending Spike Detection:**
  - Compare current month's category spend against previous month or rolling 3-month average.
  - If spending in a category is $\ge 50\%$ higher and $> ₹1,000$ increase, display an alert badge / warning banner.
- **Unusual Payments Section:**
  - Highlight transactions that deviate significantly from expected subscription amounts or recent price changes.

---

## 3. Database Queries & Aggregations

All queries strictly filter by `user_id = ?` and `is_expense = 1`:

```sql
-- 1. Current Month Total Spend
SELECT COALESCE(SUM(amount), 0) AS current_month_total
FROM transactions
WHERE user_id = ? 
  AND is_expense = 1 
  AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now');

-- 2. Spending Trends (Past 6 Months)
SELECT strftime('%Y-%m', date) AS month, COALESCE(SUM(amount), 0) AS total_amount
FROM transactions
WHERE user_id = ? 
  AND is_expense = 1 
  AND date >= date('now', '-6 months')
GROUP BY month
ORDER BY month ASC;

-- 3. Category Spending Breakdown for Current Month
SELECT category, COALESCE(SUM(amount), 0) AS total_amount, COUNT(id) AS transaction_count
FROM transactions
WHERE user_id = ? 
  AND is_expense = 1 
  AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
GROUP BY category
ORDER BY total_amount DESC;

-- 4. Active Subscriptions Metric
SELECT COUNT(id) AS sub_count, COALESCE(SUM(monthly_amount), 0) AS total_monthly_cost
FROM recurring_payments
WHERE user_id = ? AND status = 'active';
```

---

## 4. API Endpoints Specification

| Method | Endpoint | Auth | Description | Query Parameters | Response (Success) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/analytics/dashboard` | Bearer | Combined dashboard payload | `month=YYYY-MM` (optional) | `200 OK`: `{ "currentMonthSpend": 32450, "prevMonthSpend": 29800, "subscriptionCount": 5, "subscriptionMonthlyCost": 2490, "trends": [...], "categories": [...], "spikes": [...] }` |
| `GET` | `/api/analytics/trends` | Bearer | Monthly spending history | `months=6` | `200 OK`: `{ "months": ["2026-05", "2026-06", ...], "data": [28000, 31200, ...] }` |
| `GET` | `/api/analytics/categories` | Bearer | Category distribution | `month=YYYY-MM` | `200 OK`: `{ "categories": [{ "category": "Food", "amount": 12500, "percentage": 38.5 }, ...] }` |
| `GET` | `/api/transactions` | Bearer | Paginated transactions | `page=1&limit=20&search=swiggy&category=Food&startDate=...&endDate=...` | `200 OK`: `{ "transactions": [...], "total": 142, "page": 1, "totalPages": 8 }` |

---

## 5. UI Layout & Wireframe

```
+-----------------------------------------------------------------------------------+
|  SpendGuard           [Dashboard]  [Transactions]  [Subscriptions]  [Calendar]    |
+-----------------------------------------------------------------------------------+
|  METRICS ROW                                                                      |
|  [ Current Month Spend ]   [ Active Subscriptions ]   [ Monthly Recurring ]       |
|    ₹32,450.00 (+8.2%)        5 Subscriptions            ₹2,490.00 / mo            |
+-----------------------------------------------------------------------------------+
|  CHARTS ROW                                                                       |
|  +---------------------------------------+  +------------------------------------+|
|  | Monthly Spending Trends (Last 6 Mos) |  | Category Breakdown (This Month)    ||
|  | [ Bar / Line Graph Rendering ]        |  | [ Donut Chart & Ranked List ]      ||
|  +---------------------------------------+  +------------------------------------+|
+-----------------------------------------------------------------------------------+
|  INSIGHTS & ANOMALIES (Optional)                                                  |
|  ⚠️ Category Spike: Shopping is up 64% compared to last month (₹14,200 vs ₹8,650) |
|  💡 Price Change Alert: Netflix subscription updated from ₹649 to ₹799/month      |
+-----------------------------------------------------------------------------------+
|  RECENT TRANSACTIONS TABLE                                   [ View All -> ]      |
|  Date       | Merchant    | Category      | Amount (₹)                            |
|  2026-10-02 | Swiggy      | Food          | ₹450.00                               |
|  2026-10-01 | Netflix     | Subscriptions | ₹649.00                               |
+-----------------------------------------------------------------------------------+
```

---

## 6. Implementation Steps

1. **Analytics Controller & Service (`backend/services/analytics.service.js`):**
   - Implement optimized SQLite queries using indexes (`idx_txn_user_date`, `idx_txn_user_category`).
   - Calculate percentage differences between consecutive months.
   - Implement category spike detector comparing current month against the prior month.
2. **Transactions API Controller:**
   - Support dynamic SQL `WHERE` clauses for search term, category filter, and date boundaries.
   - Implement pagination with `LIMIT ? OFFSET ?`.
3. **Frontend Dashboard UI (`dashboard.html` / `dashboard.js`):**
   - Utilize Chart.js (via local vendored JS or lightweight script tag) with dark mode / glassmorphic theme palette.
   - Create interactive stat cards with formatted currency (e.g. `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`).
   - Render category donut chart and dynamic progress bars.
4. **Transactions Page UI (`transactions.html` / `transactions.js`):**
   - Debounced search input (300ms debounce).
   - Category pill filters and date range selectors.
   - Responsive table with pagination controls.

---

## 7. Test Cases & Verification Checklist

- [ ] **TC-01:** Dashboard loads and renders all cards and charts within 3 seconds.
- [ ] **TC-02:** Current month spend accurately totals all debits for the current calendar month.
- [ ] **TC-03:** Spending trends correctly aggregate the prior 6 months chronologically.
- [ ] **TC-04:** Category breakdown percentages sum to 100%.
- [ ] **TC-05:** Transactions page search filters by merchant name and description case-insensitively.
- [ ] **TC-06:** Category filter restricts transactions table exclusively to the selected category.
- [ ] **TC-07:** Date range filtering properly handles boundary dates.
- [ ] **TC-08:** Category spikes trigger when spending exceeds 50% above the prior month.
