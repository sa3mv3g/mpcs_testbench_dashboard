const { EventEmitter } = require('events');
const Bonjour = require('bonjour-service').Bonjour;
const log = require('electron-log');

class ModbusDiscovery extends EventEmitter {
    constructor(interfaceIp) {
        super();
        this.interfaceIp = interfaceIp;
        this.bonjour = null;
        this.browser = null;
        this.discoveredDevices = [];
    }

    /**
     * Starts mDNS discovery and runs it for `durationMs`.
     * @param {number} durationMs 
     * @returns {Promise<Array>} Array of discovered devices { id, ip, port, name }
     */
    startDiscovery(durationMs = 3000) {
        return new Promise((resolve, reject) => {
            try {
                this.discoveredDevices = [];
                log.info(`[ModbusDiscovery] Binding mDNS discovery to interface: ${this.interfaceIp}`);
                this.bonjour = new Bonjour({ interface: this.interfaceIp });
                
                log.info('[ModbusDiscovery] Starting mDNS discovery for _modbus._tcp...');
                this.browser = this.bonjour.find({ type: 'modbus' });

                this.browser.on('up', (service) => {
                    log.info(`[ModbusDiscovery] Found mDNS service: Name=${service.name}, Host=${service.host}, Port=${service.port}, IPs=${service.addresses.join(', ')}`);
                    
                    // Parse device ID from service name or host (e.g., "jerry-1" -> 1, "device-3.local" -> 3)
                    const nameMatch = service.name.match(/\d+/);
                    const hostMatch = service.host.match(/\d+/);
                    const idString = nameMatch ? nameMatch[0] : (hostMatch ? hostMatch[0] : null);
                    
                    if (idString) {
                        const id = parseInt(idString, 10);
                        // Get the first IPv4 address
                        const ip = service.addresses.find(addr => addr.includes('.')) || service.addresses[0];
                        
                        // Check if we already found this device to avoid duplicates
                        if (!this.discoveredDevices.find(d => d.id === id)) {
                            const device = {
                                id,
                                ip,
                                port: service.port,
                                name: service.name
                            };
                            this.discoveredDevices.push(device);
                            log.info(`[ModbusDiscovery] Parsed Device ID ${id} at ${ip}:${service.port}`);
                            
                            // Emit event for UI
                            this.emit('device-found', device);
                        }
                    } else {
                        log.warn(`[ModbusDiscovery] Could not parse device ID from service name (${service.name}) or host (${service.host})`);
                    }
                });

                this.browser.on('down', (service) => {
                    log.info(`[ModbusDiscovery] Service went down: ${service.name}`);
                });

                // Stop discovery after duration
                setTimeout(() => {
                    log.info(`[ModbusDiscovery] Discovery timeout reached (${durationMs}ms), stopping...`);
                    this.stop();
                    resolve(this.discoveredDevices);
                }, durationMs);

            } catch (error) {
                log.error('[ModbusDiscovery] Error during discovery:', error);
                this.stop();
                reject(error);
            }
        });
    }

    stop() {
        if (this.browser) {
            this.browser.stop();
            this.browser = null;
        }
        if (this.bonjour) {
            this.bonjour.destroy();
            this.bonjour = null;
        }
    }
}

module.exports = ModbusDiscovery;