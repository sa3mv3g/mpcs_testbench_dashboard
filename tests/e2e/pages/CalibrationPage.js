class CalibrationPage {
    constructor(window) {
        this.window = window;
        
        // Signal Mapping Locators
        this.mappingTab = window.locator('#tab-signal-mapping');
        this.mappingPanel = window.locator('#signal-mapping');
        this.sigLabelInput = window.locator('#cal-sig-label');
        this.sigTypeSelect = window.locator('#cal-sig-type');
        this.sigDeviceSelect = window.locator('#cal-sig-device');
        this.saveSignalBtn = window.locator('button:has-text("Save Signal")');

        // Calibration Process Locators
        this.calTab = window.locator('#tab-calibration');
        this.calPanel = window.locator('#calibration-dashboard');
        this.activeTarget = window.locator('#active-cal-target');
        
        this.calcLineBtn = window.locator('button:has-text("2. Calculate Line")');
        this.programBtn = window.locator('button:has-text("3. Program & Handshake")');
        
        this.inputDz = window.locator('#cal-input-dz');
        this.calcM = window.locator('#cal-calc-m');
        this.calcC = window.locator('#cal-calc-c');
        this.historyListItems = window.locator('#cal-history-list li');
    }

    async navigateToMapping() {
        await this.mappingTab.click();
        await this.mappingPanel.waitFor({ state: 'visible' });
    }

    async navigateToCalibration() {
        await this.calTab.click();
        await this.calPanel.waitFor({ state: 'visible' });
    }

    async addBasicSignalMapping(label, type) {
        await this.navigateToMapping();
        await this.sigLabelInput.fill(label);
        await this.sigTypeSelect.selectOption(type);
        // Note: Full mapping requires device selection, which we might mock or skip for pure math tests
        await this.saveSignalBtn.click();
    }

    async fillDataPoint(rowIndex, xValue, yValue) {
        await this.window.locator('.pt-x').nth(rowIndex).fill(xValue.toString());
        await this.window.locator('.pt-y').nth(rowIndex).fill(yValue.toString());
    }

    async calculateLine(dzValue) {
        await this.inputDz.fill(dzValue.toString());
        await this.calcLineBtn.click();
    }
}

module.exports = { CalibrationPage };
