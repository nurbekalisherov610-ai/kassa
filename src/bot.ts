import { Bot, session, InputFile, InlineKeyboard } from 'grammy';
import { createServer, Server } from 'http';
import { config, runtimeConfig, assertProductionConfig } from './config';
import { MyContext, SessionData } from './types';
import { startWizard, handleWizardText, handleWizardCallback } from './scenes/dealWizard';
import { userService } from './services/userService';
import { sheetsService } from './services/sheets';
import { reportService } from './services/reportService';
import { dashboardService } from './services/dashboardService';
import { handleAdminCommand, handleAdminCallbacks, handleAdminTextInput } from './handlers/adminHandlers';
import { keyboards } from './utils/keyboard';
import { isAdmin, formatMoney, escapeMd, isValidPrice, parsePrice } from './utils/helpers';
import cron from 'node-cron';

// ================ SESSION ================

function initial(): SessionData {
    return {
        step: 'idle',
        adminStep: 'idle',
        tempDeal: {},
        wizardMessageId: undefined,
    };
}

// ================ BOT INIT ================

if (!config.BOT_TOKEN) {
    console.warn('⚠️ BOT_TOKEN topilmadi. Bot ishga tushmaydi.');
}

export const bot = new Bot<MyContext>(config.BOT_TOKEN || 'dummy_token');

// ================ MIDDLEWARE ================

bot.catch((err) => {
    console.error('❌ Bot xatosi:', err);
});

// Logging
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    const messageText = ctx.message?.text || '';
    const callbackData = ctx.callbackQuery?.data || '';
    if (messageText || callbackData) {
        const event = callbackData
            ? `callback:${callbackData.split(':').slice(0, 2).join(':')}`
            : messageText.startsWith('/')
                ? `command:${messageText.split(/\s/, 1)[0]}`
                : `text:${messageText.length}chars`;
        console.log(
            `[${new Date().toLocaleTimeString('uz-UZ', { timeZone: config.TIMEZONE })}] ` +
            `user=${userId || 'unknown'} event=${event}`
        );
    }
    await next();
});

// Access control — only admins + whitelisted managers
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const isAdm = config.ADMIN_IDS.includes(userId);
    const isManager = config.MANAGER_IDS.includes(userId);

    // If MANAGER_IDS is empty, allow everyone (backward compat)
    if (config.MANAGER_IDS.length > 0 && !isAdm && !isManager) {
        // Only block if they try to interact, not on every update
        if (ctx.message?.text || ctx.callbackQuery) {
            await ctx.reply(
                `\u26d4 *Sizda ruxsat yo'q*\n\n` +
                `Bu bot faqat Lemon Tour xodimlari uchun.\n` +
                `Sizning ID: \`${userId}\`\n\n` +
                `_Ruxsat olish uchun adminga murojaat qiling._`,
                { parse_mode: 'Markdown' }
            );
        }
        return;
    }

    await next();
});

// Track only authorized staff. Unauthorized users must never enter the Users sheet.
bot.use(async (ctx, next) => {
    if (ctx.from) {
        try {
            await userService.saveUser({
                id: ctx.from.id,
                name: ctx.from.first_name,
                username: ctx.from.username || '',
                role: isAdmin(ctx.from.id, config.ADMIN_IDS) ? 'admin' : undefined,
                lastActive: new Date().toISOString(),
            });
        } catch (e) {
            console.error('User save xato:', e);
        }
    }
    await next();
});

// Session
bot.use(session({ initial }));

// ================ COMMANDS ================

// /start — enhanced with personal stats
bot.command('start', async (ctx) => {
    ctx.session.step = 'idle';
    ctx.session.adminStep = 'idle';
    ctx.session.tempDeal = {};
    ctx.session.wizardMessageId = undefined;

    const name = ctx.from?.first_name || 'Foydalanuvchi';
    const isAdm = isAdmin(ctx.from?.id || 0, config.ADMIN_IDS);
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';

    let statsLine = '';
    if (username) {
        try {
            const stats = await sheetsService.getManagerStats({ id: ctx.from?.id, username });
            const leaderboard = await sheetsService.getLeaderboard();
            const rank = leaderboard.findIndex(m =>
                m.managerId
                    ? m.managerId === ctx.from?.id
                    : isSameUsernameLocal(m.username, username)
            ) + 1;
            const rankIcon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank > 0 ? `${rank}-o'rin` : '';

            if (stats.count > 0) {
                statsLine = `\n📊 Bu oy: *${stats.count} ta savdo* | *${formatMoney(stats.total)}*`;
                if (rankIcon) statsLine += ` | ${rankIcon}`;
                statsLine += '\n';
            }
        } catch {
            // Stats not critical
        }
    }

    const text =
        `🍋 *LEMON TOUR*\n\n` +
        `Xush kelibsiz, *${escapeMd(name)}*! 👋\n` +
        `${statsLine}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📝 Yangi savdolarni qayd qiling\n` +
        `📊 Shaxsiy statistikangizni ko'ring\n` +
        `📋 Savdolaringiz ro'yxatini tekshiring\n` +
        `👤 Mening CRM orqali mijozlarni boshqaring\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        (isAdm ? `\n👑 _Admin:_ /admin — boshqaruv paneli\n` : '') +
        `\n_Quyidagi tugmalardan foydalaning:_`;

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboards.main });
});

// /myid
bot.command('myid', async (ctx) => {
    await ctx.reply(`🆔 Sizning ID raqamingiz: \`${ctx.from?.id}\``, { parse_mode: 'Markdown' });
});

// /admin
bot.command('admin', handleAdminCommand);

// /newdeal
bot.command('newdeal', async (ctx) => {
    await startWizard(ctx);
});

// /stats
bot.command('stats', async (ctx) => {
    await handleStats(ctx);
});

// /mydeals
bot.command('mydeals', async (ctx) => {
    await handleMyDeals(ctx);
});

// /crm
bot.command('crm', async (ctx) => {
    await handleManagerCRM(ctx);
});

// /findclient
bot.command('findclient', async (ctx) => {
    const rawText = ctx.message?.text || '';
    const query = rawText.replace(/^\/findclient(@[a-zA-Z0-9_]+)?/i, '').trim();

    if (query) {
        await handleClientSearchQuery(ctx, query);
    } else {
        await startClientSearch(ctx);
    }
});

// /qarz
bot.command('qarz', async (ctx) => {
    await handleDebtList(ctx);
});

// /pdfreport
bot.command('pdfreport', async (ctx) => {
    if (!isAdmin(ctx.from?.id || 0, config.ADMIN_IDS)) {
        await ctx.reply('⛔ Sizda admin huquqi yo\'q.');
        return;
    }

    const msg = await ctx.reply('📄 PDF hisobot tayyorlanmoqda...');

    try {
        const pdfBuffer = await reportService.generateDailyReport();
        const date = new Date().toISOString().split('T')[0];
        await ctx.replyWithDocument(
            new InputFile(pdfBuffer, `LemonTour_Hisobot_${date}.pdf`)
        );
        await ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => { });
    } catch (e) {
        console.error('PDF xatolik:', e);
        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, '❌ PDF yaratishda xatolik.');
    }
});

