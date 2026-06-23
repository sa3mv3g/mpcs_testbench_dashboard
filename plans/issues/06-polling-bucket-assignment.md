# Polling Bucket Assignment Bug

## What to build
Fix the bucket grouping logic in `startPollingLoop()` (`src/main.js`) that incorrectly routes raw analog register protocol addresses into the Discrete Coil polling bucket.

The logic groups signals based on ranges (e.g., `< 10000` equals coil). If a user configures an `analog-in` signal mapped to protocol address `10` (instead of `30011` or `40011`), the system mistakenly pushes it into `buckets.coil`. The polling loop then attempts to read boolean bits and decode them as IEEE-754 floats, causing corruption. 

## Acceptance criteria
- [ ] Polling bucket assignment respects the `signal.type` (e.g., `analog-in`) rather than exclusively relying on the `origAddr` numerical threshold.
- [ ] Analog signals mapped to low protocol addresses (e.g., `10`) are correctly grouped into holding or input register buckets based on their configuration.
- [ ] The system accurately block-reads these mixed scenarios without attempting float conversion on bit arrays.

## Blocked by
- #05-protocol-address-translation
