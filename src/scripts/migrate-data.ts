/**
 * Migration script: Move data from wrong columns (P-AE) to correct columns (A-O)
 * and clean up the sheet for V3 format
 */
import { google } from 'googleapis';
import { config } from '../config';
import { buildSheetsAuthOptions } from '../utils/googleAuth';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || config.SPREADSHEET_ID || '';
const APPLY_CHANGES = process.argv.includes('--apply');
const CONFIRMED_SPREADSHEET = process.argv
    .find(arg => arg.startsWith('--confirm-spreadsheet='))
    ?.split('=')[1];
const authOptions = buildSheetsAuthOptions(config.GOOGLE_CREDENTIALS);

async function migrate() {
    console.log('🔧 MIGRATION: Moving data from wrong columns to correct columns...\n');

    const auth = new google.auth.GoogleAuth(authOptions);

    const sheets = google.sheets({ version: 'v4', auth });

    try {
        // 1. Get sheet name
        const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheetName = meta.data.sheets?.[0]?.properties?.title || 'Sheet1';
        const sheetId = meta.data.sheets?.[0]?.properties?.sheetId || 0;
        console.log(`📊 Sheet name: "${sheetName}" (ID: ${sheetId})`);

        // 2. Read ALL data including wrong columns
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${sheetName}'!A:AZ`,
        });

        const rows = response.data.values || [];
        console.log(`📊 Total rows: ${rows.length}`);

        if (rows.length === 0) {
            console.log('❌ No data found');
            return;
        }

        // 3. Identify header format
        const header = rows[0];
        console.log(`📋 Header: ${JSON.stringify(header)}`);
        const isV3Header = header[0] === 'Vaqt';
        console.log(`📋 Header format: ${isV3Header ? 'V3' : 'Unknown'}`);

        // 4. Collect data from wrong columns
        // V3 header: Vaqt(A), SavdoID(B), Mijoz(C), Odamlar(D), Uchish(E), Qaytish(F),
        //            Telefon(G), Yo'nalish(H), Narx(I), To'langan(J), Shartnoma(K),
        //            Izoh(L), MenejerIsmi(M), MenejerUsername(N), Holat(O)
        //
        // Current wrong data layout (P-AE):
        // P=DealID, Q=Timestamp, R=ManagerName, S=ClientName, T=Contact, U=Destination,
        // V=Departure, W=Return, X=Price, Y=Paid, Z=Debt, AA=Contract, AB=Notes,
        // AC=Status, AD=People, AE=Username
        //
        // Need to remap to V3 format (A-O):
        // A=Timestamp, B=DealID, C=Client, D=People, E=Departure, F=Return,
        // G=Contact, H=Destination, I=Price, J=Paid, K=Contract, L=Notes,
        // M=ManagerName, N=ManagerUsername, O=Status

        const migratedRows: any[][] = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            // Check if this row has data in wrong columns (past P)
            const hasWrongData = row.length > 16 && row.slice(16).some((v: string) => v && v.toString().trim() !== '');

            if (!hasWrongData) {
                // Check if it has correct data in A-O already
                const hasCorrectData = row[0] && row[0].toString().trim() !== '';
                if (hasCorrectData) {
                    console.log(`   Row ${i + 1}: Already has correct data, skipping`);
                    continue;
                }
                console.log(`   Row ${i + 1}: Empty row, skipping`);
                continue;
            }

            // Data is in wrong columns - the V4 data starts at column P (index 15)
            // V4 order: ID(P=15), Timestamp(Q=16), MgrName(R=17), Client(S=18), Phone(T=19),
            //           Dest(U=20), Dep(V=21), Ret(W=22), Price(X=23), Paid(Y=24), Debt(Z=25),
            //           Contract(AA=26), Notes(AB=27), Status(AC=28), People(AD=29), Username(AE=30)

            const dealId = row[15] || '';
            const timestamp = row[16] || '';
            const mgrName = row[17] || '';
            const client = row[18] || '';
            const phone = row[19] || '';
            const dest = row[20] || '';
            const dep = row[21] || '';
            const ret = row[22] || '';
            const price = row[23] || '0';
            const paid = row[24] || '0';
            // Skip debt (25) - calculated
            const contract = row[26] || '';
            const notes = row[27] || '';
            const status = row[28] || 'confirmed';
            const people = row[29] || '1';
            const username = row[30] || '';

            // V3 format: Timestamp, DealID, Client, People, Departure, Return,
            //            Phone, Destination, Price, Paid, Contract, Notes,
            //            ManagerName, ManagerUsername, Status
            const v3Row = [
                timestamp,  // A: Vaqt
                dealId,     // B: Savdo ID
                client,     // C: Mijoz
                people,     // D: Odamlar
                dep,        // E: Uchish sanasi
                ret,        // F: Qaytish sanasi
                phone,      // G: Telefon
                dest,       // H: Yo'nalish
                price,      // I: Narx ($)
                paid,       // J: To'langan ($)
                contract,   // K: Shartnoma raqami
                notes,      // L: Izoh
                mgrName,    // M: Menejer ismi
                username,   // N: Menejer username
                status,     // O: Holat
            ];

            migratedRows.push(v3Row);
            console.log(`   Row ${i + 1}: Migrating ${dealId} (${client} - $${price})`);
        }

        if (migratedRows.length === 0) {
            console.log('\n❌ No data to migrate');
            return;
        }

        console.log(`\n📦 Migrating ${migratedRows.length} rows...`);

        if (!APPLY_CHANGES || CONFIRMED_SPREADSHEET !== SPREADSHEET_ID) {
            console.log('\nDRY RUN ONLY — no rows were changed.');
            console.log(
                `To apply after reviewing this output, run with --apply ` +
                `--confirm-spreadsheet=${SPREADSHEET_ID}`
            );
            return;
        }

        // Create a recoverable copy before any destructive rewrite.
        const backupTitle = `${sheetName} Backup ${new Date().toISOString().replace(/[:.]/g, '-')}`;
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                requests: [{
                    duplicateSheet: {
                        sourceSheetId: sheetId,
                        newSheetName: backupTitle,
                    },
                }],
            },
        });
        console.log(`✅ Backup created: ${backupTitle}`);

        // 5. Clear the entire sheet EXCEPT the header
        console.log('🧹 Clearing old data (keeping header)...');
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${sheetName}'!A2:AZ1000`,
        });

        // 6. Write migrated data starting at row 2
        console.log('📝 Writing migrated data...');
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${sheetName}'!A2:O${1 + migratedRows.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: migratedRows },
        });

        console.log(`✅ Successfully migrated ${migratedRows.length} rows!`);
        console.log('\n📋 Migrated data preview:');
        migratedRows.forEach((row, i) => {
            console.log(`   ${i + 1}. ${row[1]} | ${row[2]} | $${row[8]} | ${row[7]}`);
        });

    } catch (error: any) {
        console.error('❌ Migration error:', error.message);
        console.error(error);
    }
}

migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
