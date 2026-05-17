class DeviceRegistryPage {
    constructor(window) {
        this.window = window;
        
        // Locators
        this.tabButton = window.locator('#tab-device-registry');
        this.panel = window.locator('#device-registry');
        
        this.nameInput = window.locator('#dev-name');
        this.ipInput = window.locator('#dev-ip');
        this.portInput = window.locator('#dev-port');
        this.key1Input = window.locator('#dev-key1');
        this.key2Input = window.locator('#dev-key2');
        this.saveBtn = window.locator('button:has-text("Save Device")');
        this.deviceListRows = window.locator('#device-list tr');
    }

    async navigate() {
        await this.tabButton.click();
        await this.panel.waitFor({ state: 'visible' });
    }

    async addDevice(name, ip, port, key1, key2) {
        await this.nameInput.fill(name);
        await this.ipInput.fill(ip);
        await this.portInput.fill(port);
        await this.key1Input.fill(key1);
        if (key2) await this.key2Input.fill(key2);
        
        await this.saveBtn.click();
    }

    getDeviceRow(name) {
        return this.deviceListRows.filter({ hasText: name });
    }
}

module.exports = { DeviceRegistryPage };
