# Write Preemption Hardcoded Address Format Flaw

## What to build
Fix the Modbus write function selection logic in the `modbus:preemptWrite` IPC handler (`src/main.js`).

Currently, the logic determines whether to use `writeCoil` or `writeRegister` based entirely on hardcoded numerical thresholds of the original address string:
```javascript
if (origAddr >= 40000 && origAddr < 50000) {
    await client.writeRegister(rawAddr, parseInt(value));
} else if (origAddr < 10000) {
    await client.writeCoil(rawAddr, !!value);
}
```
If a user correctly configures a manual Holding Register using a true 0-based protocol address (e.g., `15`) instead of the 1-based data model format (`40016`), the `origAddr < 10000` condition evaluates to true. The system then executes a boolean `writeCoil` on a 16-bit Holding Register address, which corrupts the device state or returns a Modbus exception.

## Acceptance criteria
- [ ] The decision to use `writeCoil` vs `writeRegister` relies primarily on the `sig.type` property (e.g., checking if type is `digital-out` vs `analog-out` or `holding`).
- [ ] Manual Holding Register writes succeed even if the configured address is a raw protocol address less than 10000.
- [ ] The logic gracefully handles errors if an invalid Modbus write function is attempted on a read-only memory space based on `type`.

## Blocked by
- #05-protocol-address-translation
