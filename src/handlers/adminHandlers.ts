import { MyContext } from '../types';
import { config } from '../config';
import { sheetsService } from '../services/sheets';
import { dashboardService } from '../services/dashboardService';
import { userService } from '../services/userService';
import { inlineKeyboards } from '../utils/keyboard';
import { formatMoney, isAdmin, escapeMd, escapeHtml } from '../utils/helpers';
import { InlineKeyboard } from 'grammy';

// ================ ADMIN CHECK ================

function checkAdmin(ctx: MyContext): boolean {
    return isAdmin(ctx.from?.id || 0, config.ADMIN_IDS);
}

// ================ ADMIN DASHBOARD ================

export async function handleAdminCommand(ctx: MyContext) {
    if (!checkAdmin(ctx)) {
        await ctx.reply('⛔ Sizda admin huquqi yo\'q.');
        return;
    }

    try {
        const [stats, leaderboard, monthlyDeals, allDebts, userCount, dataQuality] = await Promise.all([
            sheetsService.getOverallStats(),
            sheetsService.getLeaderboard(),
            sheetsService.getMonthlyDeals(),
            sheetsService.getDebtDeals(),
            userService.getUserCount(),
            sheetsService.getDataQuality(),
        ]);
        const monthPaid = monthlyDeals.reduce((sum, deal) => sum + deal.paidAmount, 0);
        const monthDebt = monthlyDeals.reduce(
            (sum, deal) => sum + Math.max(0, deal.price - deal.paidAmount),
            0
        );
        const totalDebt = allDebts.reduce(
            (sum, deal) => sum + Math.max(0, deal.price - deal.paidAmount),
            0
        );
        const dataIssueCount = dataQuality.duplicateDealIds
            + dataQuality.missingManager
            + dataQuality.missingClient
            + dataQuality.invalidAmounts;

        // Top 3 managers mini-view
        let topManagers = '';
        leaderboard.slice(0, 3).forEach((m, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
            topManagers += `${medal} ${m.name}: *${formatMoney(m.total)}* (${m.count} ta)\n`;
        });

        const text =
            `🍋 *LEMON TOUR — Admin Panel*\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +

            `📍 *Bugun*  ${stats.todayCount} ta  •  ${formatMoney(stats.todayTotal)}\n` +
            `📅 *Hafta*  ${stats.weekCount} ta  •  ${formatMoney(stats.weekTotal)}\n\n` +

            `📆 *Joriy oy*\n` +
            `   Shartnomalar: *${formatMoney(stats.monthTotal)}* (${stats.monthCount} ta)\n` +
            `   Tushgan pul: *${formatMoney(monthPaid)}*\n` +
            `   Ochiq qarz: *${formatMoney(monthDebt)}*\n` +
            `\n` +

            `📜 *Barcha davr*  ${stats.allCount} ta  •  ${formatMoney(stats.allTotal)}\n` +
            `💳 *Jami ochiq qarz*  ${formatMoney(totalDebt)}\n\n` +

            `🏆 *Top menejerlar:*\n` +
            (topManagers || '_Hali savdolar yo\'q_\n') + `\n` +

            `👥 *Foydalanuvchilar:* ${userCount} ta\n` +
            `👑 *Adminlar:* ${config.ADMIN_IDS.length} ta\n\n` +
            (dataIssueCount > 0
                ? `⚠️ *Ma'lumot sifati:* ${dataIssueCount} ta muammo; legacy qatorlar: ${dataQuality.legacyRows}\n\n`
                : `✅ *Ma'lumot sifati:* asosiy tekshiruvlardan o'tdi\n\n`) +

            `_Kerakli amalni tanlang:_`;

        await ctx.reply(text, {
            parse_mode: 'Markdown',
            reply_markup: inlineKeyboards.adminPanel,
        });
    } catch (e) {
        console.error('Admin panel xatosi:', e);
        await ctx.reply('❌ Admin panelni yuklashda xatolik.');
    }
}

// ================ CALLBACK HANDLERS ================