// /help
bot.command('help', async (ctx) => {
    const isAdm = isAdmin(ctx.from?.id || 0, config.ADMIN_IDS);

    let text =
        `📖 *Yordam — Lemon Tour Bot*\n\n` +
        `*Asosiy buyruqlar:*\n` +
        `🍋 /newdeal — Yangi savdo\n` +
        `📊 /stats — Statistikam\n` +
        `📋 /mydeals — Savdolarim\n` +
        `💳 /qarz — Qarzli savdolarim\n` +
        `🆔 /myid — ID raqamim\n` +
        `📖 /help — Yordam\n\n` +
        `_Asosiy boshqaruv tugmalar orqali amalga oshiriladi (Mening CRM)._\n`;

    if (isAdm) {
        text += `\n*👑 Admin:*\n` +
            `🔧 /admin — Boshqaruv paneli\n` +
            `📄 /pdfreport — PDF hisobot\n`;
    }

    await ctx.reply(text, { parse_mode: 'Markdown' });
});

// ================ CALLBACKS ================

bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    // Wizard callbacks (wiz:*)
    if (data.startsWith('wiz:')) {
        const handled = await handleWizardCallback(ctx);
        if (handled) return;
    }

    // Admin callbacks (admin:*)
    if (data.startsWith('admin:')) {
        await handleAdminCallbacks(ctx);
        return;
    }

    // Manager CRM callbacks (mgr:*)
    if (data.startsWith('mgr:')) {
        await handleManagerCallbacks(ctx);
        return;
    }

    // Debt callbacks (debt:*)
    if (data.startsWith('debt:')) {
        const parts = data.split(':');
        const action = parts[1];
        const dealId = parts.slice(2).join(':');

        if (action === 'pay') {
            const isAdm = isAdmin(ctx.from?.id || 0, config.ADMIN_IDS);
            const deal = await sheetsService.getDealById(dealId);
            if (!deal) {
                await ctx.answerCallbackQuery({ text: '❌ Savdo topilmadi!' });
                return;
            }

            const isOwner = isDealOwner(ctx, deal);
            if (!isAdm && !isOwner) {
                await ctx.answerCallbackQuery({ text: '⛔ Bu savdo sizga tegishli emas!' });
                return;
            }

            // Manager wants to update payment
            ctx.session.step = 'debtPayment';
            ctx.session.debtContractId = dealId; // dealId stored
            await ctx.answerCallbackQuery({ text: '💳 Yangi to\'langan summani yozing...' });
            const kb = new InlineKeyboard().text('❌ Bekor qilish', 'mgr:main');
            await ctx.reply(
                `💳 *To'lov yangilash*\n\n` +
                `Savdo: \`${dealId}\`\n\n` +
                `_Yangi UMUMIY to'langan summani kiriting ($):_`,
                { parse_mode: 'Markdown', reply_markup: kb }
            );
            return;
        }

        if (action === 'close') {
            const isAdm = isAdmin(ctx.from?.id || 0, config.ADMIN_IDS);
            // Full payment — set paidAmount = price
            const deal = await sheetsService.getDealById(dealId);
            if (deal) {
                const isOwner = isDealOwner(ctx, deal);
                if (!isAdm && !isOwner) {
                    await ctx.answerCallbackQuery({ text: '⛔ Bu savdo sizga tegishli emas!' });
                    return;
                }

                const success = await sheetsService.updatePaidAmount(dealId, deal.price);
                if (success) {
                    void dashboardService.refresh().catch(error => {
                        console.error('Boss dashboard refresh error:', error);
                    });
                    await ctx.answerCallbackQuery({ text: '✅ Qarz yopildi!' });
                    await ctx.reply(
                        `✅ *Qarz to'liq yopildi!*\n\n` +
                        `🆔 \`${dealId}\`\n` +
                        `👤 ${deal.clientName}\n` +
                        `💰 ${formatMoney(deal.price)} to'liq to'landi`,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    await ctx.answerCallbackQuery({ text: '❌ Xatolik!' });
                }
            }
            return;
        }

        await ctx.answerCallbackQuery();
        return;
    }

    // Deal callbacks (deal:*)
    if (data.startsWith('deal:')) {
        const parts = data.split(':');
        const action = parts[1];
        const dealId = parts[2];

        if (!isAdmin(ctx.from?.id || 0, config.ADMIN_IDS)) {
            await ctx.answerCallbackQuery({ text: '⛔ Admin huquqi kerak!' });
            return;
        }

        if (action === 'view') {
            const deal = await sheetsService.getDealById(dealId);
            if (deal) {
                const text =
                    `📋 *Savdo:*\n\n` +
                    `🆔 \`${deal.dealId}\`\n` +
                    `👤 *${deal.clientName}*\n` +
                    `👥 ${deal.numberOfPeople} kishi\n` +
                    `✈️ ${deal.departureDate} → ${deal.returnDate}\n` +
                    `📞 ${deal.contact}\n` +
                    `🌍 ${deal.destination}\n` +
                    `💰 *${formatMoney(deal.price)}*\n` +
                    `📝 ${deal.notes || '-'}\n` +
                    `👱 ${deal.managerName} (${deal.managerUsername})\n` +
                    `📊 ${deal.status}`;
                await ctx.reply(text, { parse_mode: 'Markdown' });
            } else {
                await ctx.reply('❌ Savdo topilmadi.');
            }
        }

        if (action === 'delete') {
            const success = await sheetsService.cancelDeal(dealId);
            if (success) {
                void dashboardService.refresh().catch(error => {
                    console.error('Boss dashboard refresh error:', error);
                });
            }
            await ctx.reply(success
                ? `✅ Savdo \`${dealId}\` bekor qilindi.`
                : '❌ Savdoni bekor qilishda xatolik.',
                { parse_mode: 'Markdown' });
        }

        await ctx.answerCallbackQuery();
    }
});

// ================ TEXT MESSAGES ================

