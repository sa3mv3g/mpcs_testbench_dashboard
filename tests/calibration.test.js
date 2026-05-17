const { floatToRegisters, calculateLinearRegression, validateModbusAddress } = require('../src/utils');

describe('Calibration Dashboard - Math & Encoding Logic', () => {

    describe('Address Validation (docs/addressing_scheme.md)', () => {
        it('should return true for valid protocol addresses (0-9998)', () => {
            expect(validateModbusAddress(0)).toBe(true);
            expect(validateModbusAddress(100)).toBe(true);
            expect(validateModbusAddress(9998)).toBe(true);
        });

        it('should return false for invalid or out-of-bounds addresses', () => {
            expect(validateModbusAddress(-1)).toBe(false);
            expect(validateModbusAddress(9999)).toBe(false); // 0x270F is out of bounds
            expect(validateModbusAddress(40001)).toBe(false); // Should not accept Data Model addresses directly
            expect(validateModbusAddress('abc')).toBe(false);
            expect(validateModbusAddress(null)).toBe(false);
        });
    });

    describe('Curve Fitting Math Accuracy', () => {
        it('should correctly calculate scale (m) and offset (c) for a perfect line', () => {
            // y = 2x + 1
            const xs = [1, 2, 3, 4, 5];
            const ys = [3, 5, 7, 9, 11];

            const result = calculateLinearRegression(xs, ys);
            
            // Allow minor floating point precision errors
            expect(result.m).toBeCloseTo(2.0, 4);
            expect(result.c).toBeCloseTo(1.0, 4);
        });

        it('should correctly calculate scale (m) and offset (c) for real-world scattered points', () => {
            // Expected points vs actual points from a miscalibrated sensor
            const xs = [0.0, 5.0, 10.0];
            const ys = [0.1, 4.9, 10.2];

            const result = calculateLinearRegression(xs, ys);
            
            expect(result.m).toBeCloseTo(1.01, 2);
            expect(result.c).toBeCloseTo(0.016, 2);
        });

        it('should throw an error if fewer than 2 points are provided', () => {
            expect(() => calculateLinearRegression([1], [2])).toThrow("Need at least 2 valid data points.");
            expect(() => calculateLinearRegression([], [])).toThrow("Need at least 2 valid data points.");
        });
    });

    describe('Endianness Buffer Encoding', () => {
        // Example Value: 1.5
        // IEEE-754 representation of 1.5 is: 0x3FC00000
        // High Word: 0x3FC0
        // Low Word: 0x0000

        const testValue = 1.5;

        it('should encode f32 to ABCD (Big-Endian)', () => {
            const regs = floatToRegisters(testValue, 'ABCD');
            expect(regs[0]).toBe(0x3FC0);
            expect(regs[1]).toBe(0x0000);
        });

        it('should encode f32 to DCBA (Little-Endian)', () => {
            const regs = floatToRegisters(testValue, 'DCBA');
            // CD AB -> 00 00 C0 3F -> Word 1: 0x0000, Word 2: 0xC03F
            expect(regs[0]).toBe(0x0000);
            expect(regs[1]).toBe(0xC03F);
        });

        it('should encode f32 to BADC (Big-Endian Byte Swap)', () => {
            const regs = floatToRegisters(testValue, 'BADC');
            // AB CD -> BA DC -> Word 1: 0xC03F, Word 2: 0x0000
            expect(regs[0]).toBe(0xC03F);
            expect(regs[1]).toBe(0x0000);
        });

        it('should encode f32 to CDAB (Little-Endian Word Swap)', () => {
            const regs = floatToRegisters(testValue, 'CDAB');
            // AB CD -> CD AB -> Word 1: 0x0000, Word 2: 0x3FC0
            expect(regs[0]).toBe(0x0000);
            expect(regs[1]).toBe(0x3FC0);
        });
    });
});
