import { google } from 'googleapis'; // Updated fix 2026-02-16
import { config } from '../config';
import { Deal } from '../types';
import { buildSheetsAuthOptions } from '../utils/googleAuth';

// ================ AUTH ================

const authOptions = buildSheetsAuthOptions(config.GOOGLE_CREDENTIALS);
const auth = new google.auth.GoogleAuth(authOptions);
const sheets = google.sheets({ version: 'v4', auth });

// ================ CACHING ================
// Cache to reduce API calls and improve performance for 15+ managers
let cachedData: any[][] | null = null;
let cachedDeals: ParsedDeal[] | null = null;
let cacheTimestamp = 0;
let cachedRowOffset = 2; // 2 when header row exists, 1 otherwise
const CACHE_TTL = 30000; // 30 seconds cache
const pendingAppends = new Map<string, Promise<void>>();

// ================ COLUMNS ================
// FORMAT v4 (16 columns) - Cleaner Layout:
// A=ID, B=Timestamp, C=ManagerName, D=ClientName, E=Contact (Phone),
// F=Destination, G=DepartureDate, H=ReturnDate, I=Price, J=PaidAmount,
// K=Debt (Calculated), L=ContractNumber, M=Notes, N=Status, O=NumberOfPeople,
// P=ManagerUsername (Hidden)
//
// FORMAT v3 (15 columns):
// A=Timestamp, B=DealID, C=ClientName, D=People, E=DepartureDate,
// F=ReturnDate, G=Contact, H=Destination, I=Price, J=PaidAmount,
// K=ContractNumber, L=Notes, M=ManagerName, N=ManagerUsername, O=Status
//
// OLD FORMAT (9 columns):
// A=Timestamp, B=ClientName, C=DepartureDate, D=ReturnDate,
// E=Contact, F=Destination, G=Price, H=ManagerName, I=ManagerUsername

const RANGE = 'A:Z';

const HEADERS = [
    'Vaqt', 'Savdo ID', 'Mijoz', 'Odamlar', 'Uchish sanasi',
    'Qaytish sanasi', 'Telefon', 'Yo\'nalish', 'Narx ($)', 'To\'langan ($)',
    'Shartnoma raqami', 'Izoh', 'Menejer ismi', 'Menejer username', 'Holat', 'Qarz ($)',
    'Tasdiq (HA/YO\'Q)', 'Menejer Telegram ID'
];

export type SheetRowFormat = 'v4' | 'v3' | 'legacy';

// ================ ROW PARSER ================
// Automatically detects old (9 col) vs new (13 col) format

export interface ParsedDeal {
    timestamp: string;
    dealId: string;
    clientName: string;
    numberOfPeople: number;
    departureDate: string;
    returnDate: string;
    contact: string;
    destination: string;
    price: number;
    paidAmount: number;
    contractNumber: string;
    notes: string;
    managerName: string;
    managerUsername: string;
    managerId?: number;
    status: string;
    rowIndex?: number; // for updating rows
    sourceFormat: SheetRowFormat;
}

export interface ManagerClientPortfolioItem {
    clientName: string;
    contact: string;
    totalDeals: number;
    totalRevenue: number;
    totalPaid: number;
    totalDebt: number;
    lastDealId: string;
    lastDealTimestamp: string;
    lastDestination: string;
    lastNotes: string;
}

export interface ManagerDebtCase {
    dealId: string;
    clientName: string;
    contact: string;
    debt: number;
    price: number;
    paidAmount: number;
    contractNumber: string;
    notes: string;
    destination: string;
    timestamp: string;
}

export interface ManagerDebtSummary {
    dealsWithDebt: number;
    totalDebt: number;
    totalPrice: number;
    totalPaid: number;
    topCases: ManagerDebtCase[];
}

export type ManagerIdentity = string | { id?: number; username?: string };

