# Edge Cases & Failure Modes: Module 5 — Dashboard, Trends & Analytics

> **Module:** 05 — Dashboard and Trends  
> **Source Documents:** [SRS_SpendGuard.pdf](file:///c:/Projects/project%20spendgaurd/SRS_SpendGuard.pdf), [content.md](file:///c:/Projects/project%20spendgaurd/content.md), [05_dashboard_and_trends.md](file:///c:/Projects/project%20spendgaurd/docs/plans/05_dashboard_and_trends.md)  
> **Target Path:** `docs/edge-cases/05_dashboard_and_trends.md`

---

## 1. Overview
The Dashboard aggregates large amounts of financial data into charts, KPIs, and searchable lists. 

This document identifies edge cases concerning cold starts (zero data), division by zero, timezone discrepancies, massive financial outliers, category spike false alarms, and search/filter boundary conditions.

---

## 2. Cold Start & Zero-Data Scenarios

### EC-5.1: Fresh User Account with Zero Transactions
- **Scenario:** A new user registers and navigates directly to the dashboard before importing a CSV.
- **Risk:** Uncaught null pointer exceptions, `NaN` in metrics cards, broken empty charts, or ugly blank squares.
- **Expected Behavior:** 
  - All summary metrics default cleanly: `₹0.00` current spend, `0` active subscriptions, `₹0.00` monthly commitment.
  - Charts render an inviting empty state illustration with a clear call-to-action: *"No transactions found. Upload your first bank CSV to see insights."*

### EC-5.2: Division by Zero in Percentage Calculations
- **Scenario:** 
  1. Category percentage: `(categorySpend / totalSpend) * 100` when `totalSpend = 0`.
  2. Month-over-month growth: `((currentSpend - priorSpend) / priorSpend) * 100` when `priorSpend = 0`.
- **Risk:** JavaScript evaluates `0 / 0` as `NaN` and `x / 0` as `Infinity`, displaying `"NaN%"` or `"+Infinity%"` on dashboard badges.
- **Expected Behavior:** 
  - Guard clauses:
    ```javascript
    const growth = priorSpend > 0 ? ((currentSpend - priorSpend) / priorSpend) * 100 : null;
    const catPercent = totalSpend > 0 ? (catSpend / totalSpend) * 100 : 0;
    ```
  - Display `N/A` or hide growth indicators when baseline data is unavailable.

---

## 3. Timezone & Boundary Discrepancies

### EC-5.3: Server UTC vs. User IST (UTC+5:30) Month Boundary
- **Scenario:** A transaction occurs on October 31st at 11:30 PM IST. In UTC, the timestamp is October 31st at 18:00 (6:00 PM). If a server hosted in US-East or Europe runs queries using `strftime('%Y-%m', 'now')` in server local time or UTC, transactions near midnight may be tallied into the wrong calendar month.
- **Risk:** Discrepancy between the user's perception of their monthly spending and the dashboard total.
- **Expected Behavior:** 
  - Standardize all transaction date comparisons strictly using the explicit date string stored in `YYYY-MM-DD` (which reflects the bank's transaction date), rather than dynamic server UTC timestamps.
  - The client provides its current local month (`month=2026-10`) when fetching dashboard summaries.

### EC-5.4: Months with Missing Transactions in 6-Month Trends
- **Scenario:** A user imports statements for January, February, and May, but has no transactions in March and April.
- **Risk:** The SQL `GROUP BY strftime('%Y-%m', date)` query will only return 3 rows (`Jan`, `Feb`, `May`), resulting in an erratic line chart with missing intervals.
- **Expected Behavior:** 
  - The analytics service must zero-fill missing intermediate calendar months, returning a continuous 6-month array: `[{ month: 'Jan', amount: 15000 }, { month: 'Feb', amount: 18000 }, { month: 'Mar', amount: 0 }, { month: 'Apr', amount: 0 }, { month: 'May', amount: 22000 }]`.

---

## 4. Outliers & Anomaly Detection Edge Cases

### EC-5.5: Mega-Outlier Skewing Chart Visual Scales
- **Scenario:** A user pays a security deposit or purchase of ₹5,00,000 in one transaction, while typical monthly spend is ₹25,000.
- **Risk:** The vertical scale of the chart expands to ₹5,00,000, compressing normal monthly bars into invisible 1-pixel slivers.
- **Expected Behavior:** 
  - Offer log scale or interactive zoom/filter toggles on charts.
  - Tag extreme one-time transactions so users can optionally exclude them from recurring trend averages.

### EC-5.6: False-Alarm Category Spending Spikes
- **Scenario:** A user spent ₹0 on `Health` last month, and spends ₹150 this month on throat lozenges.
- **Risk:** Relative percentage increase is infinite, triggering an alarming "Spike detected in Health!" warning for a minor ₹150 expense.
- **Expected Behavior:** 
  - Dual threshold for spike warnings:
    1. Percentage increase $\ge 50\%$, **AND**
    2. Absolute monetary increase $> ₹1,000$ (or $5\%$ of total monthly spend).
  - Both criteria must be satisfied before triggering an alert banner.

---

## 5. Search, Filter & Pagination Edge Cases

### EC-5.7: SQL Injection and Wildcards in Transaction Search
- **Scenario:** A user searches for special characters in the transactions table: `%`, `_`, `'`, `\`, or `"; DROP TABLE transactions; --`.
- **Risk:** SQL injection or SQLite wildcard exhaustion (`%` matches every row, leading to high CPU usage).
- **Expected Behavior:** 
  - Always use parameterized queries (`?`).
  - Escape wildcard characters (`%`, `_`) when constructing SQL `LIKE ? ESCAPE '\'`:
    ```javascript
    const sanitizedSearch = searchTerm.replace(/[%_\\]/g, '\\$&');
    const query = `... WHERE merchant LIKE ? ESCAPE '\\' ...`;
    ```

### EC-5.8: Pagination Out-of-Bounds & Filter Resets
- **Scenario:** User is on page 5 of transactions. They apply a filter for category `"Bills"`, which only has 1 page of results.
- **Risk:** The API is requested with `page=5&category=Bills`, returning 0 results, making it look as though no bills exist.
- **Expected Behavior:** 
  - Frontend automatically resets `page = 1` whenever any filter or search query is altered.
  - Backend caps `page` at `Math.max(1, Math.min(requestedPage, totalPages))`.

### EC-5.9: Reversed Date Range (`startDate > endDate`)
- **Scenario:** A user sets From: `2026-10-31` and To: `2026-10-01`.
- **Expected Behavior:** 
  - Client-side validation prevents submission and highlights the invalid range.
  - Backend automatically swaps dates if `startDate > endDate` or returns `400 Bad Request` with an explicit error message.

---

## 6. Summary Matrix

| ID | Edge Case | Severity | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **EC-5.1** | Zero-data cold start | Medium | Graceful defaults (`₹0.00`) and empty-state visual illustrations. |
| **EC-5.2** | Division by zero (`NaN%`, `Infinity`) | High | Guard clauses returning `null` or `N/A` when denominator is 0. |
| **EC-5.3** | Server UTC vs. User IST boundaries | High | Rely on explicit `YYYY-MM-DD` strings, client-provided month. |
| **EC-5.4** | Missing intermediate months in trends | Medium | Zero-fill missing calendar months in the 6-month array. |
| **EC-5.5** | Mega-outlier distorting chart scale | Low | Log scale / zoom options and outlier exclusion toggles. |
| **EC-5.6** | Category spike on trivial amounts | Medium | Require dual condition: $\ge 50\%$ increase **AND** $> ₹1,000$. |
| **EC-5.7** | SQL wildcards in search (`%`, `_`) | High | Parameterized queries with explicit `ESCAPE '\'`. |
| **EC-5.8** | Pagination out-of-bounds on filter | Medium | Reset page to 1 on filter changes; backend page clamping. |
| **EC-5.9** | Inverted date range (`start > end`) | Low | Client-side validation + backend parameter order enforcement. |
