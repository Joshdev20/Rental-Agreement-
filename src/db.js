'use strict';

const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.pdfDir, { recursive: true });

const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL DEFAULT 'Administrator',
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    reference        TEXT NOT NULL UNIQUE,
    status           TEXT NOT NULL DEFAULT 'submitted',
    tenant_name      TEXT NOT NULL,
    tenant_email     TEXT NOT NULL,
    tenant_phone     TEXT,
    property_address TEXT NOT NULL,
    monthly_rent     REAL,
    lease_start      TEXT,
    lease_end        TEXT,
    payload          TEXT NOT NULL,
    pdf_path         TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_submissions_email ON submissions (tenant_email);

  CREATE TABLE IF NOT EXISTS notifications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    channel       TEXT NOT NULL,
    target        TEXT,
    status        TEXT NOT NULL,
    detail        TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_submission ON notifications (submission_id);

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

module.exports = db;