bot.on('message:text', async (ctx) => {
    const text = ctx.msg.text;

    // 1. Admin input (if admin step active)
    if (ctx.session.adminStep && ctx.session.adminStep !== 'idle') {
        const handled = await handleAdminTextInput(ctx);
        if (handled) return;
    }

    // 2. Debt payment input
    if (ctx.session.step === 'debtPayment' && ctx.session.debtContractId) {
        const dealId = ctx.session.debtContractId;
        const cancelText = text.trim().toLowerCase();
        if (
            cancelText === 'bekor' ||
            cancelText === 'cancel' ||
            cancelText === 'stop' ||
            text.trim() === '❌ Bekor qilish'
        ) {
            ctx.session.step = 'idle';
            ctx.session.debtContractId = undefined;
            await goMainMenu(ctx, '❌ To\'lov yangilash bekor qilindi.');
            return;
        }

        const amount = parsePrice(text);

        if (!isValidPrice(text) || !Number.isFinite(amount) || amount < 0) {
            await ctx.reply('⚠️ Noto\'g\'ri summa! Faqat raqam kiriting (masalan: 1200)');
            return;
        }

        const paymentDeal = await sheetsService.getDealById(dealId);
        if (!paymentDeal || amount > paymentDeal.price) {
            await ctx.reply(
                paymentDeal
                    ? `⚠️ To'langan summa savdo narxidan oshmasligi kerak (${formatMoney(paymentDeal.price)}).`
                    : '❌ Savdo topilmadi.'
            );
            return;
        }

        const success = await sheetsService.updatePaidAmount(dealId, amount);
        ctx.session.step = 'idle';
        ctx.session.debtContractId = undefined;

        if (success) {
            void dashboardService.refresh().catch(error => {
                console.error('Boss dashboard refresh error:', error);
            });
            const deal = await sheetsService.getDealById(dealId);
            const debt = deal ? deal.price - amount : 0;
            await ctx.reply(
                `✅ *To'lov yangilandi!*\n\n` +
                `🆔 \`${dealId}\`\n` +
                (deal ? `👤 ${deal.clientName}\n` : '') +
                `💳 To'langan: *${formatMoney(amount)}*\n` +
                (debt > 0 ? `📉 Qoldiq qarz: *${formatMoney(debt)}* ⚠️` : `✅ To'liq to'langan!`),
                { parse_mode: 'Markdown', reply_markup: keyboards.main }
            );
        } else {
            await ctx.reply('❌ To\'lov yangilashda xatolik.', { reply_markup: keyboards.main });
        }
        return;
    }

    // 3. Client search input
    if (ctx.session.step === 'clientSearch') {
        const query = text.trim();
        const cancelText = query.toLowerCase();
        if (
            cancelText === 'bekor' ||
            cancelText === 'cancel' ||
            cancelText === 'stop' ||
            query === '❌ Bekor qilish'
        ) {
            ctx.session.step = 'idle';
            await goMainMenu(ctx, '❌ Qidiruv bekor qilindi.');
            return;
        }

        if (!query) {
            await ctx.reply('⚠️ Qidiruv uchun mijoz ismi, telefon, shartnoma yoki ID yuboring.');
            return;
        }

        ctx.session.step = 'idle';
        await handleClientSearchQuery(ctx, query);
        return;
    }

    // 4. Wizard input (if wizard active)
    if (ctx.session.step && ctx.session.step !== 'idle') {
        const handled = await handleWizardText(ctx);
        if (handled) return;
    }

    // 5. Button handlers (idle state)
    switch (text) {
        case '🍋 Yangi savdo':
            await startWizard(ctx);
            break;

        case '📊 Mening statistikam':
            await handleStats(ctx);
            break;

        case '📋 Mening savdolarim':
            await handleMyDeals(ctx);
            break;

        case '👤 Mening CRM':
            await handleManagerCRM(ctx);
            break;

        case '💳 Qarzlar':
            await handleDebtList(ctx);
            break;

        default:
            await ctx.reply(
                '🤔 Tushunmadim.\n\nQuyidagi tugmalardan foydalaning yoki /help buyrug\'ini yuboring.',
                { reply_markup: keyboards.main }
            );
            break;
    }
});

// ================ STATS HANDLER ================

async function handleStats(ctx: MyContext) {
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';
    const firstName = ctx.from?.first_name || 'Menejer';

    const msg = await ctx.reply(`⏳ *${firstName}*, yuklanmoqda...`, { parse_mode: 'Markdown' });

    try {
        const identity = { id: ctx.from?.id, username };
        const monthlyStats = await sheetsService.getManagerStats(identity);
        const allTimeStats = await sheetsService.getManagerAllTimeStats(identity);
        const leaderboard = await sheetsService.getLeaderboard();
        const myDeals = await sheetsService.getManagerDeals(identity);

        // Ranking
        const rank = leaderboard.findIndex(m =>
            m.managerId
                ? m.managerId === ctx.from?.id
                : isSameUsernameLocal(m.username, username)
        ) + 1;
        const rankText = rank > 0 ?
            (rank === 1 ? '🥇 1-o\'rin' : rank === 2 ? '🥈 2-o\'rin' : rank === 3 ? '🥉 3-o\'rin' : `${rank}-o'rin`) :
            '—';

        // Average deal
        const avgDeal = monthlyStats.count > 0 ? Math.round(monthlyStats.total / monthlyStats.count) : 0;

        // Best deal & top destination
        let bestDeal = 0, bestDest = '';
        const destMap = new Map<string, number>();
        myDeals.forEach(d => {
            if (d.price > bestDeal) { bestDeal = d.price; bestDest = d.destination; }
            destMap.set(d.destination, (destMap.get(d.destination) || 0) + 1);
        });

        let topDest = '', topDestCount = 0;
        destMap.forEach((count, dest) => {
            if (count > topDestCount) { topDestCount = count; topDest = dest; }
        });

        // Motivation
        let motivation = '';
        if (monthlyStats.count === 0) {
            motivation = `💪 *${firstName}*, bu oy hali savdo yo'q. Birinchi savdoni bugun qiling!`;
        } else if (rank === 1) {
            motivation = `🏆 *${firstName}*, jamoa reytingida yetakchisiz!`;
        } else if (monthlyStats.count >= 5) {
            motivation = `🔥 *${firstName}*, bu oy ritmingiz yaxshi — davom eting!`;
        } else {
            motivation = `🚀 *${firstName}*, har bir savdo muhim!`;
        }

        // Leaderboard
        const topList = leaderboard.slice(0, 5).map((m, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            const isMe = (
                m.managerId
                    ? m.managerId === ctx.from?.id
                    : isSameUsernameLocal(m.username, username)
            ) ? ' ⬅️' : '';
            return `${medal} *${escapeMd(m.name)}*: ${m.count} ta — ${formatMoney(m.total)}${isMe}`;
        }).join('\n');

        const text =
            `📊 *${firstName}, natijalaringiz:*\n\n` +
            `📆 *Shu oy:*\n` +
            `   🏷️ Savdolar: *${monthlyStats.count} ta*\n` +
            `   👥 Sayohatchilar: *${monthlyStats.people} kishi*\n` +
            `   💰 Umumiy: *${formatMoney(monthlyStats.total)}*\n` +
            `   📈 O'rtacha: *${formatMoney(avgDeal)}*\n` +
            (bestDeal > 0 ? `   🏅 Eng katta: *${formatMoney(bestDeal)}* (${escapeMd(bestDest)})\n` : '') +
            (topDest ? `   🌍 Top yo'nalish: *${escapeMd(topDest)}* (${topDestCount} ta)\n` : '') +
            `📅 *Barcha vaqt:*\n` +
            `   🏷️ ${allTimeStats.count} ta | 👥 ${allTimeStats.people} kishi | 💰 ${formatMoney(allTimeStats.total)}\n\n` +
            `🏆 *Reyting:* (${rankText})\n${topList || '_Ma\'lumot yo\'q_'}\n\n` +
            `${motivation}`;

        await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, text, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error('Stats xatolik:', e);
        await ctx.api.editMessageText(
            ctx.chat!.id, msg.message_id,
            `❌ *${firstName}*, xatolik yuz berdi. Keyinroq urinib ko'ring.`,
            { parse_mode: 'Markdown' }
        );
    }
}

