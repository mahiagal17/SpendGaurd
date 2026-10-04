# Implementation Plan: Module 1 — Authentication & User Isolation

> **Module:** 01 — Authentication  
> **Source Documents:** [SRS_SpendGuard.pdf](file:///c:/Projects/project%20spendgaurd/SRS_SpendGuard.pdf), [content.md](file:///c:/Projects/project%20spendgaurd/content.md)  
> **Target Path:** `docs/plans/01_authentication.md`

---

## 1. Overview & Objectives
Provide a secure, lightweight authentication system ensuring complete multi-tenant data isolation. Each user (individual or small team account) registers with name, email, and password, and receives a secure session token (JWT or HTTP-only cookie). All subsequent database queries are strictly scoped to the authenticated user's ID.

---

## 2. Requirements & Scope

### Core Requirements
- **User Registration:** Form accepting `name`, `email`, `password`. Validate email format, password strength ($\ge 6$ characters), and check for unique email.
- **Password Hashing:** Passwords must never be stored in plain text. Use `bcryptjs` with a salt factor of 10 or 12.
- **User Login:** Authenticate credentials, issue a secure JWT containing `{ userId: user.id, email: user.email }`.
- **Auth Middleware (`requireAuth`):** Express middleware to verify token from `Authorization: Bearer <token>` header or HTTP-only cookie, and attach `req.userId` to incoming requests. Return `401 Unauthorized` on missing or invalid tokens.
- **Tenant Data Isolation:** Ensure every database query (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) includes `WHERE user_id = ?`.

### Optional Features
- **Account & Data Deletion (`DELETE /api/auth/me`):** Cascade delete all transactions, recurring payments, alerts, and user record upon confirmation.

---

## 3. Database Schema

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
```

---

## 4. API Endpoints Specification

| Method | Endpoint | Auth | Description | Payload / Query | Response (Success) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Create new account | `{ "name": "...", "email": "...", "password": "..." }` | `201 Created`: `{ "token": "...", "user": { "id": 1, "name": "...", "email": "..." } }` |
| `POST` | `/api/auth/login` | Public | Authenticate user | `{ "email": "...", "password": "..." }` | `200 OK`: `{ "token": "...", "user": { "id": 1, "name": "...", "email": "..." } }` |
| `GET` | `/api/auth/me` | Bearer Token | Fetch current user session | None | `200 OK`: `{ "user": { "id": 1, "name": "...", "email": "..." } }` |
| `DELETE` | `/api/auth/me` | Bearer Token | Delete account & cascade data (Optional) | `{ "password": "..." }` | `200 OK`: `{ "message": "Account successfully deleted" }` |

### Error Responses
- `400 Bad Request`: Validation failure (missing fields, invalid email format, password too short).
- `409 Conflict`: Email already registered.
- `401 Unauthorized`: Invalid email/password, or missing/expired token.

---

## 5. Architecture & File Structure

```
backend/
├── db/
│   └── database.js               # SQLite connection & schema initialization
├── middleware/
│   └── auth.js                   # requireAuth middleware (JWT verification)
├── routes/
│   └── auth.routes.js            # Express router for /api/auth/*
└── controllers/
    └── auth.controller.js        # Controller functions (register, login, getMe, deleteAccount)
frontend/
├── public/
│   ├── login.html                # Login page
│   ├── register.html             # Registration page
│   ├── css/
│   │   └── auth.css              # Styled modern glassmorphic auth cards
│   └── js/
│       ├── api.js                # Common fetch client attaching Bearer token
│       └── auth.js               # Form handlers for login & registration
```

---

## 6. Implementation Steps

1. **Environment & Secrets:**
   - Configure `.env` with `PORT=3000`, `JWT_SECRET=super_secret_jwt_key_spendguard`, `DATABASE_PATH=./data/spendguard.db`.
2. **Database Initialization:**
   - Write migration/init script in `backend/db/database.js` executing the `users` table creation statement.
3. **Authentication Controller:**
   - `register`: Normalize email (`trim().toLowerCase()`), validate inputs, hash password with `bcrypt.hash(password, 10)`, insert into SQLite, generate JWT, return response.
   - `login`: Fetch user by email, compare password with `bcrypt.compare()`, generate JWT, return user profile & token.
   - `getMe`: Return current user profile omitting `password_hash`.
4. **Auth Middleware:**
   - Extract `Authorization` header, parse Bearer token, verify via `jwt.verify(token, JWT_SECRET)`, bind `req.userId = decoded.userId`.
5. **Frontend UI:**
   - Build clean, accessible forms in `login.html` and `register.html` with floating labels, validation states, and clear error banners.
   - Store token in `localStorage` on successful login/signup and redirect to `/dashboard`.
   - Implement `logout()` helper clearing token and redirecting to `/login`.

---

## 7. Test Cases & Verification Checklist

- [ ] **TC-01:** Registration with valid data creates user in SQLite and returns JWT.
- [ ] **TC-02:** Registration with existing email returns `409 Conflict` with clear error message.
- [ ] **TC-03:** Password is stored as a bcrypt hash, never plain text.
- [ ] **TC-04:** Login with valid credentials succeeds and returns JWT.
- [ ] **TC-05:** Login with wrong password returns `401 Unauthorized` without revealing whether the email exists.
- [ ] **TC-06:** Protected routes reject requests without a valid `Bearer` token.
- [ ] **TC-07:** Protected routes successfully grant access and accurately extract `req.userId`.
- [ ] **TC-08:** (Optional) Account deletion removes the user and all associated records from SQLite.
