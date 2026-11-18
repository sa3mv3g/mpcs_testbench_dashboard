const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const electronPath = require('electron');
const fs = require('fs');
const path = require('path');
const { ModbusSimulatorCluster, BASE_PORT, NUM_BOARDS } = require('../mpcs-8board-simulator');
const { DI_POS_TO_ADDR, ANALOG_SIGNAL_ALIASES } = require('../../src/sequence-engine/signal-map');

/**
 * Wait up to `timeoutMs` for `predicate()` to return true, polling every `intervalMs`.
 */
async function waitFor(predicate, timeoutOrOptions = 10000, intervalMs = 250) {
    const timeoutMs = typeof timeoutOrOptions === 'object' ? (timeoutOrOptions.timeout || 10000) : timeoutOrOptions;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return true;
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
}

test.describe('Sequence Engine E2E Tests', () => {
    let electronApp;
    let window;
    let simulatorCluster;

    test.beforeAll(async () => {
        // 1. Start the 8-board Modbus TCP simulator
        simulatorCluster = new ModbusSimulatorCluster();
        await simulatorCluster.startAll();
        await new Promise(r => setTimeout(r, 1500)); // Give simulators a moment to bind

        // 2. Launch the Electron app
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        electronApp = await electron.launch({
            executablePath: electronPath,
            args: [path.join(__dirname, '..', '..', 'src', 'main.js')],
            env,
        });
        window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded'); // Ensure DOM is loaded
        window.on('dialog', d => d.accept()); // Auto-accept any dialogs
        window.on('console', msg => console.log(msg.text())); // Capture console logs from the browser context

        // Set a specific network interface for predictable discovery
        await window.waitForSelector('#network-interface-select'); // Wait for the select element to be available
        await window.evaluate(async () => {
            const loopbackAddress = '127.0.0.1';
            const selectEl = document.getElementById('network-interface-select');
            if (selectEl) {
                console.log('Network interface select element found.');
                // Try to find and select the loopback option if it exists
                const loopbackOption = Array.from(selectEl.options).find(option => option.value === loopbackAddress);
                if (loopbackOption) {
                    selectEl.value = loopbackAddress;
                    selectEl.dispatchEvent(new Event('change')); // Trigger change event
                    console.log(`Selected loopback interface: ${loopbackAddress}`);
                } else {
                    console.warn(`Loopback interface ${loopbackAddress} not found in options. Trying to add it.`);
                    const option = document.createElement('option');
                    option.value = loopbackAddress;
                    option.textContent = `Loopback - ${loopbackAddress}`;
                    selectEl.appendChild(option);
                    selectEl.value = loopbackAddress;
                    selectEl.dispatchEvent(new Event('change')); // Trigger change event
                    console.log(`Added and selected loopback interface: ${loopbackAddress}`);
                }
            } else {
                console.warn('Network interface select element not found, proceeding without UI interaction.');
            }
        });

        // 3. Register the 8 virtual boards in the Electron app
        const boardPorts = simulatorCluster.getAllBoardPorts();
        for (let i = 0; i < NUM_BOARDS; i++) {
            const boardId = i + 1;
            const port = boardPorts[i];
            await window.evaluate(async (device) => {
                await window.api.addDevice(device);
            }, {
                display_name: `MPCS_Board_${boardId}`,
                ip: '127.0.0.1',
                port: port,
                key1: null,
                key2: null,
                id: boardId, // Explicitly set ID for easy mapping
            });
        }
        // Verify all 8 virtual boards are registered with the expected loopback IP and ports
        const allConnected = await waitFor(async () => {
            const devices = await window.evaluate(() => window.api.getDevices());
            const ourDevices = devices.filter(d => d.id >= 1 && d.id <= NUM_BOARDS);
            return ourDevices.length === NUM_BOARDS && ourDevices.every(d => d.ip === '127.0.0.1' && d.port === boardPorts[d.id - 1]);
        }, {
            timeout: 20000,
        });

        expect(allConnected, 'All simulators should be registered with expected loopback IP and port within 20s').toBe(true);

        console.log('All Modbus boards started and Electron app connected.');
    });

    test.afterAll(async () => {
        if (electronApp) {
            console.log('Closing Electron app...');
            await electronApp.close();
        }
        if (simulatorCluster) {
            console.log('Stopping Modbus simulator cluster...');
            await simulatorCluster.stopAll();
        }
        console.log('Cleanup complete.');
    });

    test('should verify direct Modbus coil write and history', async () => {
        // await window.pause();
        const boardId = 1;
        const coilAddress = 5;
        const coilValue = true;
        const boardPort = simulatorCluster.getBoard(boardId).port;

        // Write coil directly via IPC
        await window.evaluate(async (args) => {
            await window.api.directWrite(args);
        }, {
            ip: '127.0.0.1',
            port: boardPort,
            fc: 'writeCoil',
            address: coilAddress,
            value: coilValue,
            unitId: boardId,
        });

        // Verify the coil state in the simulator
        const actualCoilValue = simulatorCluster.getCoil(boardId, coilAddress);
        expect(actualCoilValue).toBe(coilValue);

        // Verify write history
        const history = simulatorCluster.getWriteHistory(boardId, coilAddress);
        expect(history.length).toBeGreaterThanOrEqual(1);
        const lastWrite = history[history.length - 1];
        expect(lastWrite.address).toBe(coilAddress);
        expect(lastWrite.value).toBe(coilValue ? 1 : 0);
        expect(lastWrite.fc).toBe(5); // Function code for writeCoil
    });

    test('should verify direct Modbus holding register write and history', async () => {
        const boardId = 2;
        const registerAddress = 10;
        const registerValue = 12345;
        const boardPort = simulatorCluster.getBoard(boardId).port;

        // Write register directly via IPC
        await window.evaluate(async (args) => {
            await window.api.directWrite(args);
        }, {
            ip: '127.0.0.1',
            port: boardPort,
            fc: 'writeRegister',
            address: registerAddress,
            value: registerValue,
            unitId: boardId,
        });

        // Verify the holding register state in the simulator
        const actualRegisterValue = simulatorCluster.getHoldingRegister(boardId, registerAddress);
        expect(actualRegisterValue).toBe(registerValue);

        // Verify write history
        const history = simulatorCluster.getWriteHistory(boardId, registerAddress);
        expect(history.length).toBeGreaterThanOrEqual(1);
        const lastWrite = history[history.length - 1];
        expect(lastWrite.address).toBe(registerAddress);
        expect(lastWrite.value).toBe(registerValue);
        expect(lastWrite.fc).toBe(6); // Function code for writeRegister
    });

    test('should execute Cab Activation sequence and verify Modbus interactions', async () => {
        // Navigate to Sequence Execution tab
        await window.locator('#tab-sequence').click();

        // Select TC-01 sequence
        await window.locator('#seq-select').selectOption('TC-01');

        // Click Run Sequence button
        await window.locator('#btn-start-seq').click();

        // Wait for sequence log to appear and verdict badge to reach PASS
        await window.waitForSelector('#seq-log-box div:has-text("=== STARTING SEQUENCE: TC-01 ===")', { timeout: 10000 });
        await expect(window.locator('#seq-verdict-badge')).toHaveText('PASS', { timeout: 15000 });

        // Verify live UI progress/step logs
        const stepLogContent = await window.locator('#seq-log-box').textContent();
        expect(stepLogContent).toContain('>>> START STEP 1/4: 1. Apply 21 Pre-Boot Baseline Presets');
        expect(stepLogContent).toContain('>>> START STEP 2/4: 2. Set Control Battery Voltage to 110 V DC');
        expect(stepLogContent).toContain('>>> START STEP 3/4: 3. Engage BL Master Key and Cab 1 Switch');
        expect(stepLogContent).toContain('>>> START STEP 4/4: 4. Verify MPCS Boots with Red LSDJ Lamp Lit');

        // Verify specific Modbus writes in history for TC-01
        // Step 2: Set Control Battery Voltage to 110 V DC (BATTERY_VOLTAGE alias -> Board 1, Holding Register 0)
        const batteryVoltageInfo = ANALOG_SIGNAL_ALIASES.BATTERY_VOLTAGE;
        const batteryWrites = simulatorCluster.getWriteHistory(batteryVoltageInfo.devId, batteryVoltageInfo.addr);
        expect(batteryWrites.some(w => w.value === 110)).toBe(true);
        expect(batteryWrites.some(w => w.value === 0)).toBe(true);

        // Step 3: Engage BL Master Key (I-48) (Board 4, Coil 0) and Cab 1 Switch (I-72) (Board 5, Coil 8)
        const i48Writes = simulatorCluster.getWriteHistory(4, 0);
        expect(i48Writes.some(w => Boolean(w.value) === true)).toBe(true);
        const i72Writes = simulatorCluster.getWriteHistory(5, 8);
        expect(i72Writes.some(w => Boolean(w.value) === true)).toBe(true);

        // Verify all relevant coils/registers are de-energized to 0/false after sequence completion and safe teardown
        expect(simulatorCluster.getHoldingRegister(batteryVoltageInfo.devId, batteryVoltageInfo.addr)).toBe(0);
        expect(simulatorCluster.getCoil(4, 0)).toBe(false);
        expect(simulatorCluster.getCoil(5, 8)).toBe(false);
        expect(simulatorCluster.getDiscreteInput(4, DI_POS_TO_ADDR[5])).toBe(false);
    });

    test('should handle emergency stop and de-energize outputs', async () => {
        // Navigate to Sequence Execution tab
        await window.locator('#tab-sequence').click();

        // Select TC-01 sequence
        await window.locator('#seq-select').selectOption('TC-01');

        // Delay simulator feedback so TC-01 stays in Step 4 waiting for O-28
        simulatorCluster.feedbackDelayMs = 5000;
        try {
            // Click Run Sequence button to start it
            await window.locator('#btn-start-seq').click();

            // Wait until I-48 (Board 4, Coil 0) is energized
            const energized = await waitFor(() => simulatorCluster.getCoil(4, 0) === true, 5000, 50);
            expect(energized).toBe(true);

            // Click Emergency Stop button
            await window.locator('#btn-stop-seq').click();

            // Wait for UI verdict to reach ABORTED
            await expect(window.locator('#seq-verdict-badge')).toHaveText('ABORTED', { timeout: 10000 });
        } finally {
            simulatorCluster.feedbackDelayMs = 0;
        }

        // Verify relevant coils/registers are de-energized to 0/false after abort teardown
        expect(simulatorCluster.getHoldingRegister(1, 0)).toBe(0);
        expect(simulatorCluster.getCoil(4, 0)).toBe(false);       // I-48
        expect(simulatorCluster.getCoil(5, 8)).toBe(false);       // I-72
        expect(simulatorCluster.getDiscreteInput(4, DI_POS_TO_ADDR[5])).toBe(false); // O-28
    });

    test('should verify sequence run history and certificate export', async () => {
        // Re-run TC-01 to ensure fresh history entry
        await window.locator('#tab-sequence').click();
        await window.locator('#seq-select').selectOption('TC-01');
        await window.locator('#btn-start-seq').click();

        if (await window.locator('#modal-test-metadata').isVisible()) {
            await window.locator('#input-mpcs-serial').fill('TEST-MPCS-001');
            await window.locator('#input-loco-number').fill('TEST-LOCO-001');
            await window.locator('#input-tested-by').fill('Test Engineer');
            await window.locator('#input-tester-id').fill('TE-001');
            await window.locator('#btn-modal-proceed').click();
        }

        await expect(window.locator('#seq-verdict-badge')).toHaveText('PASS', { timeout: 15000 });

        // Verify run history appears
        await window.locator('#btn-refresh-history').click();
        const historyRows = window.locator('#seq-history-tbody tr');
        expect(await historyRows.count()).toBeGreaterThanOrEqual(1);
        await expect(window.locator('#seq-history-tbody')).toContainText('TC-01');
        await expect(window.locator('#seq-history-tbody')).toContainText('PASS');

        // Verify certificate export by stubbing dialog.showSaveDialog in the main process
        const exportPath = path.join(__dirname, `test-cert-${Date.now()}.xlsx`);
        await electronApp.evaluate(({ dialog }, targetPath) => {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath: targetPath });
        }, exportPath);

        await window.locator('#btn-export-seq-excel').click();

        const fileCreated = await waitFor(() => fs.existsSync(exportPath), 5000, 100);
        expect(fileCreated).toBe(true);
        expect(fs.existsSync(exportPath)).toBe(true);
        fs.unlinkSync(exportPath);

        // Verify that the export button is re-enabled
        await expect(window.locator('#btn-export-seq-excel')).not.toBeDisabled();
    });

});
