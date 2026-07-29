import { google, sheets_v4 } from 'googleapis';
import { config } from '../config';
import { buildSheetsAuthOptions } from '../utils/googleAuth';
import { formatDateTime } from '../utils/helpers';
import { ParsedDeal, sheetsService } from './sheets';

const auth = new google.auth.GoogleAuth(buildSheetsAuthOptions(config.GOOGLE_CREDENTIALS));
const sheets = google.sheets({ version: 'v4', auth });
const DASHBOARD_COLUMNS = 10;
const MANAGER_TABLE_START_ROW = 12;
const DESTINATION_TABLE_START_ROW = 12;
const DEBT_TABLE_START_ROW = 26;

export interface DashboardRefreshResult {
    sheetName: string;
    spreadsheetUrl: string;
    refreshedAt: string;
    created: boolean;
}

function sum(deals: ParsedDeal[], selector: (deal: ParsedDeal) => number): number {
    return deals.reduce((total, deal) => total + selector(deal), 0);
}

function normalizeKey(value: string): string {
    return (value || '').trim().toLocaleLowerCase('uz-UZ');
}

function padRows(rows: (string | number)[][], count: number, columns: number): (string | number)[][] {
    const padded = rows.slice(0, count);
    while (padded.length < count) {
        padded.push(Array.from({ length: columns }, () => ''));
    }
    return padded;
}

async function getOrCreateDashboardSheet(): Promise<{
    sheetId: number;
    created: boolean;
    salesSheetId: number;
    salesSheetName: string;
}> {
    const metadata = await sheets.spreadsheets.get({
        spreadsheetId: config.SPREADSHEET_ID,
        fields: 'sheets.properties',
    });
    const allSheets = metadata.data.sheets || [];
    const existing = allSheets.find(
        sheet => sheet.properties?.title === config.DASHBOARD_SHEET_NAME
    );
    const salesSheet = allSheets.find(
        sheet => sheet.properties?.title !== config.DASHBOARD_SHEET_NAME
            && sheet.properties?.title !== 'Users'
            && sheet.properties?.title !== 'Settings'
    );

    const salesSheetId = salesSheet?.properties?.sheetId;
    const salesSheetName = salesSheet?.properties?.title;
    if (typeof salesSheetId !== 'number' || !salesSheetName) {
        throw new Error('Sales data sheet could not be identified');
    }
    const existingSheetId = existing?.properties?.sheetId;
    if (typeof existingSheetId === 'number') {
        return {
            sheetId: existingSheetId,
            created: false,
            salesSheetId,
            salesSheetName,
        };
    }

    const response = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.SPREADSHEET_ID,
        requestBody: {
            requests: [{
                addSheet: {
                    properties: {
                        title: config.DASHBOARD_SHEET_NAME,
                        gridProperties: {
                            rowCount: 80,
                            columnCount: DASHBOARD_COLUMNS,
                            frozenRowCount: 3,
                        },
                        tabColor: { red: 0.96, green: 0.78, blue: 0.22 },
                    },
                },
            }],
        },
    });
    const sheetId = response.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
        throw new Error('Dashboard sheet was created without a sheet ID');
    }

    return {
        sheetId,
        created: true,
        salesSheetId,
        salesSheetName,
    };
}