function parseRow(row: any[], index?: number): ParsedDeal {
    const len = row.length;
    // Simple detection:
    // v4: ID is first (A), matches LT-..., has >= 16 cols or ID in col 0
    // v3: Timestamp first, ID is second (B), matches LT-...

    const col0 = (row[0] || '').toString();
    const col1 = (row[1] || '').toString();

    // V4 Detection: Col 0 starts with LT- OR len >= 16 (and Col 1 is timestamp-ish)
    // Actually, V4 ID is Col 0. V3 ID is Col 1.
    const isV4 = col0.startsWith('LT-');
    const isV3 = col1.startsWith('LT-');

    if (isV4) {
        // v4 format (16 columns)
        // A=ID, B=Time, C=Mgr, D=Client, E=Phone, F=Dest, G=Dep, H=Ret, I=Price, J=Paid, K=Debt, L=Cont, M=Note, N=Stat, O=Ppl, P=User
        return {
            dealId: row[0] || '',
            timestamp: row[1] || '',
            managerName: row[2] || '',
            clientName: row[3] || '',
            contact: row[4] || '',
            destination: row[5] || '',
            departureDate: row[6] || '',
            returnDate: row[7] || '',
            price: parseFloat((row[8] || '0').toString().replace(/[^0-9.]/g, '')) || 0,
            paidAmount: parseFloat((row[9] || '0').toString().replace(/[^0-9.]/g, '')) || 0,
            // K (10) is Debt (skip)
            contractNumber: row[11] || '',
            notes: row[12] || '',
            status: row[13] || 'confirmed',
            numberOfPeople: parseInt(row[14]) || 1,
            managerUsername: row[15] || '',
            managerId: Number(row[16]) || undefined,
            rowIndex: index,
            sourceFormat: 'v4',
        };
    } else if (isV3) {
        // v3 format (15 columns)
        return {
            timestamp: row[0] || '',
            dealId: row[1] || '',
            clientName: row[2] || '',
            numberOfPeople: parseInt(row[3]) || 1,
            departureDate: row[4] || '',
            returnDate: row[5] || '',
            contact: row[6] || '',
            destination: row[7] || '',
            price: parseFloat((row[8] || '0').toString().replace(/[^0-9.]/g, '')) || 0,
            paidAmount: parseFloat((row[9] || '0').toString().replace(/[^0-9.]/g, '')) || 0,
            contractNumber: row[10] || '',
            notes: row[11] || '',
            managerName: row[12] || '',
            managerUsername: row[13] || '',
            managerId: Number(row[17]) || undefined,
            status: row[14] || 'confirmed',
            rowIndex: index,
            sourceFormat: 'v3',
        };
    } else if (len >= 10 && col1.startsWith('LT-')) {
        // Fallback for V2 (13 columns) - similar to V3 but fewer cols?
        // Actually V2 ID was also Col 1.
        // Assuming V2/V3 handled by logic above if ID matches.
        // If paidAmount missing, we default to price (handled below if needed, but here we assume V3 structure implies paid column exists or is 0)
        // For legacy V2 (no paid column), checking length:
        const v2Price = parseFloat((row[8] || '0').toString().replace(/[^0-9.]/g, '')) || 0;
        return {
            timestamp: row[0] || '',
            dealId: row[1] || '',
            clientName: row[2] || '',
            numberOfPeople: parseInt(row[3]) || 1,
            departureDate: row[4] || '',
            returnDate: row[5] || '',
            contact: row[6] || '',
            destination: row[7] || '',
            price: v2Price,
            paidAmount: v2Price, // Assume paid if no column
            contractNumber: '',
            notes: row[9] || '',
            managerName: row[10] || '',
            managerUsername: row[11] || '',
            status: row[12] || 'confirmed',
            rowIndex: index,
            sourceFormat: 'v3',
        };
    } else {
        // Old format (9 columns) - ID missing or different
        const oldPrice = parseFloat((row[6] || '0').toString().replace(/[^0-9.]/g, '')) || 0;
        return {
            timestamp: row[0] || '',
            // Legacy rows had no stable ID. Use sheet row as deterministic local ID for tracking.
            dealId: `LEGACY-${index || 0}`,
            clientName: row[1] || '',
            numberOfPeople: 1,
            departureDate: row[2] || '',
            returnDate: row[3] || '',
            contact: row[4] || '',
            destination: row[5] || '',
            price: oldPrice,
            paidAmount: oldPrice,
            contractNumber: '',
            notes: '',
            managerName: row[7] || '',
            managerUsername: row[8] || '',
            status: 'confirmed',
            rowIndex: index,
            sourceFormat: 'legacy',
        };
    }
}

// ================ USERNAME HELPERS ================

function normalizeUsername(u: string): string {
    if (!u) return '';
    return u.trim().toLowerCase().replace(/^@/, '').replace(/\s+/g, '');
}

function usernameMatch(a: string, b: string): boolean {
    const normA = normalizeUsername(a);
    const normB = normalizeUsername(b);
    const match = normA === normB;

    if (a && b && !match) {
        console.log(`⚠️ Username mismatch: "${a}" (${normA}) != "${b}" (${normB})`);
    }

    return match;
}

function managerMatch(deal: ParsedDeal, identity: ManagerIdentity): boolean {
    if (typeof identity === 'string') {
        return usernameMatch(deal.managerUsername, identity);
    }
    if (identity.id && deal.managerId) {
        return deal.managerId === identity.id;
    }
    return usernameMatch(deal.managerUsername, identity.username || '');
}

function identityLabel(identity: ManagerIdentity): string {
    return typeof identity === 'string'
        ? identity
        : `${identity.username || 'no-username'}#${identity.id || 'no-id'}`;
}

function normalizeContact(contact: string): string {
    if (!contact) return '';
    return contact.replace(/\D/g, '');
}

// ================ DATE HELPERS ================

