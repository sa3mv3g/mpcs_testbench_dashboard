const { networkInterfaces } = require('os');
const Bonjour = require('bonjour-service').Bonjour;

// 1. Find your actual local IP address (e.g., 192.168.1.X)
function getLocalIPAddress() {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over internal (loopback) and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                // Optional: filter out common virtual adapters if needed
                if (!name.includes('vEthernet') && !name.includes('WSL')) {
                    return iface.address;
                }
            }
        }
    }
    return null;
}

const localIp = getLocalIPAddress();
console.log(`Binding mDNS discovery specifically to interface: ${localIp}`);
const bonjour = new Bonjour({ interface: localIp });

console.log('Starting mDNS discovery for _modbus._tcp...');

// Browse for all _modbus._tcp services
const browser = bonjour.find({ type: 'modbus' });

browser.on('up', (service) => {
    console.log('Found an mDNS service:');
    console.log('  Name:', service.name);
    console.log('  Type:', service.type);
    console.log('  Host:', service.host);
    console.log('  Port:', service.port);
    console.log('  IPs:', service.addresses.join(', '));
    console.log('  TXT:', service.txt);
    console.log('-----------------------------------');
});

browser.on('down', (service) => {
    console.log('Service went down:', service.name);
});

// Keep process running until interrupted
process.on('SIGINT', () => {
    console.log('Stopping discovery...');
    bonjour.destroy();
    process.exit();
});