function dashboardFormattingRequests(sheetId: number): sheets_v4.Schema$Request[] {
    const ink = { red: 0.09, green: 0.15, blue: 0.17 };
    const lemon = { red: 0.96, green: 0.78, blue: 0.22 };
    const leaf = { red: 0.20, green: 0.38, blue: 0.28 };
    const mist = { red: 0.93, green: 0.96, blue: 0.94 };
    const white = { red: 1, green: 1, blue: 1 };
    const requests: sheets_v4.Schema$Request[] = [
        {
            updateSheetProperties: {
                properties: {
                    sheetId,
                    gridProperties: { frozenRowCount: 3, hideGridlines: true },
                },
                fields: 'gridProperties.frozenRowCount,gridProperties.hideGridlines',
            },
        },
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: ink,
                        textFormat: { foregroundColor: lemon, bold: true, fontSize: 18 },
                        verticalAlignment: 'MIDDLE',
                    },
                },
                fields: 'userEnteredFormat',
            },
        },
        {
            updateDimensionProperties: {
                range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
                properties: { pixelSize: 44 },
                fields: 'pixelSize',
            },
        },
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 10 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: mist,
                        textFormat: { foregroundColor: leaf, bold: true, fontSize: 9 },
                        horizontalAlignment: 'CENTER',
                    },
                },
                fields: 'userEnteredFormat',
            },
        },
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 10 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: white,
                        textFormat: { foregroundColor: ink, bold: true, fontSize: 16 },
                        horizontalAlignment: 'CENTER',
                        numberFormat: { type: 'NUMBER', pattern: '#,##0.00' },
                    },
                },
                fields: 'userEnteredFormat',
            },
        },
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 10, endRowIndex: 11, startColumnIndex: 0, endColumnIndex: 10 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: leaf,
                        textFormat: { foregroundColor: white, bold: true },
                        horizontalAlignment: 'CENTER',
                    },
                },
                fields: 'userEnteredFormat',
            },
        },
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 24, endRowIndex: 25, startColumnIndex: 0, endColumnIndex: 6 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: ink,
                        textFormat: { foregroundColor: lemon, bold: true },
                    },
                },
                fields: 'userEnteredFormat',
            },
        },
    ];

    const widths = [150, 92, 112, 112, 112, 28, 150, 92, 112, 112];
    widths.forEach((pixelSize, index) => {
        requests.push({
            updateDimensionProperties: {
                range: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: index,
                    endIndex: index + 1,
                },
                properties: { pixelSize },
                fields: 'pixelSize',
            },
        });
    });
    return requests;
}

function salesFormattingRequests(sheetId: number): sheets_v4.Schema$Request[] {
    const ink = { red: 0.09, green: 0.15, blue: 0.17 };
    const lemon = { red: 0.96, green: 0.78, blue: 0.22 };
    return [
        {
            updateSheetProperties: {
                properties: {
                    sheetId,
                    gridProperties: { frozenRowCount: 1 },
                },
                fields: 'gridProperties.frozenRowCount',
            },
        },
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 18 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: ink,
                        textFormat: { foregroundColor: lemon, bold: true },
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                        wrapStrategy: 'WRAP',
                    },
                },
                fields: 'userEnteredFormat',
            },
        },
        {
            setBasicFilter: {
                filter: {
                    range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 18 },
                },
            },
        },
    ];
}