export async function handleAdminCallbacks(ctx: MyContext) {
    if (!checkAdmin(ctx)) {
        await ctx.answerCallbackQuery({ text: '⛔ Admin huquqi yo\'q!' });
        return;
    }

    const data = ctx.callbackQuery?.data;
    if (!data?.startsWith('admin:')) return;

    const action = data.replace('admin:', '');
    // Telegram clients keep a loading spinner until callback queries are answered.
    // Acknowledge before potentially slow Google Sheets reads.
    await ctx.answerCallbackQuery().catch(() => undefined);

    try {
        switch (action) {
            case 'today_report':
                await handleTodayReport(ctx);
                break;
            case 'weekly_report':
                await handleWeeklyReport(ctx);
                break;
            case 'monthly_report':
                await handleMonthlyReport(ctx);
                break;
            case 'manager_stats':
                await handleManagerSelector(ctx);
                break;
            case 'users':
                await handleUsersList(ctx);
                break;
            case 'boss_dashboard':
                await handleBossDashboard(ctx);
                break;
            case 'broadcast':
                await handleBroadcastStart(ctx);
                break;
            case 'remind_now':
                await handleRemindNow(ctx);
                break;
            case 'top_destinations':
                await handleTopDestinations(ctx);
                break;
            case 'back_panel':
                await handleAdminCommand(ctx);
                break;
            default:
                // Manager-specific stats: admin:mgr:@username
                if (action.startsWith('mgr:')) {
                    await handleManagerDetailV2(ctx, action.replace('mgr:', ''));
                }
                break;
        }
    } catch (e) {
        console.error('Admin callback xatosi:', e);
        await ctx.reply('❌ Xatolik yuz berdi.');
    }

}

async function handleBossDashboard(ctx: MyContext): Promise<void> {
    const loading = await ctx.reply('⏳ Boss dashboard yangilanmoqda...');
    try {
        const result = await dashboardService.refresh();
        await ctx.api.editMessageText(
            ctx.chat!.id,
            loading.message_id,
            `✅ <b>${escapeHtml(result.sheetName)}</b> yangilandi.\n\n` +
            `🕒 ${escapeHtml(result.refreshedAt)}\n` +
            `<a href="${result.spreadsheetUrl}">Google Sheets dashboardni ochish</a>`,
            { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
        );
    } catch (error) {
        console.error('Boss dashboard refresh error:', error);
        await ctx.api.editMessageText(
            ctx.chat!.id,
            loading.message_id,
            '❌ Dashboard yangilanmadi. Google Sheets ulanishi va ruxsatlarini tekshiring.'
        );
    }
}

// ================ BUGUNGI HISOBOT ================

async function handleTodayReport(ctx: MyContext) {
    const deals = await sheetsService.getTodayDeals();

    if (deals.length === 0) {
        await ctx.reply(
            '📊 *Bugungi hisobot*\n\n' +
            '_Bugun hech qanday savdo qayd qilinmagan._\n\n' +
            '💡 _Menejerlarni rag\'batlantiring!_',
            { parse_mode: 'Markdown', reply_markup: backButton() }
        );
        return;
    }

    let total = 0, totalPeople = 0, totalPaid = 0, totalDebt = 0;
    const byManager = new Map<string, { count: number; total: number }>();
    let text = '📊 *Bugungi savdolar:*\n\n';

    deals.forEach((d, i) => {
        total += d.price;
        totalPeople += d.numberOfPeople;
        const paid = d.paidAmount || 0;
        const debt = d.price - paid;
        totalPaid += paid;
        if (debt > 0) totalDebt += debt;

        const mgr = d.managerName || 'Nomalum';
        if (!byManager.has(mgr)) byManager.set(mgr, { count: 0, total: 0 });
        const entry = byManager.get(mgr)!;
        entry.count++;
        entry.total += d.price;

        text += `${i + 1}. *${escapeMd(d.clientName)}* — ${formatMoney(d.price)}`;
        if (debt > 0) text += ` (📉 ${formatMoney(debt)} qarz)`;
        text += `\n`;
        text += `   🌍 ${escapeMd(d.destination)} | 👥 ${d.numberOfPeople} | 👱 ${escapeMd(d.managerName)}\n`;
        if (d.contractNumber) text += `   📄 ${d.contractNumber}\n`;
        if (d.dealId) text += `   🆔 \`${d.dealId}\`\n`;
        text += `\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📝 *Jami:* ${deals.length} ta | 👥 ${totalPeople} kishi | 💰 *${formatMoney(total)}*\n`;
    text += `💳 To'langan: *${formatMoney(totalPaid)}*`;
    if (totalDebt > 0) text += ` | 📉 Qarz: *${formatMoney(totalDebt)}*`;
    text += `\n\n`;

    // Per-manager breakdown
    if (byManager.size > 1) {
        text += `👥 *Menejerlar:*\n`;
        const sorted = Array.from(byManager.entries()).sort((a, b) => b[1].total - a[1].total);
        sorted.forEach(([name, data]) => {
            text += `   👱 ${name}: ${data.count} ta — ${formatMoney(data.total)}\n`;
        });
    }

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: backButton() });
}

// ================ HAFTALIK HISOBOT ================

async function handleWeeklyReport(ctx: MyContext) {
    const deals = await sheetsService.getWeeklyDeals();

    if (deals.length === 0) {
        await ctx.reply('📅 *Haftalik hisobot*\n\n_Bu hafta hech qanday savdo qayd qilinmagan._',
            { parse_mode: 'Markdown', reply_markup: backButton() });
        return;
    }

    let total = 0, totalPeople = 0;
    const managerMap = new Map<string, { name: string; count: number; total: number; people: number }>();
    const destMap = new Map<string, number>();

    deals.forEach(d => {
        total += d.price;
        totalPeople += d.numberOfPeople;

        const mgr = d.managerName || 'Nomalum';
        if (!managerMap.has(mgr)) managerMap.set(mgr, { name: mgr, count: 0, total: 0, people: 0 });
        const entry = managerMap.get(mgr)!;
        entry.count++;
        entry.total += d.price;
        entry.people += d.numberOfPeople;

        if (d.destination) destMap.set(d.destination, (destMap.get(d.destination) || 0) + 1);
    });

    let text = `📅 *Haftalik hisobot:*\n\n`;
    text += `📝 Savdolar: *${deals.length} ta*\n`;
    text += `👥 Sayohatchilar: *${totalPeople} kishi*\n`;
    text += `💰 Jami: *${formatMoney(total)}*\n`;
    text += `📈 O'rtacha: *${formatMoney(Math.round(total / deals.length))}*\n\n`;

    text += `🏆 *Menejerlar:*\n`;
    const sorted = Array.from(managerMap.values()).sort((a, b) => b.total - a.total);
    sorted.forEach((m, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        text += `${medal} *${escapeMd(m.name)}*: ${m.count} ta | 👥 ${m.people} | ${formatMoney(m.total)}\n`;
    });

    // Top destinations
    const topDests = Array.from(destMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topDests.length > 0) {
        text += `\n🌍 *Yo'nalishlar:*\n`;
        topDests.forEach(([dest, count]) => {
            text += `   ${dest}: ${count} ta\n`;
        });
    }

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: backButton() });
}

