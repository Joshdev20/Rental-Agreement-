#!/usr/bin/env node
'use strict';

/**
 * Create or reset an administrator account from the command line.
 *
 *   npm run create-admin -- --email owner@example.com --name "Owner" --password "secret12345"
 *
 * With no --password a strong one is generated and printed once.
 */

const crypto = require('crypto');
const auth = require('../src/lib/auth');
const config = require('../src/config');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function strongPassword() {
  const words = ['Ridge', 'Harbor', 'Copper', 'Willow', 'Summit', 'Quartz', 'Meadow', 'Lantern'];
  const pick = () => words[crypto.randomInt(words.length)];
  return `${pick()}-${pick()}-${crypto.randomInt(1000, 9999)}!`;
}

const args = parseArgs(process.argv.slice(2));
const email = String(args.email || config.admin.email).trim();
const name = String(args.name || config.admin.name).trim();
const password = args.password ? String(args.password) : strongPassword();

if (password.length < 10) {
  console.error('Password must be at least 10 characters.');
  process.exit(1);
}

const existing = auth.findAdminByEmail(email);
if (existing) {
  auth.changePassword(existing.id, password);
  console.log(`Updated password for ${existing.email}.`);
} else {
  const created = auth.createAdmin({ email, password, name });
  console.log(`Created administrator ${created.email}.`);
}

if (!args.password) {
  console.log(`Generated password: ${password}`);
  console.log('Store it somewhere safe now - it will not be shown again.');
}
