import { MyContext, Deal } from '../types';
import { sheetsService } from '../services/sheets';
import { dashboardService } from '../services/dashboardService';
import { config } from '../config';
import { wizardKb, keyboards } from '../utils/keyboard';
import {
    isValidDate, isDateOnOrAfter, isValidPhone, isValidPrice, isValidName,
    parsePrice, generateDealId, formatMoney,
    renderWizardStep, renderDealCard, renderSuccessMessage,
    wizardProgress, formatDateTime, escapeHtml,
} from '../utils/helpers';

// ================ WIZARD ENGINE ================
// Uses message-editing pattern: ONE message updates throughout the wizard.
// Session stores: step, tempDeal, wizardMessageId

const TOTAL_STEPS = 9;

function getFilledFields(deal: any): { icon: string; label: string; value: string }[] {
    const fields: { icon: string; label: string; value: string }[] = [];
    if (deal.clientName) fields.push({ icon: '👤', label: 'Mijoz', value: deal.clientName });
    if (deal.numberOfPeople) fields.push({ icon: '👥', label: 'Odamlar', value: `${deal.numberOfPeople} kishi` });
    if (deal.departureDate) fields.push({ icon: '✈️', label: 'Uchish', value: deal.departureDate });
    if (deal.returnDate) fields.push({ icon: '📅', label: 'Qaytish', value: deal.returnDate });
    if (deal.contact) fields.push({ icon: '📞', label: 'Telefon', value: deal.contact });
    if (deal.price) fields.push({ icon: '💰', label: 'Narx', value: formatMoney(deal.price) });
    if (deal.destination) fields.push({ icon: '🌍', label: "Yo'nalish", value: deal.destination });
    if (deal.contractNumber) fields.push({ icon: '📄', label: 'Shartnoma', value: deal.contractNumber });
    if (deal.paidAmount !== undefined && deal.price) {
        fields.push({ icon: '💳', label: 'To\'langan', value: formatMoney(deal.paidAmount) });
        const debt = deal.price - deal.paidAmount;
        if (debt > 0) fields.push({ icon: '📉', label: 'Qarz', value: formatMoney(debt) });
    }
    return fields;
}

// ================ STEP RENDERERS ================

