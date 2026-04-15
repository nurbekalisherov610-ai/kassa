# 🍋 Lemon Tour — Xodim Bot

Telegram bot for Lemon Tour sales managers. Tracks deals, provides personalized stats, and manages team performance.

## Features

- 🍋 **Visual Deal Wizard** — step-by-step inline keyboard wizard with progress bar
- 📊 **Personalized Stats** — per-manager statistics, leaderboard, goal tracking
- 👑 **Admin Panel** — reports, manager analytics, destination stats, broadcast
- 🌍 **16 Destinations** — Turkey, Dubai, Thailand, Vietnam, China, Malaysia, Bali, Qatar, Sharm el Sheikh, Georgia, Azerbaijan, Korea, Japan, Maldives, Saudi Arabia, India
- ⏰ **Automated Reminders** — morning motivation + evening report reminder
- 📄 **Google Sheets Integration** — all data saved to Google Sheets

## Setup

```bash
npm install
npm run build
npm start
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram Bot token from @BotFather |
| `GOOGLE_CREDENTIALS` | Path to service account JSON or JSON string |
| `SPREADSHEET_ID` | Google Sheets spreadsheet ID |
| `CHANNEL_ID` | Telegram channel ID for deal notifications |
| `ADMIN_IDS` | Comma-separated admin Telegram user IDs |
| `MONTHLY_GOAL` | Monthly sales goal in USD 