function getTashkentNow(): Date {
    // FIXED: Create a Date whose getDate/getMonth/getFullYear reflect Tashkent time
    // This is critical for isToday/isThisMonth comparisons on UTC servers
    const now = new Date();
    const tashkentStr = now.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' });
    return new Date(tashkentStr);
}

function parseRowDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const s = dateStr.trim();

    // DD.MM.YYYY or DD.MM.YYYY, HH:mm or DD.MM.YYYY HH:mm:ss
    let match = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[\s,]+)?(\d{1,2})?[:\.\s]?(\d{2})?/);
    if (match) {
        return new Date(
            parseInt(match[3]),
            parseInt(match[2]) - 1,
            parseInt(match[1]),
            parseInt(match[4] || '0'),
            parseInt(match[5] || '0')
        );
    }

    // DD/MM/YYYY or DD/MM/YYYY, HH:mm:ss (Google Sheets reformats to this)
    match = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
        return new Date(
            parseInt(match[3]),
            parseInt(match[2]) - 1, // month (MM) is 2nd group
            parseInt(match[1]),     // day (DD) is 1st group
            parseInt(match[4] || '0'),
            parseInt(match[5] || '0'),
            parseInt(match[6] || '0')
        );
    }

    // YYYY-MM-DD or ISO 8601
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;

    console.warn(`⚠️ parseRowDate: tushunilmagan format: "${s}"`);
    return null;
}

function isToday(dateStr: string): boolean {
    const d = parseRowDate(dateStr);
    if (!d) {
        console.warn(`⚠️ isToday: Could not parse date "${dateStr}"`);
        return false;
    }
    const now = getTashkentNow();
    const isToday = d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

    if (!isToday) {
        // Debug: show why it's not today
        console.log(`📅 isToday check: "${dateStr}" -> ${d.toISOString()} vs ${now.toISOString()}`);
    }

    return isToday;
}

function isThisWeek(dateStr: string): boolean {
    const d = parseRowDate(dateStr);
    if (!d) return false;
    const now = getTashkentNow();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return d >= weekAgo && d <= now;
}

function isThisMonth(dateStr: string): boolean {
    const d = parseRowDate(dateStr);
    if (!d) {
        console.warn(`⚠️ isThisMonth: Could not parse date "${dateStr}"`);
        return false;
    }
    const now = getTashkentNow();
    const isMonth = d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

    if (!isMonth) {
        // Debug: show why it's not this month
        console.log(`📅 isThisMonth check: "${dateStr}" -> ${d.getMonth()}/${d.getFullYear()} vs ${now.getMonth()}/${now.getFullYear()}`);
    }

    return isMonth;
}

function getDateValue(dateStr: string): number {
    const d = parseRowDate(dateStr);
    return d ? d.getTime() : 0;
}

function sortDealsByTimestampDesc<T extends { timestamp: string }>(deals: T[]): T[] {
    return deals.sort((a, b) => getDateValue(b.timestamp) - getDateValue(a.timestamp));
}

// ================ HELPERS ================

async function getSheetName(): Promise<string> {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: config.SPREADSHEET_ID });
    const title = meta.data.sheets?.find(
        sheet => sheet.properties?.title !== config.DASHBOARD_SHEET_NAME
            && sheet.properties?.title !== 'Users'
            && sheet.properties?.title !== 'Settings'
    )?.properties?.title;
    if (!title) throw new Error('No sales data sheet was found in the spreadsheet');
    return title;
}

// ================ SERVICE ================

