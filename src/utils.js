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
// The raw protocol address must be between 0x0000 and 0x270E (0 to 9998)
function validateModbusAddress(address) {
    const num = parseInt(address, 10);
    if (isNaN(num)) return false;
    if (num < 0 || num > 9998) return false;
    return true;
}

module.exports = {
    floatToRegisters,
    calculateLinearRegression,
    validateModbusAddress
};