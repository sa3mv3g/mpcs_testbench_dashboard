const { ModbusManager } = require('./modbus-manager');
const log = require('electron-log');
const path = require('path');
const fs = require('fs');

class JerryDevice extends ModbusManager {
    constructor() {
        super();
        this.expectedVersion = "0.7.0";
    }

    async connect(ip, port, unitId = 1) {
        // Perform standard connection
        const connectionObj = await super.connect(ip, port, unitId);
        
        if (!connectionObj.isConnected) {
            return connectionObj;
        }

        const key = this._getKey(ip, port);
        try {
            let actualMajor = 0;
            let actualMinor = 0;
            let actualPatch = 0;

            await this.enqueueHighPriority(ip, port, async (client) => {
                client.setID(unitId);
                // Read input registers 100, 101, 102 (major, minor, patch)
                const res = await client.readInputRegisters(100, 3);
                actualMajor = res.data[0];
                actualMinor = res.data[1];
                actualPatch = res.data[2];
            });

            const expectedParts = this.expectedVersion.split('.');
            const expectedMajor = parseInt(expectedParts[0] || "0");
            const expectedMinor = parseInt(expectedParts[1] || "0");

            let isVersionValid = false;
            if (actualMajor > expectedMajor) {
                isVersionValid = true;
            } else if (actualMajor === expectedMajor) {
                if (actualMinor >= expectedMinor) {
                    isVersionValid = true;
                }
            }

            if (!isVersionValid) {
                const actualVersion = `${actualMajor}.${actualMinor}.${actualPatch}`;
                const errMsg = `Version Mismatch (Expected >= ${expectedMajor}.${expectedMinor}.x, got ${actualVersion})`;
                log.error(`[JerryDevice] ${key}: ${errMsg}`);
                
                // Immediately reject all pending queues, abort reconnects, and close socket
                await this.disconnect(ip, port);
                
                // Re-add object to connections map with error so UI sees it
                // disconnect() deletes it, so we put it back in an offline, aborted state
                connectionObj.isConnected = false;
                connectionObj.aborted = true; // prevent auto-reconnect
                connectionObj.error = errMsg;
                this.connections.set(key, connectionObj);
                
                this.emit('statusChanged', this.getConnectionStatuses());
            } else {
                log.info(`[JerryDevice] ${key}: Version check passed (${actualMajor}.${actualMinor}.${actualPatch} is >= expected ${expectedMajor}.${expectedMinor}.x)`);
            }
        } catch (err) {
            log.error(`[JerryDevice] ${key}: Failed to read version - ${err.message}`);
            await this.disconnect(ip, port);
            
            // Show error in UI
            connectionObj.isConnected = false;
            connectionObj.aborted = true;
            connectionObj.error = "Failed to query version";
            this.connections.set(key, connectionObj);
            
            this.emit('statusChanged', this.getConnectionStatuses());
        }
        
        return connectionObj;
    }
}

module.exports = new JerryDevice();