# Edge Cases & Failure Modes: Module 1 — Authentication & User Isolation

> **Module:** 01 — Authentication  
> **Source Documents:** [SRS_SpendGuard.pdf](file:///c:/Projects/project%20spendgaurd/SRS_SpendGuard.pdf), [content.md](file:///c:/Projects/project%20spendgaurd/content.md), [01_authentication.md](file:///c:/Projects/project%20spendgaurd/docs/plans/01_authentication.md)  
> **Target Path:** `docs/edge-cases/01_authentication.md`

---

## 1. Overview
This document specifies the critical edge cases, security vulnerabilities, boundary conditions, and failure modes for the Authentication & User Isolation module, accompanied by expected behaviors and mitigation strategies.

---

## 2. Authentication & Credential Edge Cases

### EC-1.1: Email Casing and Leading/Trailing Whitespace
- **Scenario:** A user registers with `User@Example.com ` (with uppercase letters and trailing spaces) and subsequently attempts to log in with `user@example.com`.
- **Risk:** Authentication failure, duplicate account creation, or login confusion.
- **Expected Behavior:** 
  - All emails must be normalized on ingestion: `email.trim().toLowerCase()`.
  - The SQLite database index must enforce uniqueness on the normalized email string.

### EC-1.2: Plus-Addressing & Email Aliasing
- **Scenario:** A user registers with `john.doe+spendguard@gmail.com`.
- **Risk:** Strict email regexes might reject valid RFC-5322 email addresses containing `+`, `-`, or `.` characters.
- **Expected Behavior:** Email validation regex must conform to standard RFC specs (allowing `+`, `.`, `_`, `-`) while preventing invalid structures (`john..doe@gmail.com` or missing domain).

### EC-1.3: Bcrypt 72-Byte Truncation Vulnerability
- **Scenario:** A user supplies a passphrase longer than 72 bytes (or containing multi-byte UTF-8 emoji/characters exceeding 72 bytes).
- **Risk:** Standard `bcrypt` silently truncates input strings at 72 bytes. A password matching only up to byte 72 would authenticate successfully regardless of subsequent characters.
- **Expected Behavior:** 
  - Validate password length: minimum 6 characters, maximum 72 characters.
  - If longer passphrases must be supported, pre-hash with SHA-256 before feeding into `bcrypt`.

### EC-1.4: Empty, Whitespace-Only, or Malformed Passwords
- **Scenario:** Submitting a password composed entirely of spaces (`"      "`).
- **Risk:** Client-side trim might report it as empty, but naive backend checks verifying `password.length >= 6` would accept it.
- **Expected Behavior:** Backend validation must assert `password.trim().length >= 6` before hashing.

---

## 3. Session & Token Edge Cases

### EC-1.5: Malformed or Missing Authorization Header
- **Scenario:** Requests containing:
  - No header
  - `Authorization: ""`
  - `Authorization: Bearer` (no token)
  - `Authorization: Bearer undefined` or `Bearer null` (common frontend bugs)
  - `Authorization: Basic xyz`
- **Expected Behavior:** 
  - Middleware splits header by space (`parts[1]`).
  - If parts length $\neq 2$ or token is `"undefined"` / `"null"`, return immediate `401 Unauthorized` with `{ "error": "Invalid or missing authentication token" }`.

### EC-1.6: Token Expiration & Secret Key Rotation
- **Scenario:** JWT expires while the user is actively filling out a CSV import mapping or reviewing transactions.
- **Expected Behavior:** 
  - Return `401 Unauthorized` with code `TOKEN_EXPIRED`.
  - Frontend interceptor intercepts `401`, clears local session state, and redirects to `/login` with a notice `"Your session has expired. Please log in again."`.

### EC-1.7: Tampered or Forged JWT Token
- **Scenario:** Malicious actor modifies the payload `userId` in the JWT without a valid signature, or signs it with a known weak secret (e.g., `"secret"`).
- **Expected Behavior:** 
  - `jwt.verify()` throws `JsonWebTokenError`.
  - Middleware rejects the request with `401 Unauthorized` and logs the security event.

---

## 4. Multi-Tenant Isolation & Security Boundaries

### EC-1.8: Insecure Direct Object References (IDOR)
- **Scenario:** User A (ID: 10) sends `PATCH /api/transactions/45` or `DELETE /api/recurring/12`, where transaction 45 belongs to User B (ID: 11).
- **Risk:** Cross-tenant data tampering or unauthorized access.
- **Expected Behavior:** 
  - Every modification or read query MUST include both entity ID and authenticated `userId`:
    ```sql
    UPDATE transactions SET category = ? WHERE id = ? AND user_id = ?;
    ```
  - If `changes === 0`, return `404 Not Found` (do not disclose whether the entity belongs to another tenant).

### EC-1.9: Race Condition on Concurrent Registrations
- **Scenario:** Two registration requests for `same.user@domain.com` arrive simultaneously at the exact millisecond.
- **Expected Behavior:** 
  - SQLite unique constraint `idx_users_email` stops the second transaction.
  - The backend catches `SQLITE_CONSTRAINT_UNIQUE` (code `SQLITE_CONSTRAINT`) and gracefully returns `409 Conflict` with `{ "error": "An account with this email already exists" }`.

---

## 5. Account Deletion & Cascading Cleanups (Optional Feature)

### EC-1.10: Orphaned Records on Account Deletion
- **Scenario:** User triggers `DELETE /api/auth/me`. User table row is deleted, but transactions, recurring payments, alerts, or cron references linger in the database.
- **Expected Behavior:** 
  - SQLite foreign key constraints must be actively enabled upon every connection: `PRAGMA foreign_keys = ON;`.
  - All child tables must declare `ON DELETE CASCADE`.
  - Ensure all database queries run inside a single transaction block (`BEGIN TRANSACTION ... COMMIT`).
  - Active cron scheduler memory references must immediately skip deleted user IDs.

---

## 6. Summary Matrix

| ID | Edge Case | Severity | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **EC-1.1** | Email casing / whitespace | Medium | `email.trim().toLowerCase()` before all DB queries. |
| **EC-1.2** | Plus-addressing in email | Low | Standard RFC-5322 regex validation. |
| **EC-1.3** | Bcrypt 72-byte truncation | High | Max length constraint (72 chars) or SHA-256 pre-hashing. |
| **EC-1.4** | Whitespace-only password | Medium | Validate `password.trim().length >= 6`. |
| **EC-1.5** | Malformed / null Bearer token | Medium | Explicit splitting & string validity guards in `requireAuth`. |
| **EC-1.6** | Expired session token | Medium | Clean `TOKEN_EXPIRED` status code and client-side redirect. |
| **EC-1.7** | Forged JWT / signature mismatch | Critical | Enforce strong `.env` secret and reject untrusted tokens. |
| **EC-1.8** | IDOR across tenant boundaries | Critical | Enforce `WHERE user_id = ?` on every query. |
| **EC-1.9** | Concurrent registration collision | Medium | Rely on SQLite `UNIQUE` index + catch `SQLITE_CONSTRAINT`. |
| **EC-1.10**| Incomplete cascade on deletion | High | Enforce `PRAGMA foreign_keys = ON` and `ON DELETE CASCADE`. |