export const dashboardService = {
    async refresh(): Promise<DashboardRefreshResult> {
        const [{ sheetId, created, salesSheetId }, stats, leaderboard, monthlyDeals, debts] =
            await Promise.all([
                getOrCreateDashboardSheet(),
                sheetsService.getOverallStats(),
                sheetsService.getLeaderboard(),
                sheetsService.getMonthlyDeals(),
                sheetsService.getDebtDeals(),
            ]);

        const refreshedAt = formatDateTime(new Date());
        const totalPaid = sum(monthlyDeals, deal => deal.paidAmount);
        const totalDebt = sum(monthlyDeals, deal => Math.max(0, deal.price - deal.paidAmount));
        const totalPeople = sum(monthlyDeals, deal => deal.numberOfPeople);
        const destinations = new Map<string, { name: string; count: number; revenue: number; people: number }>();
        monthlyDeals.forEach(deal => {
            const key = normalizeKey(deal.destination) || 'unknown';
            const current = destinations.get(key) || {
                name: deal.destination || 'Ko‘rsatilmagan',
                count: 0,
                revenue: 0,
                people: 0,
            };
            current.count += 1;
            current.revenue += deal.price;
            current.people += deal.numberOfPeople;
            destinations.set(key, current);
        });

        const managerRows = leaderboard.slice(0, 10).map((manager, index) => [
            index + 1,
            manager.name || manager.username,
            manager.count,
            manager.total,
            manager.count > 0 ? manager.total / manager.count : 0,
        ]);
        const destinationRows = Array.from(destinations.values())
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)
            .map((destination, index) => [
                index + 1,
                destination.name,
                destination.count,
                destination.revenue,
            ]);
        const debtRows = [...debts]
            .sort((a, b) => (b.price - b.paidAmount) - (a.price - a.paidAmount))
            .slice(0, 15)
            .map(deal => [
                deal.clientName,
                deal.managerName,
                deal.contractNumber,
                deal.price,
                deal.paidAmount,
                Math.max(0, deal.price - deal.paidAmount),
            ]);

        const name = config.DASHBOARD_SHEET_NAME.replace(/'/g, "''");
        const managerOutput = managerRows.length
            ? padRows(managerRows, 10, 5)
            : padRows([['—', 'Hozircha ma’lumot yo‘q', 0, 0, 0]], 10, 5);
        const destinationOutput = destinationRows.length
            ? padRows(destinationRows, 10, 4)
            : padRows([['—', 'Hozircha ma’lumot yo‘q', 0, 0]], 10, 4);
        const debtOutput = debtRows.length
            ? padRows(debtRows, 15, 6)
            : padRows([['Hozircha qarz yo‘q', '', '', 0, 0, 0]], 15, 6);

        const values: sheets_v4.Schema$ValueRange[] = [
            {
                range: `'${name}'!A1:J11`,
                values: [
                    ['LEMON TOUR  •  BOSHQARUV PANELI'],
                    ['Oxirgi yangilanish', refreshedAt, '', '', '', '', 'Hisoblash qoidasi', 'Daromad = shartnoma summasi; tushum = to‘langan summa'],
                    ['Davr', 'Joriy oy', '', '', '', '', 'Bugungi kuzatuv', stats.todayCount],
                    ['OYLIK DAROMAD', 'TUSHGAN PUL', 'OYLIK QARZ', 'SAVDOLAR', 'SAYOHATCHILAR', '', 'BUGUNGI SAVDO', 'BUGUNGI DAROMAD', 'BARCHA DAVR', 'JAMI QARZ'],
                    [stats.monthTotal, totalPaid, totalDebt, stats.monthCount, totalPeople, '', stats.todayCount, stats.todayTotal, stats.allTotal, sum(debts, deal => Math.max(0, deal.price - deal.paidAmount))],
                    [],
                    ['Rahbar uchun signal'],
                    [
                        totalDebt > totalPaid
                            ? 'Qarz miqdori tushgan puldan yuqori — undirish rejasini tekshiring.'
                            : 'Tushum qarzdan yuqori. Eng katta qarzlarni quyidagi ro‘yxatdan nazorat qiling.',
                    ],
                    [],
                    [],
                    ['#', 'MENEJER', 'SAVDO', 'DAROMAD', 'O‘RTACHA', '', '#', 'YO‘NALISH', 'SAVDO', 'DAROMAD'],
                ],
            },
            {
                range: `'${name}'!A${MANAGER_TABLE_START_ROW}:E${MANAGER_TABLE_START_ROW + 9}`,
                values: managerOutput,
            },
            {
                range: `'${name}'!G${DESTINATION_TABLE_START_ROW}:J${DESTINATION_TABLE_START_ROW + 9}`,
                values: destinationOutput,
            },
            {
                range: `'${name}'!A25:F${DEBT_TABLE_START_ROW + 15}`,
                values: [
                    ['QARZ NAZORATI — ENG KATTA OCHIQ QOLDIQLAR'],
                    ['MIJOZ', 'MENEJER', 'SHARTNOMA', 'NARX', 'TO‘LANGAN', 'QARZ'],
                    ...debtOutput,
                ],
            },
        ];

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: config.SPREADSHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: values,
            },
        });

        const formatting = [
            ...dashboardFormattingRequests(sheetId),
            ...salesFormattingRequests(salesSheetId),
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: 11, endRowIndex: 80, startColumnIndex: 2, endColumnIndex: 5 },
                    cell: {
                        userEnteredFormat: {
                            numberFormat: { type: 'NUMBER', pattern: '#,##0.00' },
                        },
                    },
                    fields: 'userEnteredFormat.numberFormat',
                },
            },
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: 25, endRowIndex: 80, startColumnIndex: 3, endColumnIndex: 6 },
                    cell: {
                        userEnteredFormat: {
                            numberFormat: { type: 'NUMBER', pattern: '#,##0.00' },
                        },
                    },
                    fields: 'userEnteredFormat.numberFormat',
                },
            },
        ] satisfies sheets_v4.Schema$Request[];

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: config.SPREADSHEET_ID,
            requestBody: { requests: formatting },
        });

        return {
            sheetName: config.DASHBOARD_SHEET_NAME,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${config.SPREADSHEET_ID}/edit#gid=${sheetId}`,
            refreshedAt,
            created,
        };
    },
};
