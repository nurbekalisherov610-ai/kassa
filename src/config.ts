import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
    BOT_TOKEN: process.env.BOT_TOKEN || '',
    GOOGLE_CREDENTIALS: process.env.GOOGLE_CREDENTIALS || '',
    SPREADSHEET_ID: process.env.SPREADSHEET_ID || '',
    CHANNEL_ID: process.env.CHANNEL_ID || '',
    CHANNEL_THREAD_ID: parsePositiveInteger(process.env.CHANNEL_THREAD_ID),
    ADMIN_IDS: (process.env.ADMIN_IDS || '').split(',').map(Number).filter(n => !isNaN(n)),
    MANAGER_IDS: (process.env.MANAGER_IDS || '').split(',').map(Number).filter(n => !isNaN(n)),
    TIMEZONE: 'Asia/Tashkent',
    MORNING_REMINDER_CRON: '0 9 * * 1-6',    // 09:00 Mon-Sat
    EVENING_REMINDER_CRON: '0 17 * * 1-6',   // 17:00 Mon-Sat
    DASHBOARD_SHEET_NAME: process.env.DASHBOARD_SHEET_NAME || 'Dashboard',
};

// Mutable runtime settings (can be changed by admin)
export const runtimeConfig = {
    customReminderText: '',
};

// Validation
const required = ['BOT_TOKEN', 'SPREADSHEET_ID', 'GOOGLE_CREDENTIALS'];
const missing = required.filter(key => !process.env[key]);

if (missing.length > 0) {
    console.warn(`⚠️ Muhim muhit o'zgaruvchilari topilmadi: ${missing.join(', ')}`);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function assertProductionConfig(): void {
    const problems: string[] = [];

    if (!config.BOT_TOKEN) problems.push('BOT_TOKEN is missing');
    if (!config.SPREADSHEET_ID) problems.push('SPREADSHEET_ID is missing');
    if (!config.GOOGLE_CREDENTIALS) problems.push('GOOGLE_CREDENTIALS is missing');
    if (config.GOOGLE_CREDENTIALS.trim() === '{') {
        problems.push(
            'GOOGLE_CREDENTIALS is incomplete. Use one-line JSON in Railway or a service-account JSON file path locally'
        );
    }
    if (config.ADMIN_IDS.length === 0) problems.push('ADMIN_IDS is empty');
    if (config.MANAGER_IDS.length === 0) {
        problems.push('MANAGER_IDS is empty; this would allow any Telegram user to access the staff bot');
    }

    if (problems.length > 0) {
        throw new Error(`Invalid production configuration:\n- ${problems.join('\n- ')}`);
    }
}
