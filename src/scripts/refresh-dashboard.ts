import { assertProductionConfig } from '../config';
import { dashboardService } from '../services/dashboardService';
import { sheetsService } from '../services/sheets';

async function main(): Promise<void> {
    assertProductionConfig();
    const connection = await sheetsService.checkConnection();
    console.log(`Connected: ${connection.spreadsheetTitle} / ${connection.salesSheetName}`);
    const result = await dashboardService.refresh();
    console.log(`Dashboard refreshed: ${result.spreadsheetUrl}`);
}

main().catch(error => {
    console.error('Dashboard refresh failed:', error);
    process.exitCode = 1;
});
