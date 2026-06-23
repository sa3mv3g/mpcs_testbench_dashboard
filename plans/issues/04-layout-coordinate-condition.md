# Layout Coordinate Condition Bug

## What to build
Fix an over-restrictive layout validation check in `renderManualDashboard()` (`src/renderer/renderer.js`) that rejects perfectly valid `(0, 0)` widget coordinates.

Currently, if the database returns a saved layout position of `x=0, y=0`, the dashboard assumes it is invalid or uninitialized and forcefully recalculates the position into a default staggered grid. `(0, 0)` is a valid top-left canvas coordinate that operators may purposefully choose.

## Acceptance criteria
- [ ] Widgets saved at `(0, 0)` restore exactly at the top-left corner upon dashboard load.
- [ ] Fallback layout calculation is only applied if no position exists in the database.
- [ ] Visual regression tests verify positioning behavior at absolute zero constraints.

## Blocked by
- None
