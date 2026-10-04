# Edge Cases & Failure Modes: Module 4 — Recurring Payment Detection

> **Module:** 04 — Recurring Payment Detection  
> **Source Documents:** [SRS_SpendGuard.pdf](file:///c:/Projects/project%20spendgaurd/SRS_SpendGuard.pdf), [content.md](file:///c:/Projects/project%20spendgaurd/content.md), [04_recurring_payment_detection.md](file:///c:/Projects/project%20spendgaurd/docs/plans/04_recurring_payment_detection.md)  
> **Target Path:** `docs/edge-cases/04_recurring_payment_detection.md`

---

## 1. Overview
Automated recurring payment detection turns raw transaction intervals into deterministic subscriptions. 

This document addresses complex real-world timing quirks, calendar month boundary drift, weekend settlement rollovers, currency exchange jitter, price revisions, churned subscriptions, and forward projection anomalies.

---

## 2. Calendar Timing & Interval Drift Edge Cases

### EC-4.1: End-of-Month Billing Variations (28 vs. 31 Days)
- **Scenario:** A user subscribes to a service on January 31st. Subsequent debits occur on:
  - Feb 28 (28 days later)
  - Mar 31 (31 days later)
  - Apr 30 (30 days later)
  - May 31 (31 days later)
- **Risk:** Calculating a strict 30-day delta causes interval checks to fail because deltas fluctuate between 28 and 31 days.
- **Expected Behavior:** 
  - Monthly detection window must accept intervals between 26 and 35 days.
  - Detect "end-of-month" billing pattern: if transactions always fall on the last calendar day of their respective month, project `next_expected_date` to the last day of the subsequent month.

### EC-4.2: Weekend & Bank Holiday Settlement Rollover
- **Scenario:** A subscription billing date is the 10th of every month. In August, August 10th is a Sunday; the bank processes the debit on Monday, August 11th. In September, the 10th is a Wednesday.
- **Risk:** Day interval between August 11 and September 10 is 30 days, but between July 10 and August 11 was 32 days.
- **Expected Behavior:** 
  - Jitter tolerance: allow $\pm 4$ days on monthly intervals, $\pm 2$ days on weekly intervals, and $\pm 10$ days on yearly intervals.
  - Compute the median day delta across all consecutive pairs rather than strict mathematical equality.

### EC-4.3: Leap Years (February 29th Billing)
- **Scenario:** A leap year annual or monthly subscription renewal on Feb 29.
- **Expected Behavior:** 
  - In non-leap years, rollover to Feb 28 (or Mar 1 based on institution rules) without throwing an invalid date exception in JavaScript date math.

---

## 3. History Length & Frequency Anomalies

### EC-4.4: Insufficient History (< 2 Transactions)
- **Scenario:** A user imports a 1-month CSV containing a single Netflix charge of ₹649.
- **Risk:** Without a second transaction, no interval $\Delta d$ can be computed.
- **Expected Behavior:** 
  - Minimum requirement: at least 2 distinct transaction dates for a merchant.
  - If only 1 transaction exists, do not auto-classify as a recurring subscription (unless manually added by the user or matched against known subscription merchants during future roadmap phases).

### EC-4.5: Multiple Transactions on the Same Day ($\Delta d = 0$)
- **Scenario:** A user orders food on Swiggy twice on October 2nd, and once on October 4th.
- **Risk:** Consecutive date difference is 0 days, which distorts the average delta toward false weekly/daily intervals.
- **Expected Behavior:** 
  - Group transactions by unique date per merchant before computing deltas. Multiple purchases on the same calendar date do not represent recurring subscriptions.

### EC-4.6: Highly Irregular Gap Outliers
- **Scenario:** Transactions for a merchant occur on Jan 10, Feb 10, Mar 10, then a random one-off purchase on Jul 15, then Nov 20.
- **Risk:** The irregular gaps corrupt the regular monthly cadence.
- **Expected Behavior:** 
  - Use median and interquartile delta filtering. If $\ge 70\%$ of consecutive intervals conform to a regular cadence ($\approx 30$ days), confirm the subscription and discard the outlier.

---

## 4. Amount Fluctuations & Price Changes

### EC-4.7: Forex and Micro-Tax Variance
- **Scenario:** An international subscription ($10 USD) fluctuates in INR due to foreign exchange rates: ₹826.50 in July, ₹834.10 in August, ₹829.80 in September.
- **Risk:** Strict equality checks (`amount1 === amount2`) fail to detect the subscription.
- **Expected Behavior:** 
  - Allow an amount variance threshold: if the standard deviation is $\le 5\%$ of the mean, confirm as the same recurring subscription.
  - Set the expected amount to the latest charge amount.

### EC-4.8: Subscription Price Hikes & Introductory Discounts
- **Scenario:** 
  1. A user pays ₹199 for month 1 (introductory promo), then ₹649 in months 2, 3, 4.
  2. Netflix raises its monthly tier from ₹649 to ₹799.
- **Risk:** The detector reports an average amount (e.g. ₹724) rather than the active subscription cost.
- **Expected Behavior:** 
  - If the last transaction differs significantly ($> 10\%$) from prior history, but the date interval remains steady:
    - Flag `price_changed = 1`.
    - Update `amount` to the **latest transaction amount** (₹799), NOT the mathematical average.

---

## 5. Lifecycle & Forward Projection

### EC-4.9: Churned or Cancelled Subscriptions
- **Scenario:** A user had an active gym subscription from Jan to May. They cancelled in June. Today is October 2026.
- **Risk:** SpendGuard assumes the subscription is still active and generates false renewal alerts for November.
- **Expected Behavior:** 
  - Stale check: if `today - last_payment_date > 2.0 * interval_days`, mark status as `'cancelled'` or `'lapsed'` rather than `'active'`.
  - Do not schedule upcoming alerts for lapsed subscriptions unless renewed by a new transaction import.

### EC-4.10: Projecting Forward Across Lapsed Months
- **Scenario:** User imports historical data from 6 months ago (last payment date: 2026-04-10, interval: monthly). Today is 2026-10-04.
- **Risk:** `next_expected_date` is calculated as `2026-05-10`, which is already in the past!
- **Expected Behavior:** 
  - Projection loop: advance `next_expected_date` iteratively by the interval cadence until `next_expected_date >= today`:
    ```javascript
    let nextDate = new Date(lastPaymentDate);
    while (nextDate < today) {
      nextDate = addInterval(nextDate, interval);
    }
    ```

---

## 6. Summary Matrix

| ID | Edge Case | Severity | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **EC-4.1** | End-of-month billing (28-31d) | High | 26–35 day monthly window + end-of-month lock detection. |
| **EC-4.2** | Weekend settlement rollover | High | Jitter tolerance ($\pm 4$ days) and median delta matching. |
| **EC-4.3** | Leap year Feb 29 renewals | Low | Clamping date overflow to Feb 28 in non-leap years. |
| **EC-4.4** | Single transaction (< 2 records) | Medium | Require $\ge 2$ historical transactions to confirm pattern. |
| **EC-4.5** | Same-day transactions ($\Delta d = 0$) | High | Deduplicate dates per merchant before computing deltas. |
| **EC-4.6** | Sporadic outlier transactions | Medium | Median filtering and cadence consistency ratio ($\ge 70\%$). |
| **EC-4.7** | Forex / tax micro-fluctuations | High | Allow $\le 5\%$ variance without breaking subscription match. |
| **EC-4.8** | Price hike (₹649 $\to$ ₹799) | Critical | Flag `price_changed = 1`; lock expected amount to latest txn. |
| **EC-4.9** | Cancelled / inactive subscriptions | High | Auto-lapse status if inactive $> 2 \times$ interval duration. |
| **EC-4.10**| Forward projection into future | Critical | Iteratively advance projected date until $> \text{today}$. |