// ================ MY DEALS HANDLER ================

async function handleMyDeals(ctx: MyContext) {
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';
    const firstName = ctx.from?.first_name || 'Menejer';

    const msg = await ctx.reply(`⏳ *${firstName}*, yuklanmoqda...`, { parse_mode: 'Markdown' });

    try {
        const identity = { id: ctx.from?.id, username };
        const [allDeals, monthStats, debtSummary] = await Promise.all([
            sheetsService.getManagerAllDeals(identity),
            sheetsService.getManagerStats(identity),
            sheetsService.getManagerDebtSummary(identity),
        ]);

        const sortedDeals = sortByTimestampDesc([...allDeals]);

        if (sortedDeals.length === 0) {
            const kb = new InlineKeyboard()
                .text('CRM panel', 'mgr:crm')
                .text('Asosiy menyu', 'mgr:main');
            await ctx.api.editMessageText(
                ctx.chat!.id,
                msg.message_id,
                `📋 *${firstName}*, hali birorta savdo topilmadi.\n\n🍋 *Yangi savdo* tugmasini bosing va birinchi savdoni yozing.`,
                { parse_mode: 'Markdown', reply_markup: kb }
            );
            return;
        }

        const allTotal = sortedDeals.reduce((sum, d) => sum + d.price, 0);
        const allPeople = sortedDeals.reduce((sum, d) => sum + d.numberOfPeople, 0);
        const recent = sortedDeals.slice(0, 10);

        let text = `📋 *${firstName}, savdolar markazi*\n\n`;
        text += `📜 *Barcha vaqt:* ${sortedDeals.length} ta | 👥 ${allPeople} kishi | 💰 ${formatMoney(allTotal)}\n`;
        text += `📆 *Shu oy:* ${monthStats.count} ta | 👥 ${monthStats.people} kishi | 💰 ${formatMoney(monthStats.total)}\n`;
        text += `💳 *Qarz:* ${debtSummary.dealsWithDebt} ta savdo | ${formatMoney(debtSummary.totalDebt)}\n\n`;

        text += `🕒 *Oxirgi savdolar:*\n`;
        recent.forEach((d, i) => {
            const debt = Math.max(0, d.price - d.paidAmount);
            text += `${i + 1}. *${escapeMd(d.clientName)}* — ${formatMoney(d.price)}\n`;
            text += `   📅 ${escapeMd(d.timestamp)} | 🌍 ${escapeMd(d.destination)}\n`;
            if (debt > 0) text += `   📉 Qarz: *${formatMoney(debt)}*\n`;
            if (d.dealId) text += `   🆔 \`${d.dealId}\`\n`;
            text += `\n`;
        });

        if (sortedDeals.length > 10) {
            text += `_Oxirgi 10 ta ko'rsatildi. Qidirish uchun CRM paneldan foydalaning._`;
        }

        const kb = new InlineKeyboard()
            .text('CRM panel', 'mgr:crm')
            .text('Qidirish', 'mgr:search').row()
            .text('Qarzlar', 'mgr:debtlist')
            .text('Asosiy menyu', 'mgr:main');

        await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, text, {
            parse_mode: 'Markdown',
            reply_markup: kb,
        });
    } catch (e) {
        console.error('Deals xatolik:', e);
        const kb = new InlineKeyboard()
            .text('CRM panel', 'mgr:crm')
            .text('Asosiy menyu', 'mgr:main');
        await ctx.api.editMessageText(
            ctx.chat!.id,
            msg.message_id,
            '❌ Xatolik yuz berdi.',
            { reply_markup: kb }
        );
    }
}

// ================ DEBT HANDLER ================

async function handleDebtList(ctx: MyContext) {
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';
    const firstName = ctx.from?.first_name || 'Menejer';
    const isAdm = isAdmin(ctx.from?.id || 0, config.ADMIN_IDS);

    const msg = await ctx.reply(`⏳ *${firstName}*, qarzlar tekshirilmoqda...`, { parse_mode: 'Markdown' });

    try {
        // Admins see ALL debts, managers see only their own
        const debts = await sheetsService.getDebtDeals(
            isAdm ? undefined : { id: ctx.from?.id, username }
        );

        if (debts.length === 0) {
            const kb = new InlineKeyboard()
                .text('CRM', 'mgr:crm')
                .text('Asosiy menyu', 'mgr:main');
            await ctx.api.editMessageText(
                ctx.chat!.id, msg.message_id,
                `✅ *${firstName}*, qarzli savdo yo'q! Hammasi to'langan! 🎉`,
                { parse_mode: 'Markdown', reply_markup: kb }
            );
            return;
        }

        let totalDebt = 0;
        let text = isAdm
            ? `💳 *Barcha qarzli savdolar:*\n\n`
            : `💳 *${firstName}, qarzli savdolaringiz:*\n\n`;

        debts.slice(0, 15).forEach((d, i) => {
            const debt = d.price - d.paidAmount;
            totalDebt += debt;
            text += `${i + 1}. 👤 *${escapeMd(d.clientName)}*\n`;
            text += `   💰 Narx: ${formatMoney(d.price)} | To'langan: ${formatMoney(d.paidAmount)}\n`;
            text += `   📉 *Qarz: ${formatMoney(debt)}*\n`;
            if (d.contact) text += `   📞 ${escapeMd(d.contact)}\n`;
            if (d.destination) text += `   🌍 ${escapeMd(d.destination)}\n`;
            if (d.contractNumber) text += `   📄 Shartnoma: ${d.contractNumber}\n`;
            if (d.notes) text += `   📝 ${escapeMd(shortText(d.notes, 55))}\n`;
            if (isAdm && d.managerName) {
                const mgrUsername = d.managerUsername ? ` (${escapeMd(d.managerUsername)})` : '';
                text += `   👱 ${escapeMd(d.managerName)}${mgrUsername}\n`;
            }
            text += `   🆔 \`${d.dealId}\`\n\n`;
        });

        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💳 *Jami qarz: ${formatMoney(totalDebt)}* | ${debts.length} ta savdo`;

        if (debts.length > 15) {
            text += `\n_Oxirgi 15 ta ko'rsatilmoqda (jami: ${debts.length})_`;
        }

        // Create inline buttons for each debt deal
        const kb = new InlineKeyboard();
        debts.slice(0, 5).forEach(d => {
            const debt = d.price - d.paidAmount;
            kb.text(`💳 ${shortText(d.clientName, 12)} ($${debt})`, `debt:pay:${d.dealId}`)
                .text(`✅ Yopish`, `debt:close:${d.dealId}`).row()
                .text(`📋 Batafsil`, `mgr:deal:${d.dealId}`).row();
        });
        kb.text('Qidirish', 'mgr:search')
            .text('CRM', 'mgr:crm').row()
            .text('Asosiy menyu', 'mgr:main');

        await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, text, {
            parse_mode: 'Markdown',
            reply_markup: kb,
        });
    } catch (e) {
        console.error('Debt list xatolik:', e);
        const kb = new InlineKeyboard()
            .text('CRM', 'mgr:crm')
            .text('Asosiy menyu', 'mgr:main');
        await ctx.api.editMessageText(
            ctx.chat!.id,
            msg.message_id,
            '❌ Xatolik yuz berdi.',
            { reply_markup: kb }
        );
    }
}

