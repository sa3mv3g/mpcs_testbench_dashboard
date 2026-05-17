const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const electronPath = require('electron');
const path = require('path');

test('DOM Events & Business Logic E2E', async () => {
    // Launch Electron app using the exact binary path
    const electronApp = await electron.launch({
        executablePath: electronPath,
        args: [path.join(__dirname, '..', 'src', 'main.js')]
    });

    // Wait for the first window
    const window = await electronApp.firstWindow();

    // Ensure app loaded
    await expect(window).toHaveTitle('MPCS Testbench Dashboard');

    // 1. Navigate to Device Registry and Add a Device
    await window.click('text=Device Registry');
    await expect(window.locator('#device-registry')).toBeVisible();

    await window.fill('#dev-name', 'Playwright-DAQ');
    await window.fill('#dev-ip', '127.0.0.1');
    await window.fill('#dev-port', '8502');
    await window.click('button:has-text("Save Device")');

    // Verify it appears in the table
    const deviceRow = window.locator('#device-list tr').first();
    await expect(deviceRow).toContainText('Playwright-DAQ');

    // 2. Navigate to Calibration Dashboard
    await window.click('text=Calibration');
    await expect(window.locator('#calibration-dashboard')).toBeVisible();

    // Add a Signal Mapping
    await window.fill('#cal-sig-label', 'Playwright-AO');
    await window.selectOption('#cal-sig-type', 'analog-out');
    await window.fill('#cal-sig-ip', '127.0.0.1');
    await window.fill('#cal-sig-port', '8502');
    await window.fill('#cal-sig-read', '100');
    await window.fill('#cal-sig-scale', '200');
    await window.fill('#cal-sig-offset', '202');
    await window.fill('#cal-sig-deadzone', '204');
    await window.click('button:has-text("Save Signal")');

    // Verify signal is in table
    const signalRow = window.locator('#signal-list tr', { hasText: 'Playwright-AO' }).first();
    await expect(signalRow).toBeVisible();

    // 3. Test Calibration Process Business Logic
    
    // Listen for dialogs (alerts) and dismiss them so they don't block
    window.on('dialog', async dialog => {
        await dialog.accept();
    });

    // Select signal for calibration
    await signalRow.locator('button:has-text("Select")').click();
    await expect(window.locator('#active-cal-target')).toContainText('Playwright-AO');

    // Enter data points for curve fitting
    // We already have 2 inputs injected by default.
    // Row 1
    await window.locator('.pt-x').nth(0).fill('1');
    await window.locator('.pt-y').nth(0).fill('3');
    // Row 2
    await window.locator('.pt-x').nth(1).fill('5');
    await window.locator('.pt-y').nth(1).fill('11');

    // Enter manual deadzone
    await window.fill('#cal-input-dz', '0.5');

    // Calculate
    await window.click('button:has-text("2. Calculate Line")');

    // Verify Calculated Math logic was injected into the DOM (y=2x+1)
    await expect(window.locator('#cal-calc-m')).toHaveValue('2.0000');
    await expect(window.locator('#cal-calc-c')).toHaveValue('1.0000');

    // Program
    await window.click('button:has-text("3. Program & Handshake")');

    // Verify it was added to Calibration History
    await window.waitForTimeout(500); // give it a moment to save to db and render
    const historyItem = window.locator('#cal-history-list li').first();
    await expect(historyItem).toContainText('m:2.0000');
    await expect(historyItem).toContainText('c:1.0000');
    await expect(historyItem).toContainText('dz:0.5000');

    // Close app
    await electronApp.close();
});