// ================ OYLIK HISOBOT ================

async function handleMonthlyReport(ctx: MyContext) {
    const deals = await sheetsService.getMonthlyDeals();
    const leaderboard = await sheetsService.getLeaderboard();

    let total = 0, totalPeople = 0, totalPaid = 0, totalDebt = 0, debtCount = 0;
    const destMap = new Map<string, { count: number; revenue: number }>();

    deals.forEach(d => {
        total += d.price;
        totalPeople += d.numberOfPeople;
        const paid = d.paidAmount || 0;
        const debt = d.price - paid;
        totalPaid += paid;
        if (debt > 0) {
            totalDebt += debt;
            debtCount++;
        }
        if (d.destination) {
            if (!destMap.has(d.destination)) destMap.set(d.destination, { count: 0, revenue: 0 });
            const entry = destMap.get(d.destination)!;
            entry.count++;
            entry.revenue += d.price;
        }
    });

    const avg = deals.length > 0 ? Math.round(total / deals.length) : 0;

    let text = `📆 *Oylik hisobot:*\n\n`;
    text += `📝 Savdolar: *${deals.length} ta*\n`;
    text += `👥 Sayohatchilar: *${totalPeople} kishi*\n`;
    text += `💰 Jami: *${formatMoney(total)}*\n`;
    text += `💳 To'langan: *${formatMoney(totalPaid)}*\n`;
    if (totalDebt > 0) {
        text += `📉 Qarz: *${formatMoney(totalDebt)}* (${debtCount} savdo) ⚠️\n`;
    }
    text += `📈 O'rtacha: *${formatMoney(avg)}*\n\n`;

    text += `🏆 *Menejerlar reytingi:*\n`;
    leaderboard.forEach((m, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        text += `${medal} *${escapeMd(m.name)}*: ${m.count} ta — ${formatMoney(m.total)}\n`;
    });

    if (leaderboard.length === 0) {
        text += `_Bu oy hali savdolar yo'q._\n`;
    }

    // Top destinations
    const topDests = Array.from(destMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
    if (topDests.length > 0) {
        text += `\n🌍 *Top yo'nalishlar:*\n`;
        topDests.forEach(([dest, data]) => {
            text += `   ${dest}: ${data.count} ta — ${formatMoney(data.revenue)}\n`;
        });
    }

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: backButton() });
}

