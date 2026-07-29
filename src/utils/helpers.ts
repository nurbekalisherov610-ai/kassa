import { config } from '../config';
import { randomBytes } from 'crypto';

// ================ VALIDATION ================

export function isValidDate(text: string): boolean {
    return parseDateInput(text) !== null;
}

export function parseDateInput(text: string): Date | null {
    const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return null;

    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    const currentYear = Number(new Intl.DateTimeFormat('en', {
        timeZone: config.TIMEZONE,
        year: 'numeric',
    }).format(new Date()));

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (year < currentYear - 1 || year > currentYear + 10) return null;

    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCDate() === day && d.getUTCMonth() === month - 1 ? d : null;
}

export function isDateOnOrAfter(candidate: string, minimum: string): boolean {
    const candidateDate = parseDateInput(candidate);
    const minimumDate = parseDateInput(minimum);
    return !!candidateDate && !!minimumDate && candidateDate.getTime() >= minimumDate.getTime();
}

export function isValidPhone(text: string): boolean {
    const cleaned = text.replace(/[\s\-\(\)]/g, '');
    return /^\+?998\d{9}$/.test(cleaned) || /^\d{9,}$/.test(cleaned);
}

export function isValidPrice(text: string): boolean {
    if (text.includes('-')) return false;
    const cleaned = text.replace(/[^0-9.]/g, '');
    if ((cleaned.match(/\./g) || []).length > 1) return false;
    const num = parseFloat(cleaned);
    return !isNaN(num) && num >= 0 && num < 1000000;
}

export function isValidName(text: string): boolean {
    return text.length >= 2 && text.length <= 100 && !/^\d+$/.test(text);
}

// ================ FORMATTING ================

export function parsePrice(text: string): number {
    if (!isValidPrice(text)) return 0;
    const cleaned = text.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
}

export function generateDealId(): string {
    const dateParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        dateParts.find(item => item.type === type)?.value || '';
    const dateStr = `${part('year')}${part('month')}${part('day')}`;
    const suffix = randomBytes(4).toString('hex').toUpperCase();
    return `LT-${dateStr}-${suffix}`;
}

export function formatMoney(amount: number): string {
    if (amount >= 1000) {
        return `$${amount.toLocaleString('en-US')}`;
    }
    return `$${amount}`;
}

export function formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    return dateStr;
}

export function formatDateTime(date: Date): string {
    // FIXED: Use Intl.DateTimeFormat to ensure Asia/Tashkent timezone
    // regardless of server timezone (critical for Railway/cloud deployments)
    const options: Intl.DateTimeFormatOptions = {
        timeZone: 'Asia/Tashkent',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    };
    const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(date);
    const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
    return `${get('day')}.${get('month')}.${get('year')}, ${get('hour')}:${get('minute')}`;
}

export function isAdmin(userId: number, adminIds: number[]): boolean {
    return adminIds.includes(userId);
}

/**
 * Escapes Telegram Markdown v1 special characters in user-provided text.
 * In Markdown v1: _ = italic, * = bold, ` = code, [ = link
 * Usernames like @Madina_lemontour would break without this.
 */
export function escapeMd(text: string): string {
    if (!text) return '';
    return text.replace(/[_*`\[]/g, '\\$&');
}

export function escapeHtml(text: string): string {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function getTodayString(): string {
    return new Date().toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent' });
}

export function wizardProgress(step: number, total: number): string {
    const pct = Math.round((step / total) * 100);
    const filled = Math.round((step / total) * 12);
    const bar = '▓'.repeat(filled) + '░'.repeat(12 - filled);
    return `${bar} ${step}/${total}`;
}

// ================ DEAL CARD RENDERING ================

export function renderDealCard(deal: {
    clientName?: string;
    numberOfPeople?: number;
    departureDate?: string;
    returnDate?: string;
    contact?: string;
    price?: number;
    paidAmount?: number;
    destination?: string;
    contractNumber?: string;
    notes?: string;
    dealId?: string;
}): string {
    const lines: string[] = [];
    lines.push('┌────────────────────────────────┐');

    if (deal.clientName)
        lines.push(`│ 👤 *${escapeMd(deal.clientName)}*`);
    if (deal.numberOfPeople)
        lines.push(`│ 👥 *${deal.numberOfPeople} kishi*`);
    if (deal.departureDate && deal.returnDate)
        lines.push(`│ ✈️ ${deal.departureDate} → ${deal.returnDate}`);
    else if (deal.departureDate)
        lines.push(`│ ✈️ ${deal.departureDate}`);
    if (deal.contact)
        lines.push(`│ 📞 ${escapeMd(deal.contact)}`);
    if (deal.price)
        lines.push(`│ 💰 *${formatMoney(deal.price)}*`);
    if (deal.destination)
        lines.push(`│ 🌍 ${escapeMd(deal.destination)}`);
    if (deal.contractNumber)
        lines.push(`│ 📄 Shartnoma: *${escapeMd(deal.contractNumber)}*`);
    if (deal.price && deal.paidAmount !== undefined) {
        const debt = deal.price - deal.paidAmount;
        lines.push(`│ 💳 To'langan: *${formatMoney(deal.paidAmount)}*`);
        if (debt > 0)
            lines.push(`│ 📉 Qarz: *${formatMoney(debt)}* ⚠️`);
        else
            lines.push(`│ ✅ To'liq to'langan`);
    }
    if (deal.notes)
        lines.push(`│ 📝 ${escapeMd(deal.notes)}`);

    lines.push('└────────────────────────────────┘');
    return lines.join('\n');
}

export function renderWizardStep(
    stepNum: number,
    totalSteps: number,
    title: string,
    instruction: string,
    filledFields: { icon: string; label: string; value: string }[],
): string {
    let text = `📋 *Yangi savdo* (${stepNum}/${totalSteps})\n`;
    text += `${wizardProgress(stepNum - 1, totalSteps)}\n\n`;

    // Show completed fields
    if (filledFields.length > 0) {
        filledFields.forEach(f => {
            text += `✅ ${f.icon} ${escapeMd(f.label)}: *${escapeMd(f.value)}*\n`;
        });
        text += '\n';
    }

    text += `${title}\n`;
    text += `_${instruction}_`;

    return text;
}

export function renderSuccessMessage(
    deal: any,
    todayCount: number,
    todayTotal: number,
): string {
    return (
        `🎉 *SAVDO MUVAFFAQIYATLI!*\n\n` +
        `🆔 \`${deal.dealId}\`\n` +
        `💰 ${formatMoney(deal.price)} | 🌍 ${escapeMd(deal.destination)} | 👥 ${deal.numberOfPeople} kishi\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 Bugun: *${todayCount}-savdo* | *${formatMoney(todayTotal)}*\n` +
        `📈 Bugungi savdo oqimi yangilandi`
    );
}