export const sheetsService = {
    async checkConnection(): Promise<{ spreadsheetTitle: string; salesSheetName: string }> {
        if (!config.SPREADSHEET_ID) {
            throw new Error('SPREADSHEET_ID is not configured');
        }
        const response = await sheets.spreadsheets.get({
            spreadsheetId: config.SPREADSHEET_ID,
            fields: 'properties.title,sheets.properties.title',
        });
        return {
            spreadsheetTitle: response.data.properties?.title || 'Untitled spreadsheet',
            salesSheetName: await getSheetName(),
        };
    },

    /**
     * Barcha ma'lumotlarni olish (headersiz), parsed
     * WITH CACHING for better performance with 15+ managers
     */
    async getRawData(): Promise<any[][]> {
        if (!config.SPREADSHEET_ID) return [];

        // Check cache
        const now = Date.now();
        if (cachedData && (now - cacheTimestamp) < CACHE_TTL) {
            console.log('📦 Using cached data');
            return cachedData;
        }

        try {
            const sheetName = await getSheetName();
            console.log(`📥 Fetching data from sheet: ${sheetName}`);

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `'${sheetName}'!${RANGE}`,
            });

            const rows = response.data.values || [];
            console.log(`📊 Retrieved ${rows.length} rows from Sheets`);

            // Agar birinchi qator header bo'lsa — o'tkazib yuborish
            if (rows.length > 0) {
                const h = rows[0][0] ? rows[0][0].toString().trim() : '';
                if (h === 'Vaqt' || h === 'Timestamp' || h === 'ID') {
                    cachedData = rows.slice(1);
                    cachedRowOffset = 2;
                    cacheTimestamp = now;
                    return cachedData;
                }
            }

            cachedData = rows;
            cachedRowOffset = 1;
            cacheTimestamp = now;
            return rows;
        } catch (e: any) {
            console.error('❌ Ma\'lumotlarni olishda xatolik:', e.message);
            // Return cached data if available, even if expired
            if (cachedData) {
                console.log('⚠️ Using stale cached data due to error');
                return cachedData;
            }
            throw new Error(`Google Sheets data could not be loaded: ${e.message}`);
        }
    },

    /**
     * Parsed ma'lumotlar olish
     * WITH CACHING for better performance
     */
    async getParsedData(): Promise<ParsedDeal[]> {
        // Check cache
        const now = Date.now();
        if (cachedDeals && (now - cacheTimestamp) < CACHE_TTL) {
            console.log('📦 Using cached parsed deals');
            return cachedDeals;
        }

        const rows = await this.getRawData();
        const parsedDeals = rows
            .map((r, i) => parseRow(r, i + cachedRowOffset))
            .filter(d => d.status !== 'cancelled' && d.dealId && d.timestamp); // Filter empty/invalid rows

        console.log(`📊 Parsed ${parsedDeals.length} valid deals`);
        cachedDeals = parsedDeals;
        cacheTimestamp = now;
        return parsedDeals;
    },

    async getDataQuality(): Promise<{
        rows: number;
        duplicateDealIds: number;
        missingManager: number;
        missingClient: number;
        invalidAmounts: number;
        legacyRows: number;
    }> {
        const rows = await this.getRawData();
        const deals = rows.map((row, index) => parseRow(row, index + cachedRowOffset));
        const seenIds = new Set<string>();
        let duplicateDealIds = 0;
        let missingManager = 0;
        let missingClient = 0;
        let invalidAmounts = 0;
        let legacyRows = 0;

        deals.forEach(deal => {
            if (deal.dealId) {
                if (seenIds.has(deal.dealId)) duplicateDealIds += 1;
                seenIds.add(deal.dealId);
            }
            if (!deal.managerId && !normalizeUsername(deal.managerUsername)) missingManager += 1;
            if (!deal.clientName.trim()) missingClient += 1;
            if (
                !Number.isFinite(deal.price)
                || !Number.isFinite(deal.paidAmount)
                || deal.price < 0
                || deal.paidAmount < 0
                || deal.paidAmount > deal.price
            ) {
                invalidAmounts += 1;
            }
            if (deal.sourceFormat === 'legacy') legacyRows += 1;
        });

        return {
            rows: deals.length,
            duplicateDealIds,
            missingManager,
            missingClient,
            invalidAmounts,
            legacyRows,
        };
    },

    /**
     * Yangi savdoni yozish
     * IMPROVED: Better validation, error handling, and cache invalidation
     */
    async appendDeal(deal: Deal): Promise<void> {
        const existingOperation = pendingAppends.get(deal.dealId);
        if (existingOperation) return existingOperation;

        const operation = this.appendDealOnce(deal);
        pendingAppends.set(deal.dealId, operation);
        try {
            await operation;
        } finally {
            pendingAppends.delete(deal.dealId);
        }
    },

    async appendDealOnce(deal: Deal): Promise<void> {
        if (!config.SPREADSHEET_ID) {
            console.error('❌ Spreadsheet ID topilmadi — saqlash o\'tkazib yuborildi');
            throw new Error('Spreadsheet ID not configured');
        }

        // Validate required fields
        if (!deal.dealId || !deal.clientName || !Number.isFinite(deal.price) || deal.price <= 0) {
            console.error('❌ Invalid deal data - missing required fields:', {
                dealId: deal.dealId,
                hasClientName: Boolean(deal.clientName),
                hasValidPrice: Number.isFinite(deal.price) && deal.price > 0,
            });
            throw new Error('Invalid deal data: missing required fields');
        }

        // Validate manager info
        if (!deal.managerId || !deal.managerName) {
            console.error('❌ Missing manager information:', {
                managerName: deal.managerName,
                managerUsername: deal.managerUsername,
                managerId: deal.managerId,
            });
            throw new Error('Invalid deal data: missing manager information');
        }

        try {
            const duplicate = (await this.getRawData())
                .map((row, index) => parseRow(row, index + cachedRowOffset))
                .some(existing => existing.dealId === deal.dealId);
            if (duplicate) {
                console.warn(`Duplicate append ignored for deal ${deal.dealId}`);
                return;
            }

            const sheetName = await getSheetName();
            // Ensure headers before detecting the active ledger layout.
            await this.ensureHeaders(sheetName);
            const header = await sheets.spreadsheets.values.get({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `'${sheetName}'!A1:R1`,
            });
            const isV4Layout = header.data.values?.[0]?.[0] === 'ID';
            const range = isV4Layout
                ? `'${sheetName}'!A:Q`
                : `'${sheetName}'!A:R`;
            const debt = deal.price - (deal.paidAmount || 0);
            const values = isV4Layout
                ? [[
                    deal.dealId,
                    deal.timestamp,
                    deal.managerName,
                    deal.clientName,
                    deal.contact ? `'${deal.contact}` : '',
                    deal.destination,
                    deal.departureDate,
                    deal.returnDate,
                    deal.price,
                    deal.paidAmount || 0,
                    debt,
                    deal.contractNumber || '',
                    deal.notes || '',
                    deal.status,
                    deal.numberOfPeople,
                    deal.managerUsername,
                    deal.managerId,
                ]]
                : [[
                    deal.timestamp,
                    deal.dealId,
                    deal.clientName,
                    deal.numberOfPeople,
                    deal.departureDate,
                    deal.returnDate,
                    deal.contact ? `'${deal.contact}` : '',
                    deal.destination,
                    deal.price,
                    deal.paidAmount || 0,
                    deal.contractNumber || '',
                    deal.notes || '',
                    deal.managerName,
                    deal.managerUsername,
                    deal.status,
                    debt,
                    "YO'Q",
                    deal.managerId,
                ]];

            console.log(
                `📝 Saving deal ${deal.dealId} to ${sheetName} (${isV4Layout ? 'v4' : 'canonical v3'} layout)`
            );

            console.log(`📤 Appending row to Sheets...`);
            const res = await sheets.spreadsheets.values.append({
                spreadsheetId: config.SPREADSHEET_ID,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            });

            const updatedRange = res.data.updates?.updatedRange;
            console.log(`✅ Savdo saqlandi: ${deal.dealId} -> ${updatedRange}`);

            // Invalidate cache after successful save
            cachedData = null;
            cachedDeals = null;
            cacheTimestamp = 0;
            console.log('🔄 Cache invalidated after save');

        } catch (error: any) {
            console.error('❌ Sheets-ga yozishda xatolik:', error.message);
            throw error;
        }
    },

    /**
     * Header qatorini tekshirish va yaratish
     */
    async ensureHeaders(sheetName: string): Promise<void> {
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `'${sheetName}'!A1:R1`,
            });

            const firstRow = response.data.values?.[0];
            // Check if header exists — if first cell is 'Vaqt' (V3) or 'ID' (V4), it has a header
            if (!firstRow) {
                // Only write V3 header if sheet is completely empty
                await sheets.spreadsheets.values.update({
                    spreadsheetId: config.SPREADSHEET_ID,
                    range: `'${sheetName}'!A1:R1`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [HEADERS] },
                });
                console.log('📋 Header qatori yaratildi');
            } else if (firstRow[0] === 'Vaqt' && !firstRow[17]) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: config.SPREADSHEET_ID,
                    range: `'${sheetName}'!R1`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [['Menejer Telegram ID']] },
                });
            } else if (firstRow[0] === 'ID' && !firstRow[16]) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: config.SPREADSHEET_ID,
                    range: `'${sheetName}'!Q1`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [['Manager Telegram ID']] },
                });
            }
        } catch (e) {
            console.error('Header tekshirishda xatolik:', e);
        }
    },

    /**
     * Menejer statistikasi (oylik)
     * IMPROVED: Better logging and debugging for tracking issues
     */
    async getManagerStats(identity: ManagerIdentity): Promise<{ count: number; total: number; people: number }> {
        console.log(`🔍 Getting stats for manager: "${identityLabel(identity)}"`);

        const deals = await this.getParsedData();
        let count = 0;
        let total = 0;
        let people = 0;

        // Normalize the input username for comparison
        const username = typeof identity === 'string' ? identity : identity.username || '';
        const normalizedInput = normalizeUsername(username);
        console.log(`   Normalized username: "${normalizedInput}"`);
        console.log(`   Total deals in database: ${deals.length}`);

        deals.forEach(d => {
            const normalizedDealUser = normalizeUsername(d.managerUsername);
            const uMatch = managerMatch(d, identity);
            const mMatch = isThisMonth(d.timestamp);

            if (uMatch && mMatch) {
                count++;
                total += d.price;
                people += d.numberOfPeople;
            }
        });

        // Debug: show first 3 raw deals to trace matching
        if (count === 0 && deals.length > 0) {
            console.log(`⚠️ Stats 0 for "${identityLabel(identity)}". Showing recent deals for debugging:`);
            const samples = deals.slice(-5);
            samples.forEach(d => {
                console.log(`   user="${d.managerUsername}" -> "${normalizeUsername(d.managerUsername)}" ts="${d.timestamp}" match_u=${managerMatch(d, identity)} match_m=${isThisMonth(d.timestamp)}`);
            });
        } else {
            console.log(`📊 Stats for ${username}: ${count} deals, $${total}, ${people} people`);
        }

        return { count, total, people };
    },

    /**
     * Manager barcha vaqt statistikasi
     */
    async getManagerAllTimeStats(identity: ManagerIdentity): Promise<{ count: number; total: number; people: number }> {
        const deals = await this.getParsedData();
        let count = 0;
        let total = 0;
        let people = 0;

        deals.forEach(d => {
            if (managerMatch(d, identity)) {
                count++;
                total += d.price;
                people += d.numberOfPeople;
            }
        });

        return { count, total, people };
    },

    /**
     * Top menejerlar reytingi (joriy oy)
     */
    async getLeaderboard(): Promise<{
        managerId?: number;
        name: string;
        username: string;
        total: number;
        count: number;
    }[]> {
        const deals = await this.getParsedData();
        const stats = new Map<string, {
            managerId?: number;
            name: string;
            username: string;
            total: number;
            count: number;
        }>();

        deals.forEach(d => {
            if (!d.managerUsername || !isThisMonth(d.timestamp)) return;

            const key = d.managerId
                ? `id:${d.managerId}`
                : `username:${normalizeUsername(d.managerUsername)}`;

            if (!stats.has(key)) {
                stats.set(key, {
                    managerId: d.managerId,
                    name: d.managerName, username: d.managerUsername,
                    total: 0, count: 0
                });
            }

            const entry = stats.get(key)!;
            entry.total += d.price;
            entry.count++;
        });

        return Array.from(stats.values())
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);
    },

    /**
     * Bugungi savdolar (parsed)
     */
    async getTodayDeals(): Promise<ParsedDeal[]> {
        const deals = await this.getParsedData();
        return deals.filter(d => isToday(d.timestamp));
    },

    /**
     * Shu haftadagi savdolar
     */
    async getWeeklyDeals(): Promise<ParsedDeal[]> {
        const deals = await this.getParsedData();
        return deals.filter(d => isThisWeek(d.timestamp));
    },

    /**
     * Shu oydagi savdolar
     */
    async getMonthlyDeals(): Promise<ParsedDeal[]> {
        const deals = await this.getParsedData();
        return deals.filter(d => isThisMonth(d.timestamp));
    },

    /**
     * Ma'lum managerning savdolari (joriy oy)
     */
    async getManagerDeals(identity: ManagerIdentity): Promise<ParsedDeal[]> {
        const deals = await this.getParsedData();
        return deals.filter(d => managerMatch(d, identity) && isThisMonth(d.timestamp));
    },

    /**
     * Managerning barcha savdolari
     */
    async getManagerAllDeals(identity: ManagerIdentity): Promise<ParsedDeal[]> {
        const deals = await this.getParsedData();
        return deals.filter(d => managerMatch(d, identity));
    },

    /**
     * Manager bo'yicha all-time mijoz portfeli (personal CRM uchun)
     */
    async getManagerClientPortfolio(identity: ManagerIdentity): Promise<ManagerClientPortfolioItem[]> {
        const deals = await this.getManagerAllDeals(identity);
        type PortfolioRow = ManagerClientPortfolioItem & { lastDealTsValue: number };
        const portfolio = new Map<string, PortfolioRow>();

        deals.forEach(deal => {
            const phoneKey = normalizeContact(deal.contact);
            const nameKey = normalizeUsername(deal.clientName);
            const key = phoneKey ? `phone:${phoneKey}` : `name:${nameKey}`;
            const debt = Math.max(0, deal.price - deal.paidAmount);
            const tsValue = getDateValue(deal.timestamp);

            if (!portfolio.has(key)) {
                portfolio.set(key, {
                    clientName: deal.clientName || 'Nomalum',
                    contact: deal.contact || '',
                    totalDeals: 1,
                    totalRevenue: deal.price || 0,
                    totalPaid: deal.paidAmount || 0,
                    totalDebt: debt,
                    lastDealId: deal.dealId || '',
                    lastDealTimestamp: deal.timestamp || '',
                    lastDestination: deal.destination || '',
                    lastNotes: deal.notes || '',
                    lastDealTsValue: tsValue,
                });
                return;
            }

            const row = portfolio.get(key)!;
            row.totalDeals += 1;
            row.totalRevenue += deal.price || 0;
            row.totalPaid += deal.paidAmount || 0;
            row.totalDebt += debt;

            if (tsValue >= row.lastDealTsValue) {
                row.clientName = deal.clientName || row.clientName;
                row.contact = deal.contact || row.contact;
                row.lastDealId = deal.dealId || row.lastDealId;
                row.lastDealTimestamp = deal.timestamp || row.lastDealTimestamp;
                row.lastDestination = deal.destination || row.lastDestination;
                row.lastNotes = deal.notes || '';
                row.lastDealTsValue = tsValue;
            }
        });

        return Array.from(portfolio.values())
            .sort((a, b) =>
                b.totalDebt - a.totalDebt ||
                b.lastDealTsValue - a.lastDealTsValue ||
                b.totalRevenue - a.totalRevenue
            )
            .map(({ lastDealTsValue, ...rest }) => rest);
    },

    /**
     * Managerning all-time savdolaridan qidirish (mijoz/telefon/shartnoma/ID/izoh)
     */
    async searchManagerDeals(identity: ManagerIdentity, query: string, limit = 20): Promise<ParsedDeal[]> {
        const q = query.trim().toLowerCase();
        if (!q) return [];

        const qDigits = normalizeContact(query);
        const deals = await this.getManagerAllDeals(identity);

        const matches = deals.filter(d => {
            const textMatch =
                (d.dealId || '').toLowerCase().includes(q) ||
                (d.clientName || '').toLowerCase().includes(q) ||
                (d.contact || '').toLowerCase().includes(q) ||
                (d.contractNumber || '').toLowerCase().includes(q) ||
                (d.destination || '').toLowerCase().includes(q) ||
                (d.notes || '').toLowerCase().includes(q) ||
                (d.timestamp || '').toLowerCase().includes(q);

            if (textMatch) return true;

            if (qDigits.length >= 4) {
                const phone = normalizeContact(d.contact);
                return phone.includes(qDigits);
            }

            return false;
        });

        return sortDealsByTimestampDesc(matches).slice(0, Math.max(1, limit));
    },

    /**
     * Managerning qarz konspekti (personal/admin dashboard uchun)
     */
    async getManagerDebtSummary(identity: ManagerIdentity): Promise<ManagerDebtSummary> {
        const debtDeals = await this.getDebtDeals(identity);
        let totalDebt = 0;
        let totalPrice = 0;
        let totalPaid = 0;

        const cases: ManagerDebtCase[] = debtDeals.map(d => {
            const debt = Math.max(0, d.price - d.paidAmount);
            totalDebt += debt;
            totalPrice += d.price;
            totalPaid += d.paidAmount;
            return {
                dealId: d.dealId,
                clientName: d.clientName,
                contact: d.contact,
                debt,
                price: d.price,
                paidAmount: d.paidAmount,
                contractNumber: d.contractNumber,
                notes: d.notes,
                destination: d.destination,
                timestamp: d.timestamp,
            };
        });

        const topCases = cases
            .sort((a, b) => b.debt - a.debt || getDateValue(b.timestamp) - getDateValue(a.timestamp))
            .slice(0, 5);

        return {
            dealsWithDebt: debtDeals.length,
            totalDebt,
            totalPrice,
            totalPaid,
            topCases,
        };
    },

    /**
     * Savdoni ID bo'yicha topish
     */
    async getDealById(dealId: string): Promise<ParsedDeal | null> {
        const deals = await this.getParsedData();
        return deals.find(d => d.dealId === dealId) || null;
    },

    /**
     * Savdoni o'chirish (status ni cancelled ga o'zgartirish)
     * FIXED: Now correctly handles V4 format where dealId is in column 0 (A)
     */
    async cancelDeal(dealId: string): Promise<boolean> {
        if (!config.SPREADSHEET_ID) {
            console.error('❌ Spreadsheet ID topilmadi');
            return false;
        }

        try {
            const sheetName = await getSheetName();
            console.log(`🔍 Looking for deal ${dealId} to cancel...`);

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `'${sheetName}'!${RANGE}`,
            });

            const rows = response.data.values || [];
            let rowIndex = -1;

            // Check both column 0 (V4 format) and column 1 (V3 format)
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;

                // V4 format: dealId in column 0
                if (row[0] === dealId) {
                    rowIndex = i;
                    console.log(`✅ Found deal at row ${i + 1} (column 0)`);
                    break;
                }
                // V3 format: dealId in column 1
                if (row.length > 1 && row[1] === dealId) {
                    rowIndex = i;
                    console.log(`✅ Found deal at row ${i + 1} (column 1)`);
                    break;
                }
            }

            if (rowIndex === -1) {
                console.warn(`⚠️ Deal ${dealId} not found`);
                return false;
            }

            // Update status column
            // Detect format by checking if dealId is in col 0 (V4) or col 1 (V3)
            const row = rows[rowIndex];
            const isV4Format = (row[0] || '').toString().startsWith('LT-');
            // V4: Status is column N (index 13), V3: Status is column O (index 14)
            const statusCol = isV4Format ? 'N' : 'O';
            const range = `'${sheetName}'!${statusCol}${rowIndex + 1}`;

            console.log(`🔄 Updating status at ${range} to 'cancelled'`);

            await sheets.spreadsheets.values.update({
                spreadsheetId: config.SPREADSHEET_ID,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['cancelled']] },
            });

            // Invalidate cache
            cachedData = null;
            cachedDeals = null;
            cacheTimestamp = 0;

            console.log(`✅ Deal ${dealId} cancelled successfully`);
            return true;
        } catch (e: any) {
            console.error('❌ Savdoni o\'chirishda xatolik:', e.message);
            return false;
        }
    },

    /**
     * Umumiy statistika (admin uchun)
     */
    async getOverallStats(): Promise<{
        todayCount: number; todayTotal: number;
        weekCount: number; weekTotal: number;
        monthCount: number; monthTotal: number;
        allCount: number; allTotal: number;
    }> {
        const deals = await this.getParsedData();

        let todayCount = 0, todayTotal = 0;
        let weekCount = 0, weekTotal = 0;
        let monthCount = 0, monthTotal = 0;
        let allCount = deals.length, allTotal = 0;

        deals.forEach(d => {
            allTotal += d.price;

            if (isThisMonth(d.timestamp)) {
                monthCount++;
                monthTotal += d.price;
            }
            if (isThisWeek(d.timestamp)) {
                weekCount++;
                weekTotal += d.price;
            }
            if (isToday(d.timestamp)) {
                todayCount++;
                todayTotal += d.price;
            }
        });

        return {
            todayCount, todayTotal,
            weekCount, weekTotal,
            monthCount, monthTotal,
            allCount, allTotal,
        };
    },

    /**
     * Qarzli savdolarni olish (price > paidAmount)
     */
    async getDebtDeals(identity?: ManagerIdentity): Promise<ParsedDeal[]> {
        const deals = await this.getParsedData();
        return deals.filter(d => {
            const hasDebt = d.price > d.paidAmount;
            if (identity) {
                return hasDebt && managerMatch(d, identity);
            }
            return hasDebt;
        });
    },

    /**
     * Shartnoma raqami bo'yicha savdo topish
     */
    async findByContract(contractNumber: string): Promise<ParsedDeal | null> {
        const deals = await this.getParsedData();
        return deals.find(d =>
            d.contractNumber && d.contractNumber.toLowerCase() === contractNumber.toLowerCase()
        ) || null;
    },

    /**
     * To'lov yangilash (J ustuniga yozish — paidAmount)
     * FIXED: Now handles both V4 and V3 formats correctly
     */
    async updatePaidAmount(dealId: string, newPaidAmount: number): Promise<boolean> {
        if (!config.SPREADSHEET_ID) {
            console.error('❌ Spreadsheet ID topilmadi');
            return false;
        }

        try {
            console.log(`💰 Updating payment for deal ${dealId} to $${newPaidAmount}`);

            const deals = await this.getParsedData();
            const deal = deals.find(d => d.dealId === dealId);

            if (!deal) {
                console.warn(`⚠️ Deal ${dealId} not found`);
                return false;
            }

            if (!deal.rowIndex) {
                console.warn(`⚠️ Deal ${dealId} has no rowIndex`);
                return false;
            }
            if (!Number.isFinite(newPaidAmount) || newPaidAmount < 0 || newPaidAmount > deal.price) {
                console.warn(
                    `Invalid payment for ${dealId}: ${newPaidAmount}. Expected a value from 0 to ${deal.price}`
                );
                return false;
            }
            if (deal.sourceFormat === 'legacy') {
                console.warn(`Payment update is unavailable for unmigrated legacy deal ${dealId}`);
                return false;
            }

            const sheetName = await getSheetName();

            // Determine column based on format
            // V4: paidAmount is column J (index 9)
            // V3: paidAmount is column J (index 9)
            const paidCol = 'J';
            // FIXED: rowIndex already stores the actual 1-based sheet row number
            // (set in getParsedData as i + 2), so use it directly
            const rowNum = deal.rowIndex;
            const range = `'${sheetName}'!${paidCol}${rowNum}`;

            console.log(`🔄 Updating ${range} to $${newPaidAmount}`);

            // Debt is K in v4 and P in the canonical v3-compatible layout.
            const debtCol = deal.sourceFormat === 'v4' ? 'K' : 'P';
            const newDebt = Math.max(0, deal.price - newPaidAmount);

            // Send paid amount and debt together so readers never observe a half-updated row.
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: config.SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: [
                        { range, values: [[newPaidAmount]] },
                        { range: `'${sheetName}'!${debtCol}${rowNum}`, values: [[newDebt]] },
                    ],
                },
            });

            console.log(`✅ To'lov yangilandi: ${dealId} → $${newPaidAmount}`);

            // Invalidate cache
            cachedData = null;
            cachedDeals = null;
            cacheTimestamp = 0;

            return true;
        } catch (error: any) {
            console.error('❌ To\'lov yangilashda xatolik:', error.message);
            return false;
        }
    },
};