// ================ MANAGER SELECTOR ================

async function handleManagerSelector(ctx: MyContext) {
    const leaderboard = await sheetsService.getLeaderboard();

    if (leaderboard.length === 0) {
        await ctx.reply('👥 _Bu oy menejerlar topilmadi._', { parse_mode: 'Markdown' });
        return;
    }

    const kb = new InlineKeyboard();
    leaderboard.forEach((m, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        kb.text(`${medal} ${m.name} (${formatMoney(m.total)})`, `admin:mgr:${m.username}`).row();
    });
    kb.text('⬅️ Orqaga', 'admin:back_panel');

    await ctx.reply(
        '👥 *Menejer statistikasi*\n\n_Menejer tanlang:_',
        { parse_mode: 'Markdown', reply_markup: kb }
    );
}

// ================ MANAGER DETAIL ================

async function handleManagerDetail(ctx: MyContext, username: string) {
    const stats = await sheetsService.getManagerStats(username);
    const allTime = await sheetsService.getManagerAllTimeStats(username);
    const deals = await sheetsService.getManagerDeals(username);
    // Find manager name from deals
    const name = deals.length > 0 ? deals[0].managerName : username;

    let bestDeal = 0, bestDest = '';
    const destMap = new Map<string, number>();
    deals.forEach(d => {
        if (d.price > bestDeal) { bestDeal = d.price; bestDest = d.destination; }
        if (d.destination) destMap.set(d.destination, (destMap.get(d.destination) || 0) + 1);
    });

    let topDest = '';
    let topDestCount = 0;
    destMap.forEach((count, dest) => {
        if (count > topDestCount) { topDestCount = count; topDest = dest; }
    });

    const avg = stats.count > 0 ? Math.round(stats.total / stats.count) : 0;

    let text = `👤 *${escapeMd(name)}* (${escapeMd(username)})\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    text += `📆 *Shu oy:*\n`;
    text += `   📝 Savdolar: *${stats.count} ta*\n`;
    text += `   👥 Sayohatchilar: *${stats.people} kishi*\n`;
    text += `   💰 Jami: *${formatMoney(stats.total)}*\n`;
    text += `   📈 O'rtacha: *${formatMoney(avg)}*\n`;
    if (bestDeal > 0) text += `   🏅 Eng katta: *${formatMoney(bestDeal)}* (${bestDest})\n`;
    if (topDest) text += `   🌍 Top yo'nalish: *${topDest}* (${topDestCount} ta)\n`;
    text += `\n`;

    text += `📅 *Barcha vaqt:*\n`;
    text += `   📝 ${allTime.count} ta | 👥 ${allTime.people} kishi | 💰 ${formatMoney(allTime.total)}\n\n`;

    // Recent deals
    if (deals.length > 0) {
        text += `📋 *So'nggi savdolar:*\n`;
        deals.slice(-5).reverse().forEach((d, i) => {
            text += `${i + 1}. ${escapeMd(d.clientName)} — ${formatMoney(d.price)} | 🌍 ${escapeMd(d.destination)}\n`;
        });
    }

    const kb = new InlineKeyboard()
        .text('👥 Boshqa menejer', 'admin:manager_stats').row()
        .text('⬅️ Admin panel', 'admin:back_panel');

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
}

