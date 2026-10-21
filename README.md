# Rental Agreement Desk

A professional US-style residential rental agreement you can fill in, sign and submit
online. The property manager is notified the moment a submission arrives, can read every
field the tenant entered, and can print or download the executed agreement as a PDF.

Tenants only fill in and submit the form. Everything else - storage, the PDF document and
admin access - happens on the server.

## What it does

**For tenants**

- A 10-section residential lease form (premises, term, rent, deposit, utilities,
  occupancy, rules, landlord, tenant, legal disclosures) covering 60+ fields.
- US conventions throughout: state list, ZIP validation, US currency and long-form dates.
- A draw-your-signature pad that works with mouse, finger or stylus.
- Live progress indicator, per-field validation and a printable blank copy.
- A confirmation screen with a reference number such as `RA-2026-4F7C21`.
- A status lookup page that needs the reference plus the email used on the form.

**For the admin (property manager)**

- A dashboard listing every submission with search, status filter and summary statistics.
- A detail page showing all entered values grouped by section, plus the drawn signature.
- The generated PDF embedded in the page for review.
- **Print** and **Download** buttons, and a **Regenerate PDF** action.
- Status workflow: submitted, reviewed, approved, declined, archived.
- CSV export of every submission for spreadsheets or record keeping.
- A notification log showing exactly what was sent, to where, and whether it succeeded.
- A **Settings** page for every external connection: SMTP, alert recipient, from address
  and webhook, each with a live test button and a reset to server defaults.
- Password change, session expiry after 8 hours, and login rate limiting.

**Notification on submission** happens over two optional channels, both off by default:

| Channel | Configure | Behaviour when unset |
| --- | --- | --- |
| Email | Settings page, or `SMTP_HOST` and friends | Attempt recorded as `skipped` |
| Webhook | Settings page, or `NOTIFY_WEBHOOK_URL` | Attempt recorded as `skipped` |

Notification problems never block or fail a tenant's submission, and every attempt is
logged in the dashboard so nothing fails silently.

## Quick start

Requires **Node.js 22.5 or newer** (it uses the built-in `node:sqlite` module).

```bash
npm install
cp .env.example .env      # then edit ADMIN_PASSWORD and SESSION_SECRET
npm start
```

Open:

- Tenant form - <http://localhost:12000/>
- Admin dashboard - <http://localhost:12000/admin>

On first boot, if no administrator exists, one is created from `ADMIN_EMAIL` and
`ADMIN_PASSWORD`. **Change the default password before deploying anywhere public.**

### Managing admins

```bash
# Create an admin, or reset an existing one's password
npm run create-admin -- --email owner@example.com --name "Owner Name" --password "a-long-password"

# Omit --password to have a strong one generated and printed once
npm run create-admin -- --email second@example.com
```

## Configuration

Every setting lives in `.env`. See `.env.example` for the full annotated list.
The `.env` values act as defaults: anything saved on the **Settings** page in the
dashboard overrides them, without a restart.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `12000` | HTTP port |
| `SESSION_SECRET` | random per boot | Signs admin session cookies. Set this in production or admins are signed out on restart. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | `admin@example.com` / `ChangeMe123!` | Seed admin, created only when no admin exists |
| `DATA_DIR` | `./data` | SQLite database and generated PDFs |
| `ADMIN_NOTIFY_EMAIL` | seed admin email | Recipient of submission alerts |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | empty | E-mail alerts |
| `NOTIFY_WEBHOOK_URL` | empty | JSON webhook, e.g. Slack, Zapier, Make, n8n |

### Settings page

