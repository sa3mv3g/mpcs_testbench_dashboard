# Endianness Decoding Logic Documentation Mismatch

## What to build
Correct the inline developer comments in the `registersToFloat` function (`src/utils.js`) for the `BADC` encoding case.

While the bitwise extraction logic functionally produces the correct Float buffer output for Big-Endian Byte Swap, the inline comments explicitly mislabel the extraction logic (claiming it extracts Byte `B` when it actually extracts Byte `A`). This poses a high risk for future regressions if developers attempt to "fix" the logic to match the comments.

## Acceptance criteria
- [ ] Inline comments for `BADC` and `DCBA` correctly map to their respective byte identifiers (A, B, C, D) in accordance with IEEE-754 decoding standards.
- [ ] Unit tests for all 4 endianness encodings (ABCD, DCBA, BADC, CDAB) explicitly verify float extraction using known hex values.

## Blocked by
- None