function renderStep(step: string, deal: any): { text: string; keyboard: any } {
    const filled = getFilledFields(deal);

    switch (step) {
        case 'name':
            return {
                text: renderWizardStep(1, TOTAL_STEPS,
                    '👤 *Mijoz ismini kiriting:*',
                    'Mijozning to\'liq ismini yozing',
                    filled),
                keyboard: wizardKb.cancel,
            };

        case 'people':
            return {
                text: renderWizardStep(2, TOTAL_STEPS,
                    '👥 *Necha kishi boradi?*',
                    'Quyidan tanlang yoki raqam yozing',
                    filled),
                keyboard: wizardKb.people,
            };

        case 'departure':
            return {
                text: renderWizardStep(3, TOTAL_STEPS,
                    '✈️ *Uchish sanasini kiriting:*',
                    'Format: KK.OO.YYYY (masalan: 25.03.2026)',
                    filled),
                keyboard: wizardKb.cancel,
            };

        case 'return':
            return {
                text: renderWizardStep(4, TOTAL_STEPS,
                    '📅 *Qaytish sanasini kiriting:*',
                    'Format: KK.OO.YYYY (masalan: 01.04.2026)',
                    filled),
                keyboard: wizardKb.cancel,
            };

        case 'phone':
            return {
                text: renderWizardStep(5, TOTAL_STEPS,
                    '📞 *Telefon raqam:*',
                    '+998 XX XXX XX XX formatda',
                    filled),
                keyboard: wizardKb.cancel,
            };

        case 'price':
            return {
                text: renderWizardStep(6, TOTAL_STEPS,
                    '💰 *Narxni kiriting ($):*',
                    'Faqat raqam kiriting (masalan: 1200)',
                    filled),
                keyboard: wizardKb.cancel,
            };

        case 'destination':
            return {
                text: renderWizardStep(7, TOTAL_STEPS,
                    '🌍 *Yo\'nalishni tanlang:*',
                    'Quyidan tanlang yoki o\'zingiz yozing',
                    filled),
                keyboard: wizardKb.destinations,
            };

        case 'contract':
            return {
                text: renderWizardStep(8, TOTAL_STEPS,
                    '📄 *Shartnoma raqamini kiriting:*',
                    'Shartnoma raqamini yozing',
                    filled),
                keyboard: wizardKb.cancel,
            };

        case 'paid':
            return {
                text: renderWizardStep(8, TOTAL_STEPS,
                    '💳 *To\'langan summa ($):*',
                    'Mijoz qancha to\'lagan? Raqam kiriting (masalan: 800)\nAgar hech narsa to\'lamagan bo\'lsa 0 yozing',
                    filled),
                keyboard: wizardKb.cancel,
            };

        case 'notes':
            return {
                text: renderWizardStep(9, TOTAL_STEPS,
                    '📝 *Izoh (ixtiyoriy):*',
                    'Qo\'shimcha ma\'lumot kiriting yoki o\'tkazib yuboring',
                    [...filled]),
                keyboard: wizardKb.cancelWithSkip,
            };

        case 'confirm': {
            const card = renderDealCard(deal);
            const text =
                `🍋 *SAVDO TASDIQLASH*\n` +
                `${wizardProgress(TOTAL_STEPS, TOTAL_STEPS)}\n\n` +
                `${card}\n\n` +
                `_Ma'lumotlar to'g'rimi?_`;
            return { text, keyboard: wizardKb.confirm };
        }

        case 'editField': {
            const card = renderDealCard(deal);
            return {
                text: `✏️ *Tahrirlash*\n\n${card}\n\n_Qaysi ma'lumotni o'zgartirmoqchisiz?_`,
                keyboard: wizardKb.editFields,
            };
        }

        default:
            return {
                text: '🍋 Yangi savdo boshlash uchun tugmani bosing.',
                keyboard: wizardKb.cancel,
            };
    }
}

// ================ WIZARD MESSAGE MANAGEMENT ================