Sign in and open **Settings** (<http://localhost:12000/admin/settings>) to manage every
external connection from the dashboard:

- SMTP host, port, TLS mode, username and password, the from address, and the alert recipient.
- The webhook URL for JSON submission alerts.
- **Send test email** and **Test webhook** buttons, which make a real connection and report
  the server's own response.
- **Reset to server defaults**, which drops the saved overrides and falls back to `.env`.
- Each field shows where its current value comes from: `Saved here`, `From server environment`, or `Default`.

Values are stored in the SQLite database, so they survive a restart. The SMTP password is
write-only: it is never sent back to the browser, a blank password field keeps the stored
one, and removing it takes an explicit checkbox.

Configuration precedence is **saved setting -> environment -> built-in default**.

### Webhook payload

```json
{
  "event": "rental_agreement.submitted",
  "reference": "RA-2026-4F7C21",
  "submittedAt": "2026-10-21T09:42:47.001Z",
  "tenant": { "name": "John Tenant", "email": "john@example.com", "phone": "5551234567" },
  "property": "1428 Elm Street, Apt 4B, Springfield, IL, 62704",
  "monthlyRent": 1850,
  "leaseStart": "2026-11-01",
  "leaseEnd": "2027-10-31",
  "adminUrl": "/admin/submissions/1"
}
```

## Tests

```bash
npm test
```

52 tests run against the real Express app, a real SQLite database, the real PDF generator,
a real SMTP conversation and a real HTTP webhook receiver. Nothing is mocked.

Coverage includes validation rules, field normalization, PDF structure and embedded
signatures, authentication and session tampering, authorization on every admin endpoint,
CSV escaping, notification delivery and failure handling, and the PNG integrity checks
described below.

## How it works

```
public/            Tenant form, admin dashboard, status lookup (vanilla JS, no build step)
src/lib/
  agreement-schema.js   Field definitions, validation, value formatting, PNG checks
  pdf.js                PDFKit renderer: US Letter, flowing layout, signature block
  submissions.js        SQLite data access
  notify.js             E-mail and webhook delivery
  auth.js               scrypt password hashing, signed session cookies
  agreement-service.js  Ties submission, PDF generation and notification together
src/routes/        Public API, admin auth, admin API
```

The field definitions in `agreement-schema.js` are the single source of truth. The browser
renders the form from `/api/form-schema`, and the same definitions drive server-side
validation, the PDF layout and the CSV export - so the form, the stored record and the
document cannot drift apart.

The PDF is generated at submission time, before the admin is notified, so the document is
always waiting when the alert arrives. PDFs live in `DATA_DIR/pdf/` and are re-rendered on
demand if the file is missing.

## Security notes

- **Passwords** are hashed with scrypt (N=16384) using a per-password random salt and
  compared in constant time.
- **Sessions** are stateless HMAC-SHA256 cookies. The token is verified in constant time
  and rejected if tampered with or expired.
- **Login** is rate limited to 8 failed attempts per IP per 15 minutes.
- **Every admin endpoint** requires authentication. API requests receive `401` with JSON
  rather than an HTML redirect, so clients never try to parse a login page.
- **Input is never trusted.** `normalize()` rebuilds the payload from the known field list,
  so unknown keys cannot be stored or reach the PDF. Values are validated for type, range
  and format, and rendered as text rather than HTML.
- **Signatures are integrity-checked.** PDFKit decodes embedded images during document
  flush, inside a zlib callback that no `try`/`catch` can reach - a corrupt PNG would abort
  the entire server process. Every signature is therefore validated first: PNG magic bytes,
  per-chunk CRC32, image dimensions, and a real inflate of the pixel stream. Only 8-bit,
  non-interlaced PNGs are accepted, and the PDF layer re-checks before embedding. This is
  covered by tests.
- Tenant status lookup requires both the reference and the matching email, so references
  cannot be enumerated.

Set `SESSION_SECRET` and use HTTPS (for example behind a reverse proxy) in production; the
session cookie is marked `secure` when `NODE_ENV=production`.

## Printing

- **Tenants** can print the blank form to review or sign by hand. The print stylesheet
  strips the navigation, buttons and progress UI, and renders inputs as clean underlined
  fields.
- **Admins** print the generated PDF, which is the executed document. It is US Letter
  (8.5" x 11"), roughly 5-7 pages, with a reference header, page footers, a utilities table,
  numbered legal clauses and a signature block with the drawn signature on the tenant side
  and a blank line for the landlord countersignature.

## Customising the agreement

Edit the `sections` array in `src/lib/agreement-schema.js`. Add or change a field and the
form, validation, PDF, CSV export and admin detail view all follow automatically. Supported
types: `text`, `email`, `tel`, `date`, `number`, `money`, `select`, `textarea`, `multi`,
`yesno`, `checkbox`, `signature`.

The standard legal clauses live in `STANDARD_CLAUSES` in `src/lib/pdf.js`.

## Legal disclaimer

This software produces a template agreement, not legal advice. Residential landlord-tenant
law varies by state and locality, and some jurisdictions require specific disclosures or
clause wording. Have a qualified attorney review the agreement before you use it.

## License

MIT
