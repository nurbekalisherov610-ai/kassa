import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
    BOT_TOKEN: process.env.BOT_TOKEN || '',
    GOOGLE_CREDENTIALS: process.env.GOOGLE_CREDENTIALS || '',
    SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
    CHANNEL_ID: process.env.CHANNEL_ID || '',
    ADMIN_IDS: (process.env.ADMIN_IDS || '').split(',').map(Number).filter(n => !isNaN(n)),
    MANAGER_IDS: (process.env.MANAGER_IDS || '').split(',').map(Number).filter(n => !isNaN(n)),
    MONTHLY_GOAL: parseInt(process.env.MONTHLY_GOAL || '10000', 10),
    TIMEZONE: 'Asia/Tashkent',
    MORNING_REMINDER_CRON: '0 9 * * 1-6',    // 09:00 Mon-Sat
    EVENING_REMINDER_CRON: '0 17 * * 1-6',   // 17:00 Mon-Sat
};

// Mutable runtime settings (can be changed by admin)
export const runtimeConfig = {
    monthlyGoal: config.MONTHLY_GOAL,
    customReminderText: '',
};

// Validation
const required = ['BOT_TOKEN', 'SPREADSHEET_ID', 'GOOGLE_CREDENTIALS'];
const missing = required.filter(key => !process.env[key]);

if (missing.length > 0) {
    console.warn(`⚠️ Muhim muhit o'zgaruvchilari topilmadi: ${missing.join(', ')}`);
}
