import { sheetsService } from '../services/sheets';
import { Deal } from '../types';

async function main() {
    console.log('--- START DIAGNOSTIC ---');
    try {
        console.log('Testing Sheets Connection...');
        const data = await sheetsService.getRawData();
        console.log(`Successfully read ${data.length} rows.`);

        const deal: Deal = {
            dealId: 'TEST-DIAGNOSTIC-' + Date.now(),
            timestamp: new Date().toISOString(),
            managerName: 'Test Bot',
            managerUsername: 'testbot',
            clientName: 'Diagnostic Test',
            numberOfPeople: 1,
            departureDate: '2026-01-01',
            returnDate: '2026-01-05',
            contact: '998901234567',
            destination: 'Test Destination',
            price: 100,
            paidAmount: 0,
            contractNumber: 'TEST-123',
            notes: 'Diagnostic Test Note',
            status: 'confirmed'
        };

        console.log('Attempting to append test deal...');
        await sheetsService.appendDeal(deal);
        console.log('Successfully appended test deal.');

        console.log('--- DIAGNOSTIC PASS ---');
    } catch (e) {
        console.error('--- DIAGNOSTIC FAIL ---');
        console.error(e);
    }
}

main();