async function sendOrEditWizard(ctx: MyContext, step: string, errorMsg?: string) {
    const { text, keyboard } = renderStep(step, ctx.session.tempDeal);

    // Append error inline at the bottom of the wizard message
    const finalText = errorMsg
        ? `${text}\n\n⚠️ *${errorMsg}*`
        : text;

    const wizMsgId = ctx.session.wizardMessageId;

    try {
        if (wizMsgId) {
            await ctx.api.editMessageText(
                ctx.chat!.id,
                wizMsgId,
                finalText,
                { parse_mode: 'Markdown', reply_markup: keyboard }
            );
        } else {
            const msg = await ctx.reply(finalText, {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
            ctx.session.wizardMessageId = msg.message_id;
        }
    } catch (e: any) {
        if (e.description?.includes('message is not modified')) return;
        try {
            const msg = await ctx.reply(finalText, {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
            ctx.session.wizardMessageId = msg.message_id;
        } catch (e2) {
            console.error('Wizard xabar yuborishda xatolik:', e2);
        }
    }
}

async function tryDeleteUserMessage(ctx: MyContext) {
    try {
        if (ctx.msg?.message_id) {
            await ctx.api.deleteMessage(ctx.chat!.id, ctx.msg.message_id);
        }
    } catch {
        // Can't delete — not a problem
    }
}

// ================ START WIZARD ================

export async function startWizard(ctx: MyContext) {
    ctx.session.step = 'name';
    ctx.session.adminStep = 'idle';
    ctx.session.tempDeal = { dealId: generateDealId() };
    ctx.session.wizardMessageId = undefined;

    await sendOrEditWizard(ctx, 'name');
}

// ================ WIZARD TEXT INPUT HANDLER ================

export async function handleWizardText(ctx: MyContext): Promise<boolean> {
    const step = ctx.session.step;
    if (!step || step === 'idle') return false;

    const text = ctx.msg?.text;
    if (!text) return false;

    // Bekor qilish (Reply keyboard)
    if (text === '❌ Bekor qilish') {
        ctx.session.step = 'idle';
        ctx.session.tempDeal = {};
        ctx.session.wizardMessageId = undefined;
        await ctx.reply('❌ Savdo bekor qilindi.', { reply_markup: keyboards.main });
        return true;
    }

    const deal = ctx.session.tempDeal;

    switch (step) {
        case 'name': {
            await tryDeleteUserMessage(ctx);
            if (!isValidName(text)) {
                await sendOrEditWizard(ctx, 'name', 'Ism kamida 2 harfdan iborat bo\'lishi kerak.');
                return true;
            }
            deal.clientName = text;
            ctx.session.step = 'people';
            await sendOrEditWizard(ctx, 'people');
            return true;
        }

        case 'people': {
            const num = parseInt(text, 10);
            if (isNaN(num) || num < 1 || num > 100) {
                await tryDeleteUserMessage(ctx);
                return true;
            }
            deal.numberOfPeople = num;
            ctx.session.step = 'departure';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'departure');
            return true;
        }

        case 'departure': {
            await tryDeleteUserMessage(ctx);
            if (!isValidDate(text)) {
                await sendOrEditWizard(ctx, 'departure', 'Noto\'g\'ri format! KK.OO.YYYY kiriting (masalan: 25.03.2026)');
                return true;
            }
            deal.departureDate = text;
            ctx.session.step = 'return';
            await sendOrEditWizard(ctx, 'return');
            return true;
        }

        case 'return': {
            await tryDeleteUserMessage(ctx);
            if (!isValidDate(text)) {
                await sendOrEditWizard(ctx, 'return', 'Noto\'g\'ri format! KK.OO.YYYY kiriting (masalan: 01.04.2026)');
                return true;
            }
            if (deal.departureDate && !isDateOnOrAfter(text, deal.departureDate)) {
                await sendOrEditWizard(ctx, 'return', 'Qaytish sanasi uchish sanasidan oldin bo‘lishi mumkin emas.');
                return true;
            }
            deal.returnDate = text;
            ctx.session.step = 'phone';
            await sendOrEditWizard(ctx, 'phone');
            return true;
        }

        case 'phone': {
            await tryDeleteUserMessage(ctx);
            if (!isValidPhone(text)) {
                await sendOrEditWizard(ctx, 'phone', 'Noto\'g\'ri raqam! +998 XX XXX XX XX formatda kiriting.');
                return true;
            }
            deal.contact = text;
            ctx.session.step = 'price';
            await sendOrEditWizard(ctx, 'price');
            return true;
        }

        case 'price': {
            await tryDeleteUserMessage(ctx);
            if (!isValidPrice(text)) {
                await sendOrEditWizard(ctx, 'price', 'Noto\'g\'ri narx! Faqat raqam kiriting (masalan: 1200)');
                return true;
            }
            deal.price = parsePrice(text);
            ctx.session.step = 'destination';
            await sendOrEditWizard(ctx, 'destination');
            return true;
        }

        case 'destination': {
            // Custom destination typed by user
            deal.destination = text;
            ctx.session.step = 'contract';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'contract');
            return true;
        }

        case 'contract': {
            deal.contractNumber = text;
            ctx.session.step = 'paid';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'paid');
            return true;
        }

        case 'paid': {
            await tryDeleteUserMessage(ctx);
            if (!isValidPrice(text)) {
                await sendOrEditWizard(ctx, 'paid', 'Noto\'g\'ri summa! Faqat raqam kiriting (masalan: 800). 0 ham mumkin.');
                return true;
            }
            const paidNum = parsePrice(text);
            if (deal.price !== undefined && paidNum > deal.price) {
                await sendOrEditWizard(
                    ctx,
                    'paid',
                    `To‘langan summa savdo narxidan oshmasligi kerak (${formatMoney(deal.price)}).`
                );
                return true;
            }
            deal.paidAmount = paidNum;
            ctx.session.step = 'notes';
            await sendOrEditWizard(ctx, 'notes');
            return true;
        }

        case 'notes': {
            deal.notes = text;
            ctx.session.step = 'confirm';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }

        // Edit mode — user types new value for the field being edited
        case 'editName': {
            if (!isValidName(text)) return true;
            deal.clientName = text;
            ctx.session.step = 'confirm';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }
        case 'editDeparture': {
            if (!isValidDate(text)) return true;
            deal.departureDate = text;
            ctx.session.step = 'confirm';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }
        case 'editReturn': {
            if (!isValidDate(text)) return true;
            deal.returnDate = text;
            ctx.session.step = 'confirm';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }
        case 'editPhone': {
            if (!isValidPhone(text)) return true;
            deal.contact = text;
            ctx.session.step = 'confirm';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }
        case 'editPrice': {
            if (!isValidPrice(text)) return true;
            deal.price = parsePrice(text);
            ctx.session.step = 'confirm';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }
        case 'editDest': {
            deal.destination = text;
            ctx.session.step = 'confirm';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }
        case 'editContract': {
            deal.contractNumber = text;
            ctx.session.step = 'confirm';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }
        case 'editPaid': {
            if (!isValidPrice(text)) {
                await sendOrEditWizard(ctx, 'paid', 'Noto‘g‘ri summa.');
                return true;
            }
            const paidAmount = parsePrice(text);
            if (deal.price !== undefined && paidAmount > deal.price) {
                await sendOrEditWizard(
                    ctx,
                    'paid',
                    `To‘langan summa savdo narxidan oshmasligi kerak (${formatMoney(deal.price)}).`
                );
                return true;
            }
            deal.paidAmount = paidAmount;
            ctx.session.step = 'confirm';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }
        case 'editNotes': {
            deal.notes = text;
            ctx.session.step = 'confirm';
            await tryDeleteUserMessage(ctx);
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }
    }

    return false;
}

// ================ WIZARD CALLBACK HANDLER ================

export async function handleWizardCallback(ctx: MyContext): Promise<boolean> {
    const data = ctx.callbackQuery?.data;
    if (!data?.startsWith('wiz:')) return false;

    const step = ctx.session.step;
    const deal = ctx.session.tempDeal;

    // Cancel
    if (data === 'wiz:cancel') {
        ctx.session.step = 'idle';
        ctx.session.tempDeal = {};
        ctx.session.wizardMessageId = undefined;
        await ctx.answerCallbackQuery({ text: '❌ Bekor qilindi' });
        await ctx.editMessageText('❌ Savdo bekor qilindi.', { reply_markup: undefined });
        await ctx.reply('🍋 Asosiy menyu:', { reply_markup: keyboards.main });
        return true;
    }

    // Skip (notes, contract, debt)
    if (data === 'wiz:skip') {
        if (step === 'notes') {
            deal.notes = '';
            ctx.session.step = 'confirm';
            await ctx.answerCallbackQuery();
            await sendOrEditWizard(ctx, 'confirm');
            return true;
        }
    }

    // People selection
    if (data.startsWith('wiz:people:')) {
        const num = parseInt(data.split(':')[2], 10);
        deal.numberOfPeople = num;
        ctx.session.step = 'departure';
        await ctx.answerCallbackQuery({ text: `👥 ${num} kishi tanlandi` });
        await sendOrEditWizard(ctx, 'departure');
        return true;
    }

    // Destination selection
    if (data.startsWith('wiz:dest:')) {
        const destValue = data.replace('wiz:dest:', '');
        if (destValue === 'other') {
            // Let user type custom destination
            await ctx.answerCallbackQuery({ text: '🌍 Yo\'nalishni yozing...' });
            // Keep step as destination — text handler will catch it
            return true;
        }
        deal.destination = destValue;
        ctx.session.step = 'contract';
        await ctx.answerCallbackQuery({ text: `🌍 ${destValue} tanlandi` });
        await sendOrEditWizard(ctx, 'contract');
        return true;
    }

    // Confirm
    if (data === 'wiz:confirm') {
        if (ctx.session.confirmingDealId) {
            await ctx.answerCallbackQuery({ text: '⏳ Savdo allaqachon saqlanmoqda...' });
            return true;
        }
        ctx.session.confirmingDealId = deal.dealId || 'pending';
        await ctx.answerCallbackQuery({ text: '✅ Saqlanmoqda...' });
        await handleConfirm(ctx);
        return true;
    }

    // Edit
    if (data === 'wiz:edit') {
        ctx.session.step = 'editField';
        await ctx.answerCallbackQuery();
        await sendOrEditWizard(ctx, 'editField');
        return true;
    }

    // Edit back to confirm
    if (data === 'wiz:editback') {
        ctx.session.step = 'confirm';
        await ctx.answerCallbackQuery();
        await sendOrEditWizard(ctx, 'confirm');
        return true;
    }

    // Edit specific field
    if (data.startsWith('wiz:editfield:')) {
        const field = data.replace('wiz:editfield:', '');
        const fieldMap: Record<string, { step: string; alert: string }> = {
            name: { step: 'editName', alert: '👤 Yangi ismni yozing' },
            people: { step: 'people', alert: '👥 Odamlar sonini tanlang' },
            departure: { step: 'editDeparture', alert: '✈️ Yangi uchish sanasini yozing' },
            return: { step: 'editReturn', alert: '📅 Yangi qaytish sanasini yozing' },
            phone: { step: 'editPhone', alert: '📞 Yangi raqamni yozing' },
            price: { step: 'editPrice', alert: '💰 Yangi narxni yozing' },
            dest: { step: 'editDest', alert: '🌍 Yangi yo\'nalishni yozing' },
            contract: { step: 'editContract', alert: '📄 Yangi shartnoma raqamini yozing' },
            paid: { step: 'editPaid', alert: '💳 Yangi to\'langan summani yozing' },
            notes: { step: 'editNotes', alert: '📝 Yangi izohni yozing' },
        };

        const mapping = fieldMap[field];
        if (mapping) {
            ctx.session.step = mapping.step as any;
            await ctx.answerCallbackQuery({ text: mapping.alert });

            // For people — show people keyboard
            if (field === 'people') {
                await sendOrEditWizard(ctx, 'people');
            } else if (field === 'dest') {
                await sendOrEditWizard(ctx, 'destination');
            } else {
                // Text input — show instruction
                const { text, keyboard } = renderStep(mapping.step, deal);
                const editText = `✏️ *Tahrirlash:*\n\n_${mapping.alert}_`;
                try {
                    await ctx.editMessageText(editText, {
                        parse_mode: 'Markdown',
                        reply_markup: wizardKb.cancel,
                    });
                } catch {
                    await ctx.reply(editText, {
                        parse_mode: 'Markdown',
                        reply_markup: wizardKb.cancel,
                    });
                }
            }
            return true;
        }
    }

    await ctx.answerCallbackQuery();
    return true;
}

// ================ CONFIRM & SAVE ================

async function handleConfirm(ctx: MyContext) {
    const deal = ctx.session.tempDeal;
    const managerName = ctx.from?.first_name || 'Nomalum';
    const managerUsername = ctx.from?.username ? `@${ctx.from.username}` : '';

    const now = new Date();
    const timestamp = formatDateTime(now);

    const finalDeal: Deal = {
        timestamp,
        dealId: deal.dealId || generateDealId(),
        managerId: ctx.from?.id || 0,
        clientName: deal.clientName || '',
        numberOfPeople: deal.numberOfPeople || 1,
        departureDate: deal.departureDate || '',
        returnDate: deal.returnDate || '',
        contact: deal.contact || '',
        destination: deal.destination || '',
        price: deal.price || 0,
        paidAmount: deal.paidAmount || 0,
        contractNumber: deal.contractNumber || '',
        notes: deal.notes || '',
        managerName,
        managerUsername,
        status: 'confirmed',
    };

    try {
        try {
            await ctx.editMessageText('⏳ <b>Savdo saqlanmoqda…</b>', {
                parse_mode: 'HTML',
                reply_markup: undefined,
            });
        } catch {
            // The callback may come from an old message; saving can still continue safely.
        }

        // Save to Google Sheets
        await sheetsService.appendDeal(finalDeal);
        void dashboardService.refresh().catch(error => {
            console.error('Boss dashboardni yangilashda xatolik:', error);
        });

        // Get today stats for celebration
        const todayDeals = await sheetsService.getTodayDeals();
        const todayTotal = todayDeals.reduce((sum, d) => sum + d.price, 0);
        // Update wizard message with success
        const successText = renderSuccessMessage(
            finalDeal,
            todayDeals.length,
            todayTotal,
        );

        try {
            await ctx.editMessageText(successText, { parse_mode: 'Markdown' });
        } catch {
            await ctx.reply(successText, { parse_mode: 'Markdown' });
        }

        // Send to channel
        if (config.CHANNEL_ID) {
            const debt = finalDeal.price - finalDeal.paidAmount;
            const channelText =
                `🍋 <b>YANGI SAVDO — LEMON TOUR</b>\n\n` +
                `🆔 <code>${escapeHtml(finalDeal.dealId)}</code>\n` +
                `👤 Mijoz: <b>${escapeHtml(finalDeal.clientName)}</b>\n` +
                `👥 Odamlar: <b>${finalDeal.numberOfPeople} kishi</b>\n` +
                `✈️ ${escapeHtml(finalDeal.departureDate)} → ${escapeHtml(finalDeal.returnDate)}\n` +
                `📞 ${escapeHtml(finalDeal.contact)}\n` +
                `🌍 <b>${escapeHtml(finalDeal.destination)}</b>\n` +
                `💰 <b>${formatMoney(finalDeal.price)}</b>\n` +
                `💳 To'langan: <b>${formatMoney(finalDeal.paidAmount)}</b>\n` +
                (debt > 0 ? `📉 Qarz: <b>${formatMoney(debt)}</b> ⚠️\n` : `✅ To'liq to'langan\n`) +
                `📄 Shartnoma: <b>${escapeHtml(finalDeal.contractNumber || '-')}</b>\n` +
                (finalDeal.notes ? `📝 ${escapeHtml(finalDeal.notes)}\n` : '') +
                `\n👱 Menejer: <b>${escapeHtml(managerName)}</b>` +
                (managerUsername ? ` (${escapeHtml(managerUsername)})` : '');

            try {
                await ctx.api.sendMessage(config.CHANNEL_ID, channelText, {
                    parse_mode: 'HTML',
                    message_thread_id: config.CHANNEL_THREAD_ID,
                });
            } catch (e) {
                console.error('Kanalga yuborishda xatolik:', e);
            }
        }

        // Show main menu
        await ctx.reply('🍋 Davom eting:', { reply_markup: keyboards.main });

        ctx.session.step = 'idle';
        ctx.session.tempDeal = {};
        ctx.session.wizardMessageId = undefined;

    } catch (e) {
        console.error('Savdoni saqlashda xatolik:', e);
        ctx.session.step = 'confirm';
        await sendOrEditWizard(
            ctx,
            'confirm',
            'Google Sheets bilan aloqa bo‘lmadi. Ma’lumot saqlanmadi; qayta tasdiqlang.'
        );
    } finally {
        ctx.session.confirmingDealId = undefined;
    }
}
