// --- Modbus Helpers ---
// Convert float32 to two unsigned 16-bit integers based on encoding
function floatToRegisters(value, encoding) {
    const buf = Buffer.alloc(4);
    buf.writeFloatBE(value, 0); // Native node writes ABCD (Big-Endian)

    let highWord = buf.readUInt16BE(0); // AB
    let lowWord = buf.readUInt16BE(2);  // CD

    switch (encoding) {
        case 'ABCD': // Big-Endian
            return [highWord, lowWord];
        case 'DCBA': // Little-Endian
            return [
                Buffer.from([buf[3], buf[2]]).readUInt16BE(0), // DC
                Buffer.from([buf[1], buf[0]]).readUInt16BE(0)  // BA
            ];
        case 'BADC': // Big-Endian Byte Swap
            return [
                Buffer.from([buf[1], buf[0]]).readUInt16BE(0), // BA
                Buffer.from([buf[3], buf[2]]).readUInt16BE(0)  // DC
            ];
        case 'CDAB': // Little-Endian Word Swap
            return [lowWord, highWord]; // CD, AB
        default:
            return [highWord, lowWord];
    }
}

// Convert two 16-bit Modbus registers to a float32 based on encoding
function registersToFloat(regs, encoding) {
    if (!regs || regs.length < 2) return 0.0;
    const buf = Buffer.alloc(4);
    
    // regs[0] is Word 1 (often High Word), regs[1] is Word 2 (often Low Word)
    const w1 = regs[0];
    const w2 = regs[1];

    switch (encoding) {
        case 'ABCD': // Big-Endian
            buf.writeUInt16BE(w1, 0);
            buf.writeUInt16BE(w2, 2);
            break;
        case 'DCBA': // Little-Endian
            buf[0] = w2 & 0xFF; // D
            buf[1] = w2 >> 8;   // C
            buf[2] = w1 & 0xFF; // B
            buf[3] = w1 >> 8;   // A
            break;
        case 'BADC': // Big-Endian Byte Swap
            buf[0] = w1 & 0xFF; // B
            buf[1] = w1 >> 8;   // A
            buf[2] = w2 & 0xFF; // D
            buf[3] = w2 >> 8;   // C
            break;
        case 'CDAB': // Little-Endian Word Swap
            buf.writeUInt16BE(w2, 0); // CD
            buf.writeUInt16BE(w1, 2); // AB
            break;
        default: // Default to ABCD
            buf.writeUInt16BE(w1, 0);
            buf.writeUInt16BE(w2, 2);
            break;
    }
    
    return buf.readFloatBE(0);
}

// Convert 1-based Data Model Address to 0-based Protocol Address
function toProtocolAddress(address, type) {
    let num = parseInt(address, 10);
    if (isNaN(num)) return 0;

    // Holding Registers (4xxxx)
    if (type.includes('holding') || type === 'analog-out') {
        if (num >= 40001 && num <= 49999) return num - 40001;
    }
    // Input Registers (3xxxx)
    if (type.includes('input') || type === 'analog-in') {
        if (num >= 30001 && num <= 39999) return num - 30001;
    }
    // Discrete Inputs (1xxxx)
    if (type.includes('discrete') || type === 'digital-in') {
        if (num >= 10001 && num <= 19999) return num - 10001;
    }
    
    return num - 1;
}

// --- Math Helpers ---
// Linear Regression y = mx + c
function calculateLinearRegression(xs, ys) {
    if(xs.length < 2 || xs.some(isNaN) || ys.some(isNaN)) {
        throw new Error("Need at least 2 valid data points.");
    }

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    const n = xs.length;
    for(let i = 0; i < n; i++) {
        sumX += xs[i]; 
        sumY += ys[i];
        sumXY += xs[i]*ys[i]; 
        sumX2 += xs[i]*xs[i];
    }
    
    // Calculate m (slope/scale)
    const m = (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX);
    // Calculate c (offset)
    const c = (sumY - m*sumX) / n;

    return { m, c };
}

// --- Validation Helpers ---
// Validate Modbus Protocol Address based on docs/addressing_scheme.md
// Allow up to 49999 to permit 1-based Data Model addresses
function validateModbusAddress(address) {
    const num = parseInt(address, 10);
    if (isNaN(num)) return false;
    if (num < 0 || num > 49999) return false;
    return true;
}

module.exports = {
    floatToRegisters,
    registersToFloat,
    toProtocolAddress,
    calculateLinearRegression,
    validateModbusAddress
};