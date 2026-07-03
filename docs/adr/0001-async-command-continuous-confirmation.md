# ADR 0001: Asynchronous Command + Continuous Confirmation for Manual Outputs

## Status

Accepted

## Context

The Manual Dashboard was originally a 1:1 mirror of the physical testbench: the
500 ms poll read every coil/register from the hardware and pushed those values
directly into the UI widgets. The application reacted to the hardware.

A new requirement inverted this relationship. Because a device can spontaneously
reset (losing its output state), the **software** must become the source of
truth for output values, persist them across restarts, and actively push the
hardware back into compliance. A "Reset All to Default" button must de-energise
every output to 0/Off.

A first implementation kept the poll driving the output widgets while also
introducing a software-side "desired state". This produced two competing truths
for the same UI element and surfaced two concrete bugs:

1. **Clicks were silently swallowed.** Every 500 ms the poll ran
   `checkbox.checked = hardwareValue`. When the operator unchecked a box, the
   next poll re-checked it from the still-`true` hardware read. Because setting
   `.checked` programmatically does not fire a `change` event, the operator's
   intent (and the resulting hardware write) was never dispatched. The box
   appeared stuck.

2. **Reset did not work and indicators flickered.** Reset performed
   `DELETE FROM manual_desired_state`, leaving the enforcement cache empty.
   With no desired target, the enforcement loop went dormant and the hardware
   stayed energised. Meanwhile the naive mismatch flag flickered red during the
   normal write-settle window.

We considered three options:

- **A. Poll keeps driving widgets (status quo).** Rejected — it is the source of
  both bugs and contradicts the "software is the source of truth" requirement.
- **B. Synchronous write-modify-read on every click.** Rejected — it serialises
  UI responsiveness behind Modbus round-trips, and a one-shot verify cannot
  catch a device that resets *after* the write succeeded. We already poll
  continuously, so a blocking per-click verify is redundant.
- **C. Asynchronous command + continuous confirmation (chosen).** The standard
  SCADA pattern: separate the operator's command (Setpoint) from the hardware
  feedback (Process Value), and reconcile them with a small state machine.

## Decision

Adopt **asynchronous command + continuous confirmation** for all Manual
Dashboard outputs.

1. **Two distinct values per output, never conflated:**
   - **Setpoint** — the operator's command. Owned by software, persisted in
     SQLite, and the *only* thing that drives the output control widget
     (checkbox/slider).
   - **Process Value** — the hardware's reported state. Read-only. It drives a
     **separate feedback indicator**, never the control widget.

2. **The poll never writes to an output control widget.** It only reads the
   Process Value for confirmation. Inputs (digital-in LEDs, analog-in displays)
   remain hardware-driven as before.

3. **Per-output confirmation state machine**, owned by the Main Process:
   - `SYNCED` — Process Value equals Setpoint.
   - `PENDING` — Setpoint changed recently; a write was issued; we are within a
     grace window (≈ 2–3 polls) awaiting confirmation. Shown neutrally, never
     red.
   - `MISMATCH` — Process Value still disagrees with Setpoint after the grace
     window expires. Shown red (a genuine fault, e.g. a device reset), and the
     enforcement loop re-issues the corrective write.

4. **Reset All to Default upserts an explicit `0` for every known output**
   (never `DELETE`), so the enforcement loop has a concrete target and actively
   drives the hardware to 0.

## Consequences

**Positive**
- Operator clicks always dispatch; the poll can no longer swallow them.
- The red indicator now means a real fault, not a transient write-settle, thanks
  to the `PENDING` grace window.
- Continuous re-verification catches device resets that occur *after* a
  successful write — something a one-shot verify cannot do.
- Reset reliably de-energises hardware because enforcement always has a target.

**Negative / costs**
- The `state-update` IPC payload grows to carry a per-output confirmation state,
  not just a raw value.
- The Main Process must track `pendingUntil` timestamps per output, adding a
  small amount of state to the polling loop.
- The UI gains a second visual element (feedback dot) per output.

**Neutral**
- The 500 ms poll is reused as the read side of the confirmation loop; no new
  polling mechanism is introduced.
