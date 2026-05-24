const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const electronPath = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { CalibrationPage } = require('./pages/CalibrationPage');

test.describe('Signal Mapping and I/O Test', () => {
    let electronApp;
    let window;
    let simulatorProcess;
    let calPage;

    test.beforeAll(async () => {
        // Start Modbus Simulator
        simulatorProcess = spawn('node', [path.join(__dirname, '..', 'modbus-simulator.js')]);
        
        // Give simulator a moment to start
        await new Promise(resolve => setTimeout(resolve, 1000));

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
        if (simulatorProcess) {
            simulatorProcess.kill();
        }
    });

    test('1. Create Device Registry (Local Simulator)', async () => {
        await window.locator('#tab-device-registry').click();
        await window.locator('#device-registry').waitFor({ state: 'visible' });

        await window.locator('#dev-name').fill('SimDevice');
        await window.locator('#dev-ip').fill('127.0.0.1');
        await window.locator('#dev-port').fill('502');
        await window.locator('#dev-key1').fill('128');
        await window.locator('#dev-key2').fill('129');
        await window.locator('#btn-save-device').click();

        const row = window.locator('#device-list tr', { hasText: 'SimDevice' }).first();
        await expect(row).toBeVisible();
    });

    test('2. Create Raw Registers from jerry_registers.json', async () => {
        await window.locator('#tab-raw-registers').click();
        await window.locator('#raw-registers').waitFor({ state: 'visible' });

        // Select the SimDevice
        await window.locator('#raw-dev-list button', { hasText: 'Select' }).first().click();
        await expect(window.locator('#raw-active-dev')).toContainText('SimDevice');

        // Create Coil 0 (digital_output_0)
        await window.locator('#raw-reg-type').selectOption('coil');
        await window.locator('#raw-reg-addr').fill('0');
        await window.locator('#raw-reg-desc').fill('digital_output_0');
        await window.locator('#btn-save-raw-reg').click();

        // Create Holding 0 (pwm_0_duty_cycle)
        await window.locator('#raw-reg-type').selectOption('holding');
        await window.locator('#raw-reg-addr').fill('0');
        await window.locator('#raw-reg-desc').fill('pwm_0_duty_cycle');
        await window.locator('#btn-save-raw-reg').click();

        // Create Holding 2 (ao_01_scale)
        await window.locator('#raw-reg-type').selectOption('holding');
        await window.locator('#raw-reg-addr').fill('2');
        await window.locator('#raw-reg-desc').fill('ao_01_scale');
        await window.locator('#btn-save-raw-reg').click();

        // Create Holding 4 (ao_01_offset)
        await window.locator('#raw-reg-type').selectOption('holding');
        await window.locator('#raw-reg-addr').fill('4');
        await window.locator('#raw-reg-desc').fill('ao_01_offset');
        await window.locator('#btn-save-raw-reg').click();

        // Create Holding 6 (ao_01_deadzone)
        await window.locator('#raw-reg-type').selectOption('holding');
        await window.locator('#raw-reg-addr').fill('6');
        await window.locator('#raw-reg-desc').fill('ao_01_deadzone');
        await window.locator('#btn-save-raw-reg').click();

        // Verify registers appear in table
        await expect(window.locator('#raw-reg-list tr', { hasText: 'digital_output_0' }).first()).toBeVisible();
        await expect(window.locator('#raw-reg-list tr', { hasText: 'pwm_0_duty_cycle' }).first()).toBeVisible();
        await expect(window.locator('#raw-reg-list tr', { hasText: 'ao_01_scale' }).first()).toBeVisible();
        await expect(window.locator('#raw-reg-list tr', { hasText: 'ao_01_offset' }).first()).toBeVisible();
        await expect(window.locator('#raw-reg-list tr', { hasText: 'ao_01_deadzone' }).first()).toBeVisible();
    });

    test('3. Create Signal Mapping using registers', async () => {
        await window.locator('#tab-signal-mapping').click();
        await window.locator('#signal-mapping').waitFor({ state: 'visible' });

        await window.locator('#cal-sig-label').fill('AO-01');
        await window.locator('#cal-sig-type').selectOption('analog-out');
        
        // The devId should be 1 if it's the first device, we can select by label using the selectOption text
        await window.locator('#cal-sig-device').selectOption({ label: 'SimDevice (127.0.0.1)' });

        // Assuming address 0 is pwm_0_duty_cycle
        await window.locator('#cal-sig-read').selectOption({ value: '0' }); 
        await window.locator('#cal-sig-enc').selectOption('ABCD');

        // Select mapped cal registers
        await window.locator('#cal-sig-scale').selectOption({ value: '2' });
        await window.locator('#cal-sig-offset').selectOption({ value: '4' });
        await window.locator('#cal-sig-deadzone').selectOption({ value: '6' });

        await window.locator('#btn-save-signal').click();

        const row = window.locator('#signal-list tr', { hasText: 'AO-01' }).first();

        await expect(row).toBeVisible();
    });

    test('4. Read and Write Raw Registers to Simulator', async () => {
        await window.locator('#tab-raw-registers').click();
        await window.locator('#raw-registers').waitFor({ state: 'visible' });
        
        await window.locator('#raw-dev-list button', { hasText: 'Select' }).first().click();

        // Find the pwm_0_duty_cycle row
        const row = window.locator('#raw-reg-list tr', { hasText: 'pwm_0_duty_cycle' }).first();
        
        // Write a value
        const writeInput = row.locator('input[type="text"]');
        await writeInput.fill('456');
        const writeBtn = row.locator('button', { hasText: 'W' }).first();
        await writeBtn.click();

        // Small delay for simulator network mock
        await window.waitForTimeout(500);

        // Read value
        const readBtn = row.locator('button', { hasText: 'Read' }).first();
        await readBtn.click();

        // Verify the value cell updated
        const valCell = row.locator('td[id^="raw-val-"]');

        await expect(valCell).toContainText('456');
    });

    test('5. Perform calibration and program sequence', async () => {
        await calPage.navigateToCalibration();

        // Select the signal "AO-01" from the dropdown/list in Calibration tab
        const row = window.locator('#cal-target-list tr', { hasText: 'AO-01' }).first();
        await row.locator('button', { hasText: 'Select' }).click();
        
        // Wait for active target to show AO-01
        await expect(calPage.activeTarget).toContainText('AO-01');

        // Fill Data Point 1
        await calPage.fillDataPoint(0, 1, 3);
        
        // Fill Data Point 2
        await calPage.fillDataPoint(1, 5, 11);

        // Execute Calculation (y = 2x + 1)
        await calPage.calculateLine(0.5);

        // Verify calculation results
        await expect(calPage.calcM).toHaveValue('2.0000');
        await expect(calPage.calcC).toHaveValue('1.0000');

        // Program to Modbus (click Program & Handshake button)
        await calPage.programBtn.click();
        
        // Wait for Modbus operation to finish
        await window.waitForTimeout(1000);

        // Navigate back to raw registers to verify values were written
        await window.locator('#tab-raw-registers').click();
        await window.locator('#raw-registers').waitFor({ state: 'visible' });

        // Ensure SimDevice is selected
        await window.locator('#raw-dev-list button', { hasText: 'Select' }).first().click();
        
        // Wait for the values to appear.
        // Let's verify we can read back the scale register (ao_01_scale)
        const scaleRow = window.locator('#raw-reg-list tr', { hasText: 'ao_01_scale' }).first();
        await scaleRow.locator('button', { hasText: 'Read' }).first().click();
        
        const offsetRow = window.locator('#raw-reg-list tr', { hasText: 'ao_01_offset' }).first();
        await offsetRow.locator('button', { hasText: 'Read' }).first().click();
        
        const dzRow = window.locator('#raw-reg-list tr', { hasText: 'ao_01_deadzone' }).first();
        await dzRow.locator('button', { hasText: 'Read' }).first().click();

        // We pause/wait here for Modbus reads to return
        await window.waitForTimeout(500);
        
        // Verify values are not empty (they will be parts of IEEE 754 floats as integers)
        await expect(scaleRow.locator('td[id^="raw-val-"]')).not.toBeEmpty();
        await expect(offsetRow.locator('td[id^="raw-val-"]')).not.toBeEmpty();
        await expect(dzRow.locator('td[id^="raw-val-"]')).not.toBeEmpty();
    });

    test('6. Cleanup: Delete created entries from database', async () => {
        await window.locator('#tab-device-registry').click();
        await window.locator('#device-registry').waitFor({ state: 'visible' });

        const row = window.locator('#device-list tr', { hasText: 'SimDevice' }).first();
        await row.locator('button', { hasText: 'Delete' }).click();

        // Verify row is deleted
        await expect(window.locator('#device-list tr', { hasText: 'SimDevice' })).toHaveCount(0);
        
        // Due to SQLite ON DELETE CASCADE, the mapped signals and raw registers for this device 
        // are automatically deleted from the database.
    });
});