// ================ MANAGER CRM HELPERS ================

function normalizeUsernameLocal(username: string): string {
    if (!username) return '';
    return username.trim().toLowerCase().replace(/^@/, '').replace(/\s+/g, '');
}

function isSameUsernameLocal(a: string, b: string): boolean {
    return normalizeUsernameLocal(a) === normalizeUsernameLocal(b);
}

function isDealOwner(ctx: MyContext, deal: { managerId?: number; managerUsername: string }): boolean {
    if (deal.managerId && ctx.from?.id) {
        return deal.managerId === ctx.from.id;
    }
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';
    return !!username && isSameUsernameLocal(username, deal.managerUsername);
}

function shortText(text: string, maxLen = 40): string {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function parseTimestampValue(timestamp: string): number {
    if (!timestamp) return 0;

    const dm = timestamp.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?/);
    if (dm) {
        const [, d, m, y, h = '0', mi = '0'] = dm;
        return new Date(
            Number(y),
            Number(m) - 1,
            Number(d),
            Number(h),
            Number(mi),
            0
        ).getTime();
    }

    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function sortByTimestampDesc<T extends { timestamp: string }>(rows: T[]): T[] {
    return rows.sort((a, b) => parseTimestampValue(b.timestamp) - parseTimestampValue(a.timestamp));
}

function renderDealDetails(deal: any, includeManager = false): string {
    const debt = Math.max(0, (deal.price || 0) - (deal.paidAmount || 0));
    let text =
        `📋 *Savdo tafsiloti*\n\n` +
        `🆔 \`${deal.dealId || '-'}\`\n` +
        `📅 ${escapeMd(deal.timestamp || '-')}\n` +
        `👤 *${escapeMd(deal.clientName || '-')}*\n` +
        `📞 ${escapeMd(deal.contact || '-')}\n` +
        `✈️ ${escapeMd(deal.departureDate || '-')} → ${escapeMd(deal.returnDate || '-')}\n` +
        `🌍 ${escapeMd(deal.destination || '-')}\n` +
        `👥 ${deal.numberOfPeople || 1} kishi\n` +
        `💰 ${formatMoney(deal.price || 0)}\n` +
        `💳 To'langan: ${formatMoney(deal.paidAmount || 0)}\n`;

    text += debt > 0
        ? `📉 *Qarz: ${formatMoney(debt)}* ⚠️\n`
        : `✅ Qarz yo'q (to'liq to'langan)\n`;

    text += `📄 Shartnoma: ${escapeMd(deal.contractNumber || '-')}\n`;
    text += `📝 Izoh: ${escapeMd(deal.notes || '-')}\n`;

    if (includeManager) {
        const managerUsername = deal.managerUsername ? ` (${escapeMd(deal.managerUsername)})` : '';
        text += `👱 Menejer: ${escapeMd(deal.managerName || '-')}${managerUsername}\n`;
    }

    return text;
}

async function goMainMenu(ctx: MyContext, notice = 'Asosiy menyu ochildi.'): Promise<void> {
    ctx.session.step = 'idle';
    ctx.session.adminStep = 'idle';
    ctx.session.debtContractId = undefined;
    await ctx.reply(notice, { reply_markup: keyboards.main });
}

async function startClientSearch(ctx: MyContext): Promise<void> {
    ctx.session.step = 'clientSearch';
    const kb = new InlineKeyboard().text('❌ Bekor qilish', 'mgr:main');

    await ctx.reply(
        `🔎 *Mijoz qidirish*\n\n` +
        `Mijoz ismi, telefon, shartnoma yoki savdo ID yuboring.\n\n` +
        `_Masalan:_\n` +
        `• Aliyev\n` +
        `• +998901234567\n` +
        `• id: LT-20260215-1234\n` +
        `• tel: 901234567\n` +
        `• shartnoma: 124/26`,
        { parse_mode: 'Markdown', reply_markup: kb }
    );
}

async function handleClientSearchQuery(ctx: MyContext, query: string): Promise<void> {
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';

    const cleanQuery = query.trim();
    const queryLower = cleanQuery.toLowerCase();
    const msg = await ctx.reply('⏳ *Qidiruv...*', { parse_mode: 'Markdown' });

    try {
        const identity = { id: ctx.from?.id, username };
        const allDeals = sortByTimestampDesc(await sheetsService.getManagerAllDeals(identity));
        let results = allDeals;
        let queryLabel = cleanQuery;

        if (queryLower.startsWith('id:')) {
            const value = cleanQuery.slice(3).trim().toLowerCase();
            queryLabel = `ID: ${value || '-'}`;
            results = allDeals.filter(d => (d.dealId || '').toLowerCase().includes(value));
        } else if (queryLower.startsWith('tel:') || queryLower.startsWith('phone:')) {
            const value = cleanQuery.split(':').slice(1).join(':').trim().replace(/\D/g, '');
            queryLabel = `Telefon: ${value || '-'}`;
            results = allDeals.filter(d => (d.contact || '').replace(/\D/g, '').includes(value));
        } else if (queryLower.startsWith('shartnoma:') || queryLower.startsWith('contract:')) {
            const value = cleanQuery.split(':').slice(1).join(':').trim().toLowerCase();
            queryLabel = `Shartnoma: ${value || '-'}`;
            results = allDeals.filter(d => (d.contractNumber || '').toLowerCase().includes(value));
        } else if (queryLower.startsWith('ism:') || queryLower.startsWith('client:')) {
            const value = cleanQuery.split(':').slice(1).join(':').trim().toLowerCase();
            queryLabel = `Mijoz: ${value || '-'}`;
            results = allDeals.filter(d => (d.clientName || '').toLowerCase().includes(value));
        } else if (queryLower.startsWith('manzil:') || queryLower.startsWith('dest:')) {
            const value = cleanQuery.split(':').slice(1).join(':').trim().toLowerCase();
            queryLabel = `Yo'nalish: ${value || '-'}`;
            results = allDeals.filter(d => (d.destination || '').toLowerCase().includes(value));
        } else {
            const digitQuery = cleanQuery.replace(/\D/g, '');
            if (cleanQuery.length < 2 && digitQuery.length < 4) {
                const kb = new InlineKeyboard()
                    .text('🔎 Qayta qidirish', 'mgr:search')
                    .text('Asosiy menyu', 'mgr:main');
                await ctx.api.editMessageText(
                    ctx.chat!.id,
                    msg.message_id,
                    '⚠️ Juda qisqa qidiruv. Kamida 2 harf yoki 4 ta raqam yuboring.',
                    { reply_markup: kb }
                );
                return;
            }
            results = await sheetsService.searchManagerDeals(identity, cleanQuery, 40);
        }

        results = sortByTimestampDesc([...results]);
        const shown = results.slice(0, 8);

        if (shown.length === 0) {
            const kb = new InlineKeyboard()
                .text('🔎 Qayta qidirish', 'mgr:search')
                .text('📚 Barcha mijozlar', 'mgr:clients').row()
                .text('CRM', 'mgr:crm')
                .text('Asosiy menyu', 'mgr:main');

            await ctx.api.editMessageText(
                ctx.chat!.id,
                msg.message_id,
                `❌ *${escapeMd(queryLabel)}* bo'yicha savdo topilmadi.`,
                { parse_mode: 'Markdown', reply_markup: kb }
            );
            return;
        }

        let text =
            `🔎 *Qidiruv natijasi*\n` +
            `So'rov: *${escapeMd(queryLabel)}*\n` +
            `Topildi: *${results.length} ta*\n\n`;

        shown.forEach((d, i) => {
            const debt = Math.max(0, d.price - d.paidAmount);
            text += `${i + 1}. *${escapeMd(d.clientName)}* — ${formatMoney(d.price)}\n`;
            text += `   📅 ${escapeMd(d.timestamp)} | 🌍 ${escapeMd(d.destination)}\n`;
            text += `   📞 ${escapeMd(d.contact || '-')}\n`;
            if (d.contractNumber) text += `   📄 ${escapeMd(d.contractNumber)}\n`;
            if (d.notes) text += `   📝 ${escapeMd(shortText(d.notes, 45))}\n`;
            text += debt > 0
                ? `   📉 Qarz: *${formatMoney(debt)}*\n`
                : `   ✅ To'langan\n`;
            text += `   🆔 \`${d.dealId}\`\n\n`;
        });

        if (results.length > shown.length) {
            text += `_Birinchi ${shown.length} ta natija ko'rsatildi._`;
        }

        const kb = new InlineKeyboard();
        shown.forEach((d, i) => {
            kb.text(`${i + 1}) ${shortText(d.clientName, 18)}`, `mgr:deal:${d.dealId}`).row();
        });
        kb.text('🔎 Qayta qidirish', 'mgr:search')
            .text('📚 Barcha mijozlar', 'mgr:clients').row()
            .text('CRM', 'mgr:crm')
            .text('Asosiy menyu', 'mgr:main');

        await ctx.api.editMessageText(
            ctx.chat!.id,
            msg.message_id,
            text,
            { parse_mode: 'Markdown', reply_markup: kb }
        );
    } catch (e) {
        console.error('Client search xatolik:', e);
        await ctx.api.editMessageText(
            ctx.chat!.id,
            msg.message_id,
            '❌ Qidiruvda xatolik yuz berdi. Keyinroq qayta urinib ko\'ring.'
        );
    }
}

async function handleManagerCRM(ctx: MyContext): Promise<void> {
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';
    const firstName = ctx.from?.first_name || 'Menejer';

    const msg = await ctx.reply(`⏳ *${firstName}*, CRM ma'lumotlari tayyorlanmoqda...`, {
        parse_mode: 'Markdown',
    });

    try {
        const identity = { id: ctx.from?.id, username };
        const [monthStats, allTimeStats, portfolio, debtSummary, allDeals] = await Promise.all([
            sheetsService.getManagerStats(identity),
            sheetsService.getManagerAllTimeStats(identity),
            sheetsService.getManagerClientPortfolio(identity),
            sheetsService.getManagerDebtSummary(identity),
            sheetsService.getManagerAllDeals(identity),
        ]);

        const recentDeals = sortByTimestampDesc([...allDeals]).slice(0, 5);
        const topDebtClients = portfolio.filter(c => c.totalDebt > 0).slice(0, 3);

        let text =
            `👤 *${escapeMd(firstName)} — Shaxsiy CRM*\n` +
            `${escapeMd(username)}\n\n` +
            `📊 *Shu oy:*\n` +
            `   📝 ${monthStats.count} ta | 👥 ${monthStats.people} kishi | 💰 ${formatMoney(monthStats.total)}\n` +
            `   📈 O'rtacha savdo: *${formatMoney(monthStats.count > 0 ? monthStats.total / monthStats.count : 0)}*\n\n` +
            `📜 *Barcha vaqt:*\n` +
            `   📝 ${allTimeStats.count} ta | 👥 ${allTimeStats.people} kishi | 💰 ${formatMoney(allTimeStats.total)}\n` +
            `   🧑‍🤝‍🧑 Mijozlar: *${portfolio.length} ta*\n\n` +
            `💳 *Qarz nazorati:*\n` +
            `   📉 Qarzli savdo: *${debtSummary.dealsWithDebt} ta*\n` +
            `   💰 Umumiy qarz: *${formatMoney(debtSummary.totalDebt)}*\n`;

        if (topDebtClients.length > 0) {
            text += `\n⚠️ *Yopilishi kerak (top):*\n`;
            topDebtClients.forEach((c, i) => {
                text += `${i + 1}. *${escapeMd(c.clientName)}* — ${formatMoney(c.totalDebt)}\n`;
                if (c.contact) text += `   📞 ${escapeMd(c.contact)}\n`;
                if (c.lastNotes) text += `   📝 ${escapeMd(shortText(c.lastNotes, 45))}\n`;
            });
        }

        if (recentDeals.length > 0) {
            text += `\n📋 *So'nggi savdolar (all-time):*\n`;
            recentDeals.forEach((d, i) => {
                const debt = Math.max(0, d.price - d.paidAmount);
                text += `${i + 1}. ${escapeMd(d.clientName)} — ${formatMoney(d.price)}`;
                if (debt > 0) text += ` (qarz: ${formatMoney(debt)})`;
                text += `\n`;
            });
        }

        const kb = new InlineKeyboard()
            .text('📋 Savdolarim', 'mgr:mydeals')
            .text('📚 Barcha mijozlar', 'mgr:clients').row()
            .text('🔎 Qidirish', 'mgr:search')
            .text('💳 Qarzlar', 'mgr:debtlist').row()
            .text('🔄 Yangilash', 'mgr:crm')
            .text('Asosiy menyu', 'mgr:main');

        debtSummary.topCases.slice(0, 3).forEach((c, i) => {
            kb.row().text(`${i + 1}) ${shortText(c.clientName, 16)} (${formatMoney(c.debt)})`, `mgr:deal:${c.dealId}`);
        });

        await ctx.api.editMessageText(
            ctx.chat!.id,
            msg.message_id,
            text,
            { parse_mode: 'Markdown', reply_markup: kb }
        );
    } catch (e) {
        console.error('Manager CRM xatolik:', e);
        await ctx.api.editMessageText(
            ctx.chat!.id,
            msg.message_id,
            `❌ *${escapeMd(firstName)}*, CRM panelni yuklashda xatolik yuz berdi.`,
            { parse_mode: 'Markdown' }
        );
    }
}

async function handleAllClients(ctx: MyContext): Promise<void> {
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';
    const firstName = ctx.from?.first_name || 'Menejer';

    const msg = await ctx.reply(`⏳ *${firstName}*, mijozlar ro'yxati yuklanmoqda...`, {
        parse_mode: 'Markdown',
    });

    try {
        const clients = await sheetsService.getManagerClientPortfolio({
            id: ctx.from?.id,
            username,
        });
        if (clients.length === 0) {
            const kb = new InlineKeyboard()
                .text('CRM', 'mgr:crm')
                .text('Asosiy menyu', 'mgr:main');
            await ctx.api.editMessageText(
                ctx.chat!.id,
                msg.message_id,
                '📚 Sizda hali mijozlar topilmadi.',
                { parse_mode: 'Markdown', reply_markup: kb }
            );
            return;
        }

        const shown = clients.slice(0, 12);
        let text =
            `📚 *${firstName}, barcha mijozlar*\n` +
            `Jami: *${clients.length} ta*\n\n`;

        shown.forEach((c, i) => {
            text += `${i + 1}. *${escapeMd(c.clientName)}*\n`;
            text += `   📞 ${escapeMd(c.contact || '-')}\n`;
            text += `   📝 Savdo: ${c.totalDeals} ta | 💰 ${formatMoney(c.totalRevenue)}\n`;
            if (c.totalDebt > 0) text += `   📉 Qarz: *${formatMoney(c.totalDebt)}*\n`;
            if (c.lastDealId) text += `   🆔 So'nggi: \`${c.lastDealId}\`\n`;
            if (c.lastNotes) text += `   📝 ${escapeMd(shortText(c.lastNotes, 45))}\n`;
            text += `\n`;
        });

        if (clients.length > shown.length) {
            text += `_Birinchi ${shown.length} ta ko'rsatildi. Qidiruvdan foydalaning._`;
        }

        const kb = new InlineKeyboard();
        shown.forEach((c, i) => {
            if (c.lastDealId) {
                kb.text(`${i + 1}) ${shortText(c.clientName, 16)}`, `mgr:deal:${c.lastDealId}`).row();
            }
        });
        kb.text('🔎 Qidirish', 'mgr:search')
            .text('CRM', 'mgr:crm').row()
            .text('Asosiy menyu', 'mgr:main');

        await ctx.api.editMessageText(
            ctx.chat!.id,
            msg.message_id,
            text,
            { parse_mode: 'Markdown', reply_markup: kb }
        );
    } catch (e) {
        console.error('All clients xatolik:', e);
        await ctx.api.editMessageText(
            ctx.chat!.id,
            msg.message_id,
            '❌ Mijozlar ro\'yxatini yuklashda xatolik.'
        );
    }
}

async function handleManagerDealDetail(ctx: MyContext, dealId: string): Promise<void> {
    const deal = await sheetsService.getDealById(dealId);
    const isAdm = isAdmin(ctx.from?.id || 0, config.ADMIN_IDS);
    const myUsername = ctx.from?.username ? `@${ctx.from.username}` : '';

    if (!deal) {
        await ctx.answerCallbackQuery({ text: '❌ Savdo topilmadi' });
        return;
    }

    const isOwner = isDealOwner(ctx, deal);
    if (!isAdm && !isOwner) {
        await ctx.answerCallbackQuery({ text: '⛔ Bu savdo sizga tegishli emas' });
        return;
    }

    const debt = Math.max(0, deal.price - deal.paidAmount);
    const kb = new InlineKeyboard();
    if (debt > 0) {
        kb.text(`💳 To'lov yangilash`, `debt:pay:${deal.dealId}`)
            .text(`✅ Qarz yopish`, `debt:close:${deal.dealId}`).row();
    }
    kb.text('Qidirish', 'mgr:search')
        .text('CRM', 'mgr:crm').row()
        .text('Asosiy menyu', 'mgr:main');

    await ctx.answerCallbackQuery();
    await ctx.reply(renderDealDetails(deal, isAdm), {
        parse_mode: 'Markdown',
        reply_markup: kb,
    });
}

async function handleManagerCallbacks(ctx: MyContext): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data?.startsWith('mgr:')) return;

    const parts = data.split(':');
    const action = parts[1];

    if (action === 'search') {
        await ctx.answerCallbackQuery();
        await startClientSearch(ctx);
        return;
    }

    if (action === 'searchpreset') {
        await ctx.answerCallbackQuery();
        await startClientSearch(ctx);
        return;
    }

    if (action === 'search_cancel') {
        ctx.session.step = 'idle';
        await ctx.answerCallbackQuery({ text: '❌ Bekor qilindi' });
        await goMainMenu(ctx, '❌ Qidiruv bekor qilindi.');
        return;
    }

    if (action === 'crm') {
        await ctx.answerCallbackQuery();
        await handleManagerCRM(ctx);
        return;
    }

    if (action === 'clients') {
        await ctx.answerCallbackQuery();
        await handleAllClients(ctx);
        return;
    }

    if (action === 'mydeals') {
        await ctx.answerCallbackQuery();
        await handleMyDeals(ctx);
        return;
    }

    if (action === 'debtlist') {
        await ctx.answerCallbackQuery();
        await handleDebtList(ctx);
        return;
    }

    if (action === 'deal') {
        const dealId = parts.slice(2).join(':');
        if (!dealId) {
            await ctx.answerCallbackQuery({ text: '❌ Deal ID topilmadi' });
            return;
        }
        await handleManagerDealDetail(ctx, dealId);
        return;
    }

    if (action === 'main') {
        await ctx.answerCallbackQuery();
        await goMainMenu(ctx);
        return;
    }

    await ctx.answerCallbackQuery();
}

// ================ CRON JOBS ================

function getMorningMotivation(): string {
    const msgs = [
        `Xayrli tong, Lemon Tour jamoasi! ☀️\n\nBugun yangi imkoniyatlar kuni! 💪\n\n_Muvaffaqiyat — har kungi sa'y-harakatlar natijasi!_ 🍋`,
        `Salom, jamoam! 🍋\n\nYangi kun — yangi savdolar! Bugun ham mijozlarga tez, aniq va sifatli xizmat ko'rsating. 🚀`,
        `Xayrli tong! 🌞\n\nBugun ajoyib kun bo'ladi! Har bir mijozga eng yaxshi xizmatni ko'rsatamiz!\n\n_Lemon Tour — doimo eng yaxshi!_ 🍋`,
        `Assalomu alaykum! 🌅\n\nYangi kun, yangi natijalar! Keling, bugun rekord o'rnatamiz! 🏆\n\n_Har bir savdo muhim!_ 💰`,
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
}

function getEveningReminder(): string {
    return runtimeConfig.customReminderText ||
        `Assalomu alaykum, Lemon Tour xodimi! 🍋\n\n` +
        `Ish vaqti tugashi oz qoldi, iltimos bugungi *hisobotlaringizni* tezroq topshiring.\n\n` +
        `⚠️ *Eslatma:* Hisobot topshirish majburiydir.\n\n` +
        `Rahmat va muvaffaqiyatlar! 🚀`;
}

async function sendToAllUsers(text: string) {
    const users = await userService.getUsers();
    let sent = 0;
    for (const user of users) {
        try {
            await bot.api.sendMessage(user.id, text, { parse_mode: 'Markdown' });
            sent++;
        } catch (e) {
            console.error(`Xabar xato (${user.id}):`, e);
        }
    }
    console.log(`📨 ${sent}/${users.length} ga yuborildi.`);
}

// Debt reminder — sends to managers who have outstanding debts
async function sendDebtReminders() {
    console.log('💳 Qarz eslatmalari yuborilmoqda...');
    const users = await userService.getUsers();
    let sent = 0;

    for (const user of users) {
        const username = user.username ? `@${user.username}` : '';
        try {
            const debts = await sheetsService.getDebtDeals({ id: user.id, username });
            if (debts.length === 0) continue;

            let totalDebt = 0;
            let text = `💳 *Qarz eslatmasi*\n\n`;
            text += `Sizda *${debts.length} ta* qarzli savdo bor:\n\n`;

            debts.slice(0, 5).forEach((d, i) => {
                const debt = d.price - d.paidAmount;
                totalDebt += debt;
                text += `${i + 1}. 👤 *${escapeMd(d.clientName)}* — qarz: *${formatMoney(debt)}*\n`;
                if (d.contractNumber) text += `   📄 ${d.contractNumber}\n`;
            });

            if (debts.length > 5) {
                text += `...va yana ${debts.length - 5} ta\n`;
            }

            text += `\n💰 *Jami qarz: ${formatMoney(totalDebt)}*\n\n`;
            text += `_💳 Qarzlar tugmasini bosib boshqaring._`;

            await bot.api.sendMessage(user.id, text, { parse_mode: 'Markdown' });
            sent++;
        } catch (e) {
            console.error(`Qarz eslatma xato (${user.id}):`, e);
        }
    }
    console.log(`💳 Qarz eslatma: ${sent} ta menejerga yuborildi.`);
}

// ================ START ================

function scheduleJobs(): void {
    // Morning motivation — Mon-Sat 09:00
    cron.schedule(config.MORNING_REMINDER_CRON, async () => {
        console.log('🌅 Ertalabki motivatsiya...');
        await sendToAllUsers(getMorningMotivation());
    }, { timezone: config.TIMEZONE });

    // Evening reminder — Mon-Sat 17:00
    cron.schedule(config.EVENING_REMINDER_CRON, async () => {
        console.log('🔔 Kechki eslatma...');
        await sendToAllUsers(getEveningReminder());
    }, { timezone: config.TIMEZONE });

    // Debt reminders — every 2 days at 10:00
    cron.schedule('0 10 */2 * *', async () => {
        await sendDebtReminders();
    }, { timezone: config.TIMEZONE });

    // Keep boss reporting synchronized even when rows are edited manually in Sheets.
    cron.schedule('*/30 * * * *', async () => {
        try {
            await dashboardService.refresh();
        } catch (error) {
            console.error('Scheduled dashboard refresh error:', error);
        }
    }, { timezone: config.TIMEZONE });

    console.log(`⏰ Cron: ${config.MORNING_REMINDER_CRON} | ${config.EVENING_REMINDER_CRON} | Qarz: har 2 kunda`);
}

function startHealthServer(isReady: () => boolean): Server | undefined {
    const port = Number(process.env.PORT || 0);
    if (!Number.isSafeInteger(port) || port <= 0) return undefined;

    const server = createServer((request, response) => {
        if (request.url !== '/health' && request.url !== '/') {
            response.writeHead(404, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ ok: false, error: 'not_found' }));
            return;
        }

        const ready = isReady();
        response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
            ok: ready,
            service: 'lemon-tour-bot',
            timestamp: new Date().toISOString(),
        }));
    });
    server.listen(port, '0.0.0.0', () => {
        console.log(`Health endpoint listening on port ${port}`);
    });
    return server;
}

