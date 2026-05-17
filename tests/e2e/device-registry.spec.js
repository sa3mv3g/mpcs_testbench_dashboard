const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const electronPath = require('electron');
const path = require('path');
const { DeviceRegistryPage } = require('./pages/DeviceRegistryPage');

test.describe('Device Registry E2E', () => {
    let electronApp;
    let window;
    let devicePage;

    test.beforeAll(async () => {
        electronApp = await electron.launch({
            executablePath: electronPath,
            args: [path.join(__dirname, '..', '..', 'src', 'main.js')]
        });
        window = await electronApp.firstWindow();
        devicePage = new DeviceRegistryPage(window);
        
        window.on('dialog', async dialog => {
            await dialog.accept();
        });
    });

    test.afterAll(async () => {
        await electronApp.close();
    });

    test('Positive testcase (Add valid device)', async () => {
        await devicePage.navigate();
        await devicePage.addDevice('Playwright-Valid-DAQ', '192.168.1.50', '502', '100', '101');

        const deviceRow = devicePage.getDeviceRow('Playwright-Valid-DAQ').first();
        await expect(deviceRow).toBeVisible();
        await expect(deviceRow).toContainText('192.168.1.50');
    });

    test('Negative testcase (Reject invalid address)', async () => {
        await devicePage.navigate();
        // 10000 is > 9998, so it should trigger the dialog alert and not save
        await devicePage.addDevice('Playwright-Invalid-DAQ', '10.0.0.1', '502', '10000', '101');

        const invalidRow = devicePage.getDeviceRow('Playwright-Invalid-DAQ');
        await expect(invalidRow).toHaveCount(0);
    });

    test('Raw Registers Explorer: Integration check (New device appears in list)', async () => {
        await window.locator('#tab-raw-registers').click();
        await expect(window.locator('#raw-registers')).toBeVisible();

        const rawDevItem = window.locator('#raw-dev-list li', { hasText: 'Playwright-Valid-DAQ' }).first();
        await expect(rawDevItem).toBeVisible();
    });
});
