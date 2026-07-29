import { Keyboard, InlineKeyboard } from 'grammy';

// ================ REPLY KEYBOARDS ================

export const keyboards = {
    main: new Keyboard()
        .text('🍋 Yangi savdo').row()
        .text('📊 Mening statistikam').text('📋 Mening savdolarim').row()
        .text('👤 Mening CRM').text('💳 Qarzlar')
        .resized()
        .persistent(),

    cancel: new Keyboard()
        .text('❌ Bekor qilish')
        .resized(),
};

// ================ WIZARD INLINE KEYBOARDS ================

export const wizardKb = {
    cancel: new InlineKeyboard().text('❌ Bekor qilish', 'wiz:cancel'),

    cancelWithSkip: new InlineKeyboard()
        .text('⏭ O\'tkazib yuborish', 'wiz:skip').row()
        .text('❌ Bekor qilish', 'wiz:cancel'),

    people: (() => {
        const kb = new InlineKeyboard();
        for (let i = 1; i <= 5; i++) kb.text(`${i}`, `wiz:people:${i}`);
        kb.row();
        for (let i = 6; i <= 10; i++) kb.text(`${i}`, `wiz:people:${i}`);
        kb.row();
        kb.text('15', 'wiz:people:15').text('20', 'wiz:people:20').text('25+', 'wiz:people:25');
        kb.row();
        kb.text('❌ Bekor qilish', 'wiz:cancel');
        return kb;
    })(),

    destinations: (() => {
        const kb = new InlineKeyboard();
        const dests = [
            { flag: '🇹🇷', name: 'Turkiya', code: 'turkiya' },
            { flag: '🇦🇪', name: 'Dubai', code: 'dubai' },
            { flag: '🇹🇭', name: 'Tailand', code: 'tailand' },
            { flag: '🇻🇳', name: 'Vietnam', code: 'vietnam' },
            { flag: '🇨🇳', name: 'Xitoy', code: 'xitoy' },
            { flag: '🇲🇾', name: 'Malayziya', code: 'malayziya' },
            { flag: '🇮🇩', name: 'Bali', code: 'bali' },
            { flag: '🇶🇦', name: 'Qatar', code: 'qatar' },
            { flag: '🇪🇬', name: 'Sharm el Sheikh', code: 'sharm' },
            { flag: '🇬🇪', name: 'Gruziya', code: 'gruziya' },
            { flag: '🇦🇿', name: 'Azerbayjan', code: 'azerbayjan' },
            { flag: '🇰🇷', name: 'Koreya', code: 'koreya' },
            { flag: '🇯🇵', name: 'Yaponiya', code: 'yaponiya' },
            { flag: '🇲🇻', name: 'Maldiv', code: 'maldiv' },
            { flag: '🇸🇦', name: 'S. Arabiston', code: 'arabiston' },
            { flag: '🇮🇳', name: 'Hindiston', code: 'hindiston' },
        ];

        for (let i = 0; i < dests.length; i += 2) {
            const d1 = dests[i];
            const d2 = dests[i + 1];
            if (d2) {
                kb.text(`${d1.flag} ${d1.name}`, `wiz:dest:${d1.name}`)
                    .text(`${d2.flag} ${d2.name}`, `wiz:dest:${d2.name}`);
            } else {
                kb.text(`${d1.flag} ${d1.name}`, `wiz:dest:${d1.name}`);
            }
            kb.row();
        }

        kb.text('🌍 Boshqa yo\'nalish...', 'wiz:dest:other').row();
        kb.text('❌ Bekor qilish', 'wiz:cancel');
        return kb;
    })(),

    confirm: new InlineKeyboard()
        .text('✅ Tasdiqlash', 'wiz:confirm').row()
        .text('✏️ Tahrirlash', 'wiz:edit').row()
        .text('❌ Bekor qilish', 'wiz:cancel'),

    editFields: new InlineKeyboard()
        .text('👤 Mijoz ismi', 'wiz:editfield:name')
        .text('👥 Odamlar', 'wiz:editfield:people').row()
        .text('📅 Uchish', 'wiz:editfield:departure')
        .text('📅 Qaytish', 'wiz:editfield:return').row()
        .text('📞 Telefon', 'wiz:editfield:phone')
        .text('💰 Narx', 'wiz:editfield:price').row()
        .text('🌍 Yo\'nalish', 'wiz:editfield:dest')
        .text('📄 Shartnoma', 'wiz:editfield:contract').row()
        .text('💳 To\'langan', 'wiz:editfield:paid')
        .text('📝 Izoh', 'wiz:editfield:notes').row()
        .text('⬅️ Orqaga', 'wiz:editback'),
};

// ================ ADMIN INLINE KEYBOARDS ================

export const inlineKeyboards = {
    adminPanel: new InlineKeyboard()
        .text('📊 Bugungi hisobot', 'admin:today_report')
        .text('📅 Haftalik', 'admin:weekly_report').row()
        .text('📆 Oylik hisobot', 'admin:monthly_report')
        .text('👥 Menejer stats', 'admin:manager_stats').row()
        .text('🌍 Yo\'nalishlar', 'admin:top_destinations')
        .text('👥 Foydalanuvchilar', 'admin:users').row()
        .text('📊 Boss dashboard', 'admin:boss_dashboard').row()
        .text('📢 Xabar yuborish', 'admin:broadcast').row()
        .text('🔔 Hozir eslatma', 'admin:remind_now'),
};

// ================ DESTINATION LOOKUP ================

export const DESTINATIONS: Record<string, string> = {
    turkiya: '🇹🇷 Turkiya',
    dubai: '🇦🇪 Dubai',
    tailand: '🇹🇭 Tailand',
    vietnam: '🇻🇳 Vietnam',
    xitoy: '🇨🇳 Xitoy',
    malayziya: '🇲🇾 Malayziya',
    bali: '🇮🇩 Bali',
    qatar: '🇶🇦 Qatar',
    sharm: '🇪🇬 Sharm el Sheikh',
    gruziya: '🇬🇪 Gruziya',
    azerbayjan: '🇦🇿 Azerbayjan',
    koreya: '🇰🇷 Koreya',
    yaponiya: '🇯🇵 Yaponiya',
    maldiv: '🇲🇻 Maldiv',
    arabiston: '🇸🇦 S. Arabiston',
    hindiston: '🇮🇳 Hindiston',
};
