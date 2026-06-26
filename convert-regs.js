const fs = require('fs');
const path = require('path');

const txtPath = path.join(__dirname, 'tests/resource/jerry_device_register_map.txt');
const jsonPath = path.join(__dirname, 'tests/resource/jerry_registers.json');

const content = fs.readFileSync(txtPath, 'utf8');
const lines = content.split('\n');

const registers = {
    "coils": [],
    "discrete_inputs": [],
    "holding_registers": [],
    "input_registers": []
};

let currentSection = null;

for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('-') || line.startsWith('=')) continue;

    if (line.includes('COILS')) {
        currentSection = 'coils';
        continue;
    } else if (line.includes('DISCRETE INPUTS')) {
        currentSection = 'discrete_inputs';
        continue;
    } else if (line.includes('HOLDING REGISTERS')) {
        currentSection = 'holding_registers';
        continue;
    } else if (line.includes('INPUT REGISTERS') && !line.includes('DISCRETE')) {
        currentSection = 'input_registers';
        continue;
    }

    if (line.startsWith('Address')) continue;

    const parts = line.split(/\s{2,}/);
    if (parts.length < 3) continue;

    const address = parseInt(parts[0], 10);
    if (isNaN(address)) continue;

    const name = parts[1];

    if (currentSection === 'coils' || currentSection === 'discrete_inputs') {
        registers[currentSection].push({
            address,
            name,
            description: parts[parts.length - 1]
        });
    } else if (currentSection === 'holding_registers' || currentSection === 'input_registers') {
        registers[currentSection].push({
            address,
            name,
            type: parts[2],
            size: parseInt(parts[3], 10),
            description: parts[parts.length - 1]
        });
    }
}

fs.writeFileSync(jsonPath, JSON.stringify(registers, null, 2), 'utf8');
console.log(`Generated ${jsonPath}`);
