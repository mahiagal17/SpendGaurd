# Edge Cases & Failure Modes: Module 6 — Renewal Calendar & Alerting System

> **Module:** 06 — Renewal Calendar and Alerts  
> **Source Documents:** [SRS_SpendGuard.pdf](file:///c:/Projects/project%20spendgaurd/SRS_SpendGuard.pdf), [content.md](file:///c:/Projects/project%20spendgaurd/content.md), [06_renewal_calendar_and_alerts.md](file:///c:/Projects/project%20spendgaurd/docs/plans/06_renewal_calendar_and_alerts.md)  
> **Target Path:** `docs/edge-cases/06_renewal_calendar_and_alerts.md`

---

## 1. Overview
The Renewal Calendar and Alerts module combines automated background timers with user notifications and visual calendar mappings. 

This document analyzes edge cases involving missed cron triggers due to server downtime, alert deduplication race conditions, multiple renewals on identical dates, overdue/unconfirmed renewals, and calendar boundary rollovers.

---

## 2. Background Scheduler & Downtime Edge Cases

### EC-6.1: Missed Cron Job Trigger During Server Downtime
- **Scenario:** The cron schedule is configured for midnight (`0 0 * * *`). The server is restarted, deployed, or powered down from 23:55 to 00:15.
- **Risk:** The scheduled tick is missed entirely, and renewals due within the next 3 days never receive an alert.
- **Expected Behavior:** 
  - **Catch-up on Startup:** When the Express server initializes (`app.listen()`), run an immediate alert check before starting `node-cron`.
  - Because alert creation is idempotent (see EC-6.2), running this startup check is completely safe and guarantees no missed notifications.

### EC-6.2: Duplicate Alerts on Concurrent or Repeated Cron Runs
- **Scenario:** The cron job fires at midnight. Simultaneously, an automated test or user action calls `POST /api/alerts/cron-trigger`, or the user imports a new CSV that triggers an immediate alert sweep.
- **Risk:** The user receives 2 or 3 identical notifications: *"Netflix is due on 2026-10-07"*.
- **Expected Behavior:** 
  - Enforce a strict unique composite index at the database level:
    ```sql
    CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_unique_cycle 
    ON alerts(user_id, recurring_payment_id, renewal_date);
    ```
  - Use `INSERT OR IGNORE INTO alerts ...` or check existence before insertion. Duplicate insertions are rejected cleanly without error.

---

## 3. Date Math & Calendar Boundary Edge Cases

### EC-6.3: Multi-Month and Year-End Calendar Boundaries
- **Scenario:** Today is December 30th. Subscriptions are due on January 1st and January 2nd.
- **Risk:** Calculating `upcoming in 3 days` using month integers or naive string manipulation fails across year transitions (`Month 12` $\to$ `Month 1`).
- **Expected Behavior:** 
  - Use epoch day comparisons or SQLite standard date functions:
    ```sql
    WHERE next_expected_date BETWEEN date('now') AND date('now', '+3 days')
    ```
  - This natively handles leap years, variable month lengths (28, 30, 31 days), and year boundaries (`2026-12-30` $\to$ `2027-01-02`).

### EC-6.4: Multiple Renewals on the Same Calendar Date
- **Scenario:** On the 1st of the month, the user has 4 active subscriptions renewing: Netflix, Spotify, Amazon Prime, and Broadband.
- **Risk:** 
  - The calendar cell overflows vertically, breaking the grid layout.
  - Alerts are grouped clumsily or fail to display all 4 events.
- **Expected Behavior:** 
  - **Calendar UI:** Render the first 2 badges plus an overflow indicator: `"+2 more"`. Clicking the cell opens a modal listing all 4 subscriptions with amounts.
  - **Alerts Feed:** Create individual, distinct alert rows for each subscription so the user can acknowledge or read them independently.

---

## 4. Lifecycle & Overdue Renewals

### EC-6.5: Renewal Date Has Passed but No New CSV Uploaded
- **Scenario:** A subscription was expected on October 1st. Today is October 5th. The user has not yet uploaded October's bank statement.
- **Risk:** The subscription is displayed as "Due in -4 days", or the system continually alerts every day for a past date.
- **Expected Behavior:** 
  - Subscriptions with `next_expected_date < today` transition their badge from "Upcoming" to `"Awaiting Statement"` or `"Overdue"`.
  - The daily cron job ONLY queries `next_expected_date >= date('now')`. It never generates new alerts for dates that have already passed.

### EC-6.6: Orphaned Alerts on Subscription Deletion or Pause
- **Scenario:** User receives an alert: *"Gym membership due on Oct 10"*. On Oct 7, the user cancels and deletes the Gym subscription from SpendGuard.
- **Risk:** The alert remains in the notification center, referencing a deleted subscription ID (causing foreign key or null reference crashes).
- **Expected Behavior:** 
  - SQLite foreign key cascade (`ON DELETE CASCADE`) automatically purges related alerts.
  - If soft delete / pause is used, the alert is updated with an informational tag: `"(Subscription Paused)"`.

---

## 5. UI, Notification & Multi-Tab State

### EC-6.7: Unread Notification Badge Synchronization Across Tabs
- **Scenario:** A user opens SpendGuard in Tab 1 and Tab 2. In Tab 1, they click "Mark all as read". In Tab 2, the unread counter still shows `(3)`.
- **Expected Behavior:** 
  - Use the browser `BroadcastChannel` API or `window.addEventListener('storage', ...)` to broadcast notification status updates across tabs.
  - Tab 2 listens to the event and instantly updates its badge count to `0` without requiring a full page refresh.

### EC-6.8: Zero Renewals in Next 30 Days
- **Scenario:** A user has only quarterly or yearly subscriptions, none of which renew in the upcoming 30 days.
- **Risk:** The upcoming list renders as an empty blank box.
- **Expected Behavior:** 
  - Display a clear, positive empty-state card: *"No renewals due in the next 30 days. Your recurring expenses are clear until [Next Date, e.g. Dec 15]."*

---

## 6. Summary Matrix

| ID | Edge Case | Severity | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **EC-6.1** | Missed midnight cron during downtime | High | Execute alert catch-up verification on server startup. |
| **EC-6.2** | Concurrent / duplicate alert generation | Critical | Unique composite index `(user_id, sub_id, date)` + `INSERT OR IGNORE`. |
| **EC-6.3** | Year-end boundary (Dec 31 $\to$ Jan 2) | High | Standardized ISO date comparisons using `date('now', '+3 days')`. |
| **EC-6.4** | Multiple renewals on the exact same day | Medium | Calendar cell overflow truncation (`+N more`) + modal details. |
| **EC-6.5** | Overdue renewals awaiting statement | Medium | Filter cron to `date >= today`; flag UI as "Awaiting Statement". |
| **EC-6.6** | Orphaned alerts on subscription delete | High | Enforce `ON DELETE CASCADE` on `recurring_payment_id`. |
| **EC-6.7** | Badge sync across multiple browser tabs | Low | Cross-tab synchronization via `BroadcastChannel` or `storage` events. |
| **EC-6.8** | Zero renewals in next 30 days | Low | Informative empty-state with earliest upcoming renewal date. |
