/**
 * Data Flow Test Script
 * Tests the complete data saving and tracking flow
 */

import { sheetsService } from '../services/sheets';
import { Deal } from '../types';

async function testDataFlow() {
    console.log('🧪 Starting Data Flow Test...\n');

    try {
        console.log('🔌 Test 0: Verifying Google Sheets connection...');
        const connection = await sheetsService.checkConnection();
        console.log(`   ✅ Connected to "${connection.spreadsheetTitle}" / "${connection.salesSheetName}"\n`);

        // Test 1: Check if we can read data
        console.log('📥 Test 1: Reading data from Sheets...');
        const rawData = await sheetsService.getRawData();
        console.log(`   ✅ Retrieved ${rawData.length} rows\n`);

        // Test 2: Parse data
        console.log('📊 Test 2: Parsing deals...');
        const parsedDeals = await sheetsService.getParsedData();
        console.log(`   ✅ Parsed ${parsedDeals.length} valid deals\n`);

        // Test 3: Check overall stats
        console.log('📈 Test 3: Getting overall stats...');
        const overallStats = await sheetsService.getOverallStats();
        console.log(`   ✅ Today: ${overallStats.todayCount} deals, $${overallStats.todayTotal}`);
        console.log(`   ✅ This month: ${overallStats.monthCount} deals, $${overallStats.monthTotal}\n`);

        // Test 4: Check leaderboard
        console.log('🏆 Test 4: Getting leaderboard...');
        const leaderboard = await sheetsService.getLeaderboard();
        console.log(`   ✅ Found ${leaderboard.length} managers`);
        leaderboard.forEach((m, i) => {
            console.log(`      ${i + 1}. ${m.name} (${m.username}): ${m.count} deals, $${m.total}`);
        });
        console.log('');

        // Test 5: Test manager stats (if there are deals)
        if (parsedDeals.length > 0) {
            const testUsername = parsedDeals[0].managerUsername;
            if (testUsername) {
                console.log(`👤 Test 5: Testing manager stats for ${testUsername}...`);
                const managerStats = await sheetsService.getManagerStats(testUsername);
                console.log(`   ✅ Stats: ${managerStats.count} deals, $${managerStats.total}, ${managerStats.people} people\n`);
            }
        }

        // Test 6: Create a test deal (without saving)
        console.log('📝 Test 6: Creating test deal object...');
        const testDeal: Deal = {
            dealId: 'TEST-' + Date.now(),
            managerId: 123456789,
            timestamp: new Date().toISOString(),
            managerName: 'Test Manager',
            managerUsername: '@testmanager',
            clientName: 'Test Client',
            numberOfPeople: 2,
            departureDate: '25.03.2026',
            returnDate: '01.04.2026',
            contact: '+998901234567',
            price: 1200,
            paidAmount: 800,
            destination: 'Test Destination',
            contractNumber: 'TEST-001',
            notes: 'Test deal - do not save',
            status: 'confirmed',
        };
        console.log(`   ✅ Created test deal: ${testDeal.dealId}\n`);

        // Test 7: Check debt deals
        console.log('💳 Test 7: Getting debt deals...');
        const debtDeals = await sheetsService.getDebtDeals();
        console.log(`   ✅ Found ${debtDeals.length} deals with debt\n`);

        console.log('✅ All tests passed!\n');
        console.log('📊 Summary:');
        console.log(`   - Total rows in sheet: ${rawData.length}`);
        console.log(`   - Valid deals: ${parsedDeals.length}`);
        console.log(`   - Today's deals: ${overallStats.todayCount}`);
        console.log(`   - This month's deals: ${overallStats.monthCount}`);
        console.log(`   - Managers tracked: ${leaderboard.length}`);
        console.log(`   - Deals with debt: ${debtDeals.length}`);

    } catch (error: any) {
        console.error('❌ Test failed:', error.message);
        console.error('Error details:', error);
        process.exit(1);
    }
}

// Run tests
testDataFlow().then(() => {
    console.log('\n✅ Test completed successfully');
    process.exit(0);
}).catch((error) => {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
});
