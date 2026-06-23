# Protocol Address Translation Bug

## What to build
Fix the Modbus address parsing logic in `toProtocolAddress` (`src/utils.js`) to correctly handle true 0-based Protocol Addresses.

Currently, if a user enters a raw protocol address (e.g., `0`) into the Raw Registers Explorer, the function incorrectly assumes it is a 1-based address and blindly subtracts 1 (returning `-1`, which crashes the Modbus read). It must differentiate between 5-digit Data Model inputs (e.g., `40001` -> `0`) and raw 0-based inputs based on validation.

## Acceptance criteria
- [ ] Values `0` to `9999` passed to `toProtocolAddress` evaluate directly to themselves (or the correct protocol address) instead of subtracting 1.
- [ ] Modbus Raw Registers explorer correctly reads protocol address `0`.
- [ ] Existing mapping functionality for `40001` data model addresses continues to translate to protocol address `0` flawlessly.

## Blocked by
- None