async function handleManagerDetailV2(ctx: MyContext, username: string) {
    const [stats, allTime, monthDeals, allDeals, debtSummary, portfolio] = await Promise.all([
        sheetsService.getManagerStats(username),
        sheetsService.getManagerAllTimeStats(username),
        sheetsService.getManagerDeals(username),
        sheetsService.getManagerAllDeals(username),
        sheetsService.getManagerDebtSummary(username),
        sheetsService.getManagerClientPortfolio(username),
    ]);

    const name = allDeals[0]?.managerName || monthDeals[0]?.managerName || username;

    let bestDeal = 0;
    let bestDest = '';
    const destMap = new Map<string, number>();
    monthDeals.forEach(d => {
        if (d.price > bestDeal) {
            bestDeal = d.price;
            bestDest = d.destination;
        }
        if (d.destination) {
            destMap.set(d.destination, (destMap.get(d.destination) || 0) + 1);
        }
    });

    let topDest = '';
    let topDestCount = 0;
    destMap.forEach((count, dest) => {
        if (count > topDestCount) {
            topDestCount = count;
            topDest = dest;
        }
    });

    const avg = stats.count > 0 ? Math.round(stats.total / stats.count) : 0;
    const debtClients = portfolio.filter(c => c.totalDebt > 0);
    const recentDeals = [...allDeals]
        .sort((a, b) => dateValue(b.timestamp) - dateValue(a.timestamp))
        .slice(0, 5);
    const recentNotes = [...allDeals]
        .sort((a, b) => dateValue(b.timestamp) - dateValue(a.timestamp))
        .filter(d => d.notes && d.notes.trim())
        .slice(0, 3);

    let text = `👤 *${escapeMd(name)}* (${escapeMd(username)})\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    text += `📆 *Shu oy:*\n`;
    text += `   📝 Savdolar: *${stats.count} ta*\n`;
    text += `   👥 Sayohatchilar: *${stats.people} kishi*\n`;
    text += `   💰 Jami: *${formatMoney(stats.total)}*\n`;
    text += `   📈 O'rtacha: *${formatMoney(avg)}*\n`;
    if (bestDeal > 0) text += `   🏅 Eng katta: *${formatMoney(bestDeal)}* (${escapeMd(bestDest)})\n`;
    if (topDest) text += `   🌍 Top yo'nalish: *${escapeMd(topDest)}* (${topDestCount} ta)\n`;
    text += `\n`;
    text += `📜 *Barcha vaqt:*\n`;
    text += `   📝 ${allTime.count} ta | 👥 ${allTime.people} kishi | 💰 ${formatMoney(allTime.total)}\n`;
    text += `   🧑‍🤝‍🧑 Mijozlar: *${portfolio.length} ta* (qarzli: *${debtClients.length} ta*)\n\n`;
    text += `💳 *Qarz holati:*\n`;
    text += `   📉 Qarzli savdolar: *${debtSummary.dealsWithDebt} ta*\n`;
    text += `   💰 Umumiy qarz: *${formatMoney(debtSummary.totalDebt)}*\n`;
    text += `   💲 To'langan (qarzli savdolarda): *${formatMoney(debtSummary.totalPaid)}*\n`;

    if (debtSummary.topCases.length > 0) {
        text += `\n⚠️ *Asosiy qarzdorlar:*\n`;
        debtSummary.topCases.slice(0, 3).forEach((c, i) => {
            text += `${i + 1}. *${escapeMd(c.clientName)}* — ${formatMoney(c.debt)}\n`;
            if (c.contact) text += `   📞 ${escapeMd(c.contact)}\n`;
            if (c.contractNumber) text += `   📄 ${escapeMd(c.contractNumber)}\n`;
        });
    }

    if (recentDeals.length > 0) {
        text += `\n📋 *So'nggi savdolar (all-time):*\n`;
        recentDeals.forEach((d, i) => {
            const debt = Math.max(0, d.price - d.paidAmount);
            text += `${i + 1}. ${escapeMd(d.clientName)} — ${formatMoney(d.price)} | 🌍 ${escapeMd(d.destination)}`;
            if (debt > 0) text += ` (qarz: ${formatMoney(debt)})`;
            text += `\n`;
        });
    }

    if (recentNotes.length > 0) {
        text += `\n📝 *So'nggi izohlar:*\n`;
        recentNotes.forEach((d, i) => {
            text += `${i + 1}. ${escapeMd(d.clientName)}: _${escapeMd(shortText(d.notes, 60))}_\n`;
        });
    }

    const kb = new InlineKeyboard()
        .text('👥 Boshqa menejer', 'admin:manager_stats').row()
        .text('⬅️ Admin panel', 'admin:back_panel');

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ================ TOP DESTINATIONS ================

async function handleTopDestinations(ctx: MyContext) {
    const deals = await sheetsService.getMonthlyDeals();
    const destMap = new Map<string, { count: number; revenue: number; people: number }>();

    deals.forEach(d => {
        if (!d.destination) return;
        if (!destMap.has(d.destination)) destMap.set(d.destination, { count: 0, revenue: 0, people: 0 });
        const entry = destMap.get(d.destination)!;
        entry.count++;
        entry.revenue += d.price;
        entry.people += d.numberOfPeople;
    });

    const sorted = Array.from(destMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue);

    if (sorted.length === 0) {
        await ctx.reply('🌍 _Bu oy hali yo\'nalishlar yo\'q._', { parse_mode: 'Markdown' });
        return;
    }

    let text = `🌍 *Yo'nalishlar statistikasi (bu oy):*\n\n`;
    sorted.forEach(([dest, data], i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        text += `${medal} *${dest}*\n`;
        text += `   📝 ${data.count} ta savdo | 👥 ${data.people} kishi | 💰 ${formatMoney(data.revenue)}\n\n`;
    });

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: backButton() });
}

