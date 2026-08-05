const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const electronPath = require('electron');
const path = require('path');
const { CalibrationPage } = require('./pages/CalibrationPage');

test.describe('Calibration Dashboard E2E', () => {
    let electronApp;
    let window;
    let calPage;

    test.beforeAll(async () => {
        electronApp = await electron.launch({
            executablePath: electronPath,
            args: [path.join(__dirname, '..', '..', 'src', 'main.js')]
        });
        window = await electronApp.firstWindow();
        calPage = new CalibrationPage(window);
        
        window.on('dialog', async dialog => {
            await dialog.accept();
        });
    });

    test.afterAll(async () => {
        await electronApp.close();
    });

    test('Curve fitting math logic execution via DOM', async () => {
        // Because a full setup requires creating a device, registering raw registers, 
        // and mapping them to a signal, we bypass the DB prerequisites and test the DOM math engine directly
        await calPage.navigateToCalibration();

        // Fill Data Point 1
        await calPage.fillDataPoint(0, 1, 3);
        
        // Fill Data Point 2
        await calPage.fillDataPoint(1, 5, 11);

        // Execute Calculation (y = 2x + 1)
        await calPage.calculateLine(0.5);

        await expect(calPage.calcM).toHaveValue('2.0000');
        await expect(calPage.calcC).toHaveValue('1.0000');
    });

    test('Selecting a signal should invoke IPC to read current values and populate the UI', async () => {
        // We mock the IPC call for `calibration:readCurrent` to avoid needing a live Modbus device
        await window.evaluate(() => {
            window.api.calibrationReadCurrent = async ({ id }) => {
                return { success: true, scale: 2.5000, offset: 1.2500, deadzone: 0.1000 };
            };
        });

        // Trigger the signal selection
        await window.evaluate(() => {
            if (typeof window.selectForCal === 'function') {
                window.selectForCal(999, 'TEST-SIG', 'CDAB');
            }
        });

        // The values should eventually update to the mocked responses
        await expect(window.locator('#cal-active-m')).toHaveText('2.5000', { timeout: 2000 });
        await expect(window.locator('#cal-active-c')).toHaveText('1.2500', { timeout: 2000 });
        await expect(window.locator('#cal-active-dz')).toHaveText('0.1000', { timeout: 2000 });
    });
});
