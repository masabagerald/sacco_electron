# SACCO Pro

A desktop management system for Savings and Credit Cooperative Organizations (SACCOs), built with Electron and MySQL.

## Features

- **Members** — register, search, update, and deactivate members
- **Savings** — record deposits and withdrawals, view balances and transaction history
- **Loans** — apply, approve/reject, and track repayments; automatic overdue detection
- **Calculator** — loan repayment schedule calculator
- **Reports** — member statements, savings summary, CSV export, and PDF print
- **Activity Log** — full audit trail of every action
- **Users** — role-based access (admin / user) with bcrypt password hashing
- **Dark mode** — persisted theme preference

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [MySQL](https://dev.mysql.com/downloads/mysql/) 5.7 or later (running locally)

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Configure the database connection**

Copy `.env.example` to `.env` and fill in your MySQL credentials:

```bash
cp .env.example .env
```

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=sacco_db
```

**3. Create the database and tables**

```bash
npm run setup-db
```

This creates the `sacco_db` database, all required tables, and a default admin account.

**4. Start the app**

```bash
npm start
```

## Default Login

| Username | Password  | Role  |
|----------|-----------|-------|
| admin    | admin123  | admin |

> Change the admin password after first login via **Users → Edit**.

## Project Structure

```
sacco_electron/
├── main.js          # Electron main process — window, IPC handlers, DB queries
├── preload.js       # Context bridge — exposes safe API to renderer
├── setup-db.js      # One-time DB setup script
├── renderer/
│   ├── index.html   # App shell (sidebar, topbar, modal, login overlay)
│   ├── js/app.js    # All renderer logic — pages, state, UI
│   └── css/app.css  # Custom styles (Tailwind utility classes + components)
└── .env             # DB credentials (not committed)
```

## Build (Windows installer)

```bash
npm run build
```

Produces a one-click NSIS installer in `dist/`. Requires no code-signing setup for local builds.

## Database Schema

| Table              | Purpose                                  |
|--------------------|------------------------------------------|
| `members`          | Member profiles                          |
| `savings`          | Deposit and withdrawal transactions      |
| `loans`            | Loan applications and approvals          |
| `loan_repayments`  | Repayment records per loan               |
| `activity_log`     | Audit trail (every write operation)      |
| `users`            | App user accounts with hashed passwords  |
