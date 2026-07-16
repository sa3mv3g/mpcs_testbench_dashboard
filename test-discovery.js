const ModbusDiscovery = require('./src/discovery');

async function testDiscovery() {
    console.log("Starting discovery test...");
    
    // Auto-detect IP for the test
    const { networkInterfaces } = require('os');
    let testIp = null;
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                testIp = iface.address;
                break;
            }
        }
        if (testIp) break;
    }

    if (!testIp) {
        console.error("No valid IPv4 interface found.");
        return;
    }

    console.log(`Using interface IP: ${testIp}`);
    const discovery = new ModbusDiscovery(testIp);
    
    discovery.on('device-found', (dev) => {
        console.log("Live Event: Device Found ->", dev);
    });

    try {
        const results = await discovery.startDiscovery(3000);
        console.log("Discovery complete! Results:", results);
    } catch (e) {
        console.error("Discovery error:", e);
    }
}

testDiscovery();