async function startApplication(): Promise<void> {
    assertProductionConfig();

    console.log('🍋 Lemon Tour Bot v4.0 ishga tushmoqda...');
    console.log(`👑 Adminlar: ${config.ADMIN_IDS.length} ta`);
    console.log(`👥 Menejerlar: ${config.MANAGER_IDS.length} ta`);

    let ready = false;
    const healthServer = startHealthServer(() => ready);

    const connection = await sheetsService.checkConnection();
    console.log(`✅ Google Sheets: ${connection.spreadsheetTitle} / ${connection.salesSheetName}`);
    await userService.initialize();

    const botInfo = await bot.api.getMe();
    const webhookInfo = await bot.api.getWebhookInfo();
    if (webhookInfo.url) {
        console.warn('Telegram webhook topildi; long polling bilan to‘qnashmasligi uchun o‘chirilmoqda.');
        await bot.api.deleteWebhook({ drop_pending_updates: false });
    }
    await bot.api.setMyCommands([
        { command: 'start', description: 'Asosiy menyu' },
        { command: 'newdeal', description: 'Yangi savdoni kiritish' },
        { command: 'stats', description: 'Mening statistikam' },
        { command: 'mydeals', description: 'Mening savdolarim' },
        { command: 'crm', description: 'Mijozlar va qarz nazorati' },
        { command: 'qarz', description: 'Ochiq qarzlar' },
        { command: 'help', description: 'Yordam' },
    ]);
    for (const adminId of config.ADMIN_IDS) {
        await bot.api.setMyCommands(
            [
                { command: 'admin', description: 'Boshqaruv paneli' },
                { command: 'pdfreport', description: 'PDF hisobot' },
                { command: 'newdeal', description: 'Yangi savdoni kiritish' },
                { command: 'stats', description: 'Mening statistikam' },
                { command: 'help', description: 'Yordam' },
            ],
            { scope: { type: 'chat', chat_id: adminId } }
        );
    }
    if (config.CHANNEL_ID) {
        const destination = await bot.api.getChat(config.CHANNEL_ID);
        console.log(`✅ Savdo guruhi: ${'title' in destination ? destination.title : destination.id}`);
    }
    try {
        const dashboard = await dashboardService.refresh();
        console.log(`✅ Boss dashboard: ${dashboard.spreadsheetUrl}`);
    } catch (error) {
        console.error('⚠️ Boss dashboard startup refresh failed:', error);
    }

    scheduleJobs();
    ready = true;

    const shutdown = async (signal: string) => {
        ready = false;
        console.log(`${signal}: bot to'xtatilmoqda...`);
        await bot.stop();
        healthServer?.close();
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));

    await bot.start({
        onStart: () => console.log(`✅ @${botInfo.username} ishga tushdi!`),
    });
}

if (require.main === module) {
    startApplication().catch(error => {
        console.error('❌ Bot ishga tushmadi:', error);
        process.exitCode = 1;
    });
}
