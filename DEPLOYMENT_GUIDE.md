# Railway deployment runbook

## Before deploying

1. Run `npm ci`, `npm test`, and `npm run build`.
2. Run `npm run test:data-flow` with valid local service-account credentials.
3. Confirm `npm audit` reports zero vulnerabilities.
4. Confirm Railway is configured for one replica.

## Google service account

Share the target Spreadsheet with the service-account email as Editor.

For local development:

```env
GOOGLE_CREDENTIALS=./service-account.json
```

For Railway, paste the complete service-account JSON as one line. Never commit the credential file or paste a multi-line JSON object directly into `.env`.

## Telegram sales group

Add the bot to the configured group/channel and grant permission to post. Set:

```env
CHANNEL_ID=-1001234567890
```

For a forum topic:

```env
CHANNEL_THREAD_ID=123
```

Startup calls `getChat`; an invalid or inaccessible destination stops deployment instead of silently losing notifications.

## Railway variables

```text
BOT_TOKEN
GOOGLE_CREDENTIALS
SPREADSHEET_ID
CHANNEL_ID
CHANNEL_THREAD_ID      optional
ADMIN_IDS
MANAGER_IDS
DASHBOARD_SHEET_NAME  optional
```

`MANAGER_IDS` must not be empty in production. The previous backward-compatible behavior allowed any Telegram user into the bot; startup now rejects that unsafe configuration.

## Health check

Configure Railway's healthcheck path as:

```text
/health
```

The endpoint returns 503 until Google Sheets, Users/Settings initialization, Telegram authentication, and sales-destination validation have completed.

## Release verification

1. Deployment stays healthy.
2. Logs show `Google Sheets`, `Savdo guruhi`, and `Boss dashboard`.
3. `/start` displays the staff menu.
4. `/admin` loads contract value, collected cash, debt, staff, and data-quality status.
5. A test sale appears exactly once in:
   - the sales ledger;
   - the configured Telegram destination;
   - the boss dashboard after refresh.
6. Updating payment changes both paid amount and debt in one Sheets request.
7. Cancelling the test sale removes it from active statistics.

## Rollback

Railway can redeploy the previous successful image. Data migrations are not automatic. The migration script creates a timestamped backup sheet before any rewrite, so row-level rollback remains possible.
