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
            /*
             * Word layout for BADC:
             *   buf[0] = A  (high byte of word 1)
             *   buf[1] = B  (low byte  of word 1)
             *   buf[2] = C  (high byte of word 2)
             *   buf[3] = D  (low byte  of word 2)
             */
            buf[0] = w1 >> 8;
            buf[1] = w1 & 0xFF;
            buf[2] = w2 >> 8;
            buf[3] = w2 & 0xFF;
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

/**
 * Convert a Data Model Address (1-based 5-digit, e.g. 40001) or a raw
 * 0-based Protocol Address (0–9999) to a 0-based Protocol Address.
 *
 * Rules (per docs/addressing_scheme.md):
 *   4xxxx  → Holding Register  (40001–49999) → subtract 40001
 *   3xxxx  → Input Register    (30001–39999) → subtract 30001
 *   1xxxx  → Discrete Input    (10001–19999) → subtract 10001
 *   0–9999 → already a raw 0-based protocol address → return as-is
 *
 * The previous fallback of `num - 1` was incorrect for raw addresses:
 * passing 0 returned -1, crashing the Modbus read.
 */
function toProtocolAddress(address, type) {
    if (address === null || address === undefined) return 0;
    let num = parseInt(address, 10);
    if (isNaN(num)) return 0;

    /* Data-model 1-based ranges — subtract the range base */
    if (num >= 40001 && num <= 49999) return num - 40001; // Holding Registers (4xxxx)
    if (num >= 30001 && num <= 39999) return num - 30001; // Input Registers   (3xxxx)
    if (num >= 10001 && num <= 19999) return num - 10001; // Discrete Inputs   (1xxxx)

    /*
     * Raw 0-based protocol address (0–9999) — pass through unchanged.
     * Covers coil addresses and signals configured with a raw protocol
     * address instead of the 5-digit data-model format.
     */
    if (num >= 0 && num <= 9999) return num;

    /* Outside all known ranges — clamp to 0 to avoid negative addresses. */
    return 0;
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