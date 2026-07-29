# Lemon Tour Operations Bot

Production Telegram workflow for Lemon Tour sales, customer history, payment collection, debt control, staff statistics, and management reporting.

## What the system does

- Guides managers through a validated sale-entry workflow.
- Records every sale in Google Sheets with a collision-resistant sale ID and stable Telegram manager ID.
- Sends new sales to the configured Telegram group or forum topic.
- Shows personal sales, customers, debt, rankings, and search inside Telegram.
- Gives admins daily, weekly, monthly, all-time, manager, destination, and debt views.
- Builds and refreshes a formatted Google Sheets `Dashboard` tab for management.
- Exposes `/health` on Railway's assigned `PORT`.

## Required Railway variables

| Variable | Purpose |
| --- | --- |
| `BOT_TOKEN` | Token from BotFather |
| `GOOGLE_CREDENTIALS` | Complete one-line service-account JSON |
| `SPREADSHEET_ID` | Target Google Spreadsheet ID |
| `ADMIN_IDS` | Comma-separated Telegram numeric IDs |
| `MANAGER_IDS` | Comma-separated Telegram numeric IDs |
| `CHANNEL_ID` | Sales group/channel numeric ID, usually starting with `-100` |

Optional:

- `CHANNEL_THREAD_ID`: forum topic ID inside `CHANNEL_ID`.
- `DASHBOARD_SHEET_NAME`: defaults to `Dashboard`.

Never paste pretty-printed multi-line JSON directly after `GOOGLE_CREDENTIALS=` in a local `.env`. Use `GOOGLE_CREDENTIALS=./service-account.json` locally or one-line JSON in Railway.

## Commands

```bash
npm ci
npm test
npm run test:data-flow
npm run dashboard:refresh
npm run dev
```

`npm test` runs offline unit tests. `npm run test:data-flow` is read-only but requires valid Google credentials and now exits non-zero on authentication or Sheets failures.

## Production behavior

The service uses Telegram long polling. Run exactly one Railway replica; two replicas using the same bot token will conflict over `getUpdates`. Startup validates Telegram, Google Sheets, the configured notification destination, command menus, and access-control configuration before accepting work.

The executive dashboard refreshes:

- at startup;
- after a new sale;
- after payment or cancellation changes;
- every 30 minutes to catch manual Sheet edits;
- when an admin taps `Boss dashboard`.

## Safe migration

The legacy migration script is dry-run by default. Applying it requires both flags shown by the dry run. Before rewriting any row, it duplicates the source sheet as a timestamped backup.

```bash
npx ts-node src/scripts/migrate-data.ts
```

## Deployment

Railway deploys from the GitHub `main` branch. The Docker image uses Node 22, installs production dependencies with `npm ci`, runs as the non-root `node` user, and serves `GET /health`.

After deployment:

1. Confirm `/health` returns HTTP 200.
2. Check logs for successful Telegram, Google Sheets, and sales-group validation.
3. Open `/admin` and tap `Boss dashboard`.
4. Create one controlled test sale, confirm it appears once in the ledger and sales group, then cancel it from admin.
