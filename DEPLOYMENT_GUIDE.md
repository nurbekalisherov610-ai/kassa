# Lemon Tour Bot - Quick Deployment Guide

## Pre-Deployment Checklist

### 1. Environment Configuration ✅

Create or update `.env` file in project root:

```bash
# Required - Get from BotFather
BOT_TOKEN=your_telegram_bot_token_here

# Required - Get from your Google Sheet URL
SPREADSHEET_ID=your_google_sheet_id_here

# Required - Service account credentials JSON or a path to the JSON file
GOOGLE_CREDENTIALS='{"type":"service_account","project_id":"your-project",...}'

# Optional - For notifications
CHANNEL_ID=-1001234567890

# Optional - Admin Telegram IDs (comma-separated)
ADMIN_IDS=123456789,987654321

# Optional - Manager IDs (comma-separated, for access control)
MANAGER_IDS=123456789,987654321,111222333

# Optional - Monthly sales goal
MONTHLY_GOAL=10000
```

### 2. Google Sheets Setup ✅

**Important:** Share your Google Sheet with the service account:

1. Open your Google Sheet
2. Click "Share" button
3. Add email: `lemonkassa@lemonxodimlar.iam.gserviceaccount.com`
4. Set permission: **Editor**
5. Click "Send"

### 3. Build the Project ✅

```bash
# Install dependencies (if not already done)
npm install

# Build TypeScript to JavaScript
npm run build
```

### 4. Test Locally ✅

```bash
# Run the data flow test
npm run test:data-flow

# If test passes, start the bot in dev mode
npm run dev
```

**Expected Test Output:**
```
🧪 Starting Data Flow Test...

📥 Test 1: Reading data from Sheets...
   ✅ Retrieved X rows

📊 Test 2: Parsing deals...
   ✅ Parsed X valid deals

📈 Test 3: Getting overall stats...
   ✅ Today: X deals, $X
   ✅ This month: X deals, $X

... (all tests should pass)

✅ All tests passed!
```

## Deployment to Railway

### Option 1: Using Railway CLI (Recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Set environment variables
railway variables set BOT_TOKEN=your_token
railway variables set SPREADSHEET_ID=your_sheet_id
railway variables set GOOGLE_CREDENTIALS='{"type":"service_account",...}'
railway variables set CHANNEL_ID=your_channel_id
railway variables set ADMIN_IDS=123,456
railway variables set MANAGER_IDS=123,456,789
railway variables set MONTHLY_GOAL=10000

# Deploy
railway up
```

### Option 2: Using GitHub + Railway Dashboard

1. **Push to GitHub:**
```bash
git add .
git commit -m "Fix data saving and tracking issues"
git push origin main
```

2. **Connect to Railway:**
   - Go to https://railway.app/new
   - Select "Deploy from GitHub repo"
   - Choose your repository
   - Click "Deploy Now"

3. **Set Environment Variables:**
   - Go to your project in Railway dashboard
   - Click "Variables" tab
   - Add all variables from `.env` file

4. **Start Deployment:**
   - Railway will automatically deploy
   - Monitor deployment logs

### Option 3: Using Docker

```bash
# Build Docker image
docker build -t lemontour-bot .

# Run container
docker run -d \
  -e BOT_TOKEN=your_token \
  -e SPREADSHEET_ID=your_sheet_id \
  -e GOOGLE_CREDENTIALS='{"type":"service_account",...}' \
  -e CHANNEL_ID=your_channel_id \
  --name lemontour-bot \
  lemontour-bot
```

## Post-Deployment Verification

### 1. Check Bot Status

```bash
# View Railway logs
railway logs