// ================ USERS LIST ================

async function handleUsersList(ctx: MyContext) {
    const users = await userService.getUsers();

    if (users.length === 0) {
        await ctx.reply('👥 _Hech qanday foydalanuvchi topilmadi._', { parse_mode: 'Markdown' });
        return;
    }

    let text = `👥 *Foydalanuvchilar (${users.length} ta):*\n\n`;

    users.forEach((u, i) => {
        const isAdm = isAdmin(u.id, config.ADMIN_IDS);
        const role = isAdm ? '👑' : '👤';
        const username = u.username ? `@${escapeMd(u.username)}` : '_username yo\'q_';
        const active = u.lastActive ? u.lastActive.slice(0, 10) : '-';
        text += `${i + 1}. ${role} *${escapeMd(u.name)}* (${username})\n`;
        text += `   🆔 \`${u.id}\` | 📅 ${active}\n`;
    });

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: backButton() });
}

// ================ BROADCAST ================

async function handleBroadcastStart(ctx: MyContext) {
    ctx.session.adminStep = 'broadcast';
    await ctx.reply(
        '📢 *Xabar yuborish*\n\n' +
        `Barcha ${await userService.getUserCount()} ta foydalanuvchiga yuboriladigan xabarni yozing:`,
        { parse_mode: 'Markdown' }
    );
}

// ================ REMIND NOW ================

async function handleRemindNow(ctx: MyContext) {
    const users = await userService.getUsers();

    const message =
        `Assalomu alaykum, Lemon Tour xodimi! 🍋\n\n` +
        `Ish vaqti tugashi oz qoldi, iltimos bugungi *hisobotlaringizni* tezroq topshiring.\n\n` +
        `⚠️ *Eslatma:* Hisobot topshirish majburiydir.\n\n` +
        `Rahmat va muvaffaqiyatlar! 🚀`;

    let sent = 0;
    for (const user of users) {
        try {
            await ctx.api.sendMessage(user.id, message, { parse_mode: 'Markdown' });
            sent++;
        } catch (e) {
            console.error(`Eslatma xato (${user.id}):`, e);
        }
    }

    await ctx.reply(`✅ Eslatma *${sent}* / ${users.length} ta foydalanuvchiga yuborildi.`, { parse_mode: 'Markdown' });
}

// ================ ADMIN TEXT HANDLERS ================

export async function handleAdminTextInput(ctx: MyContext): Promise<boolean> {
    if (!checkAdmin(ctx)) return false;

    const adminStep = ctx.session?.adminStep;
    if (!adminStep || adminStep === 'idle') return false;

    const text = ctx.msg?.text;
    if (!text) return false;

    switch (adminStep) {
        case 'broadcast': {
            const users = await userService.getUsers();
            let sent = 0;

            await ctx.reply(`📢 *${users.length}* ta foydalanuvchiga xabar yuborilmoqda...`, { parse_mode: 'Markdown' });

            for (const user of users) {
                try {
                    await ctx.api.sendMessage(
                        user.id,
                        `📢 <b>DIQQAT — E'LON:</b>\n\n${escapeHtml(text)}`,
                        { parse_mode: 'HTML' }
                    );
                    sent++;
                } catch (e) {
                    console.error(`Xabar xato (${user.id}):`, e);
                }
            }

            ctx.session.adminStep = 'idle';
            await ctx.reply(`✅ Xabar *${sent}* / ${users.length} ta foydalanuvchiga yuborildi.`, { parse_mode: 'Markdown' });
            return true;
        }

        default:
            ctx.session.adminStep = 'idle';
            return false;
    }
}

// ================ HELPERS ================

function shortText(text: string, maxLen = 50): string {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function dateValue(timestamp: string): number {
    if (!timestamp) return 0;
    const match = timestamp.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?/);
    if (match) {
        const [, day, month, year, hour = '0', minute = '0'] = match;
        return new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            0
        ).getTime();
    }
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function backButton(): InlineKeyboard {
    return new InlineKeyboard().text('⬅️ Admin panel', 'admin:back_panel');
}
