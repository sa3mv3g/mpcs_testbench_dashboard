# Missing Frontend Validation on Calibration Points

## What to build
Add frontend input validation in `src/renderer/renderer.js` to ensure the Calibration Linear Regression algorithm does not receive empty or `NaN` data points.

When a user clicks "Program" in the Calibration Dashboard without filling out the expected/actual point boxes, the array mapping evaluates to `NaN`. This corrupted array is sent via IPC to the Main process, which fails silently or attempts to write corrupted coefficients to the hardware EEPROM.

## Acceptance criteria
- [ ] Blank or invalid data point textboxes trigger a UI validation warning (e.g., red outline or alert).
- [ ] The "Calculate" and "Program" buttons are disabled or block execution if any visible data point contains `NaN` or empty strings.
- [ ] Ensure at least 2 valid coordinates exist before calculating `m` and `c`.

## Blocked by
- None
