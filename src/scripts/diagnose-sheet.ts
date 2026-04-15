/**
 * Diagnostic script to inspect actual Google Sheet data
 * Uses GOOGLE_CREDENTIALS from the environment
 */
import { google } from 'googleapis';
import { config } from '../config';
import { buildSheetsAuthOptions } from '../utils/googleAuth';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || config.SPREADSHEET_ID || '';
const authOptions = buildSheetsAuthOptions(config.GOOGLE_CREDENTIALS);

async function diagnose() {
    console.log('🔍 DIAGNOSTIC: Inspecting Google Sheet data...\n');
    console.log(`📋 Spreadsheet ID: ${SPREADSHEET_ID}`);

    const auth = new google.auth.GoogleAuth({
        ...authOptions,
    });

    const sheets = google.sheets({ version: 'v4', auth });

    try {
        // 1. Get sheet metadata
        const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheetName = meta.data.sheets?.[0]?.properties?.title || 'Sheet1';
        console.log(`📊 Sheet name: "${sheetName}"`);
        console.log(`📊 Total sheets: ${meta.data.sheets?.length}`);

        // 2. Read ALL data (A:AZ to capture data in wrong columns)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${sheetName}'!A:AZ`,
        });

        const rows = response.data.values || [];
        console.log(`\n📊 Total rows returned: ${rows.length}`);

        if (rows.length === 0) {
            console.log('❌ NO DATA IN SHEET!');
            return;
        }

        // 3. Show first row (header)
        console.log(`\n📋 ROW 1 (Header):`);
        console.log(`   Length: ${rows[0].length} columns`);
        console.log(`   Values: ${JSON.stringify(rows[0])}`);

        // 4. Show each data row with details
        console.log(`\n📊 DATA ROWS:`);
        for (let i = 1; i < rows.length && i <= 30; i++) {
            const row = rows[i];
            if (!row || row.length === 0) {
                console.log(`   Row ${i + 1}: [EMPTY]`);
                continue;
            }
            console.log(`   Row ${i + 1}: length=${row.length}`);
            console.log(`     Col A (0): "${row[0] || ''}" | Col B (1): "${row[1] || ''}" | Col C (2): "${row[2] || ''}"`);

            // Check if data is in wrong columns (past P = index 15)
            const nonEmptyAfterP = row.slice(16).filter((v: string) => v && v.toString().trim() !== '');
            if (nonEmptyAfterP.length > 0) {
                console.log(`     ⚠️ DATA IN WRONG COLUMNS (past P)! Cols Q+: ${JSON.stringify(row.slice(16))}`);
            }

            // Check format detection
            const col0 = (row[0] || '').toString();
            const col1 = (row[1] || '').toString();
            const isV4 = col0.startsWith('LT-');
            const isV3 = col1.startsWith('LT-');
            console.log(`     Format: V4=${isV4} V3=${isV3} | Full: ${JSON.stringify(row.slice(0, 16))}`);
        }

        // 5. Check for data in columns beyond P
        console.log(`\n🔍 COLUMN ANALYSIS:`);
        let maxCols = 0;
        let rowsWithDataPastP = 0;
        rows.forEach((row, i) => {
            if (row.length > maxCols) maxCols = row.length;
            const dataAfterP = row.slice(16).filter((v: string) => v && v.toString().trim() !== '');
            if (dataAfterP.length > 0 && i > 0) rowsWithDataPastP++;
        });
        console.log(`   Max columns in any row: ${maxCols}`);
        console.log(`   Rows with data past column P: ${rowsWithDataPastP}`);

    } catch (error: any) {
        console.error('❌ Error:', error.message);
        console.error(error);
    }
}

diagnose().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