# Or in Railway dashboard:
# Go to project -> Logs tab
```

**Expected Logs:**
```
✅ Bot ishga tushdi...
📥 Fetching data from sheet: Sheet1
📊 Retrieved X rows from Sheets
📊 Parsed X valid deals
```

### 2. Test Bot Functionality

**Test with Telegram:**
1. Open your bot in Telegram
2. Send `/start` command
3. Try creating a test deal with `/newdeal`
4. Check if data appears in Google Sheets
5. Check `/stats` command
6. Check `/mydeals` command

**Expected Behavior:**
- ✅ Bot responds to commands
- ✅ Deals save to Google Sheets
- ✅ Stats show correct data
- ✅ Leaderboard displays managers
- ✅ No errors in logs

### 3. Verify Data Integrity

**Check Google Sheets:**
1. Open your Google Sheet
2. Verify new rows appear
3. Check all columns are filled correctly
4. Verify manager usernames are saved
5. Check timestamps are correct

**Expected Sheet Format:**
```
| ID | Vaqt | Menejer | Mijoz | Telefon | Yo'nalish | Uchish | Qaytish | Narx ($) | To'langan ($) | Qarz ($) | Shartnoma | Izoh | Holat | Odamlar | Username |
|-----|-------|---------|--------|---------|------------|--------|---------|----------|---------------|----------|-----------|------|-------|--------|---------|
| LT-20260216-1234 | 16.02.2026, 15:30 | John | Client Name | +998901234567 | Dubai | 25.03.2026 | 01.04.2026 | 1200 | 800 | 400 | CONT-001 | Note | confirmed | 2 | @john |
```

## Monitoring and Maintenance

### Daily Checks

1. **Review Logs:**
   ```bash
   railway logs --lines 100
   ```

2. **Check Data:**
   - Open Google Sheets
   - Verify deals are saving
   - Check for duplicate entries
   - Verify manager stats accuracy

3. **Monitor Performance:**
   - Check response times
   - Monitor API rate limits
   - Review cache hit rate

### Weekly Maintenance

1. **Backup Data:**
   - Download Google Sheets as CSV
   - Save to secure location

2. **Review Statistics:**
   - Check leaderboard accuracy
   - Verify monthly goals
   - Review manager performance

3. **Update Configuration:**
   - Adjust monthly goal if needed
   - Add/remove manager IDs
   - Update admin list

## Troubleshooting

### Bot Not Starting

**Check:**
- ✅ BOT_TOKEN is correct
- ✅ SPREADSHEET_ID is correct
- ✅ GOOGLE_CREDENTIALS are valid
- ✅ Railway environment variables are set

**Solution:**
```bash
# Redeploy with correct variables
railway variables set BOT_TOKEN=new_token
railway up
```

### Data Not Saving

**Check:**
- ✅ Google Sheet is shared with service account
- ✅ Service account has Editor permission
- ✅ Sheet ID is correct
- ✅ No errors in logs

**Solution:**
1. Re-share Google Sheet with service account
2. Verify Editor permission
3. Check logs for specific error messages
4. Run test script: `npm run test:data-flow`

### Manager Stats Not Working

**Check:**
- ✅ Manager has Telegram username
- ✅ Username matches exactly
- ✅ Deals are in current month
- ✅ Date format is correct

**Solution:**
1. Check logs for username mismatch warnings
2. Verify manager's Telegram username
3. Check date format in Google Sheets
4. Review debug logs

### Performance Issues

**Check:**
- ✅ Caching is working (check logs)
- ✅ API rate limits not exceeded
- ✅ Railway has enough resources

**Solution:**
1. Upgrade Railway plan if needed
2. Increase cache TTL if needed
3. Monitor API usage
4. Check for memory leaks

## Support

### Getting Help

1. **Check Logs First:**
   - All issues are logged with details
   - Look for ❌ error messages
   - Check for ⚠️ warnings

2. **Run Test Script:**
   ```bash
   npm run test:data-flow
   ```

3. **Review Documentation:**
   - Read `FIXES_AND_IMPROVEMENTS.md`
   - Check this deployment guide
   - Review code comments

4. **Contact Support:**
   - Provide error logs
   - Describe the issue
   - Share test results

## Success Indicators

Your bot is working correctly when you see:

✅ **Logs:**
- Bot starts successfully
- Data fetches from Sheets
- Deals save without errors
- Cache invalidates after saves

✅ **Telegram:**
- Bot responds to commands
- Wizard completes successfully
- Stats display correctly
- Leaderboard shows managers

✅ **Google Sheets:**
- New deals appear immediately
- All columns filled correctly
- Manager usernames saved
- Timestamps are accurate

✅ **Performance:**
- Fast response times
- No API rate limit errors
- Cache hits frequently
- Smooth operation with 15+ managers

---

**Version:** 2.0.0
**Last Updated:** 2026-02-16
**Status:** ✅ Ready for Production
