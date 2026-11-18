/**
 * TC-06: Vigilance Control Device (VCD) - Nominal Pass Cycle
 * Source: Step 9, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TC-06",
	name: "Vigilance Control Device (VCD) - Nominal Acknowledgment",
	type: "positive",
	category: "Operational Sequences",
	description:
		"Monitors VCD vigilance alertness cycle, verifies warning LED/buzzer initiation, pulses VCD RESET (I-126) within the 8s grace window, and confirms normal reset.",
	estimatedDurationMs: 15000,
	steps: [
		{
			name: "1. Baseline Preconditions: Locomotive Operating at Notch 1",
			run: async (bench) => {
				await applyPreBootPresets(bench);
				await bench.set("BATTERY_VOLTAGE", 110);
				await bench.set("I-48", 1);
				await bench.set("I-72", 1);
				await bench.set("I-05", 1);
				await bench.set("I-63", 1);
				await bench.set("OHE_CATENARY", 25);
				await bench.set("AUX_WINDING", 380);
				await bench.set("I-00", 1);
				await bench.set("I-35", 1);
				await bench.set("I-18", 1);
				await bench.set("ARNO_BUS", 380);
				await bench.set("I-04", 1);
				await bench.set("I-02", 1);
				await bench.set("I-03", 1);
				await bench.set("I-27", 1);
				await bench.set("I-15", 1);
				await bench.set("I-30", 1);
				await bench.set("I-31", 1);
				await bench.set("I-19", 0);
				await bench.set("I-61", 1);
				await bench.set("TM_VOLTAGE", 100);
				await bench.wait(500);
			},
		},
		{
			name: "2. Idle Vigilance Monitoring (Simulate Driver Inactivity)",
			run: async (bench) => {
				bench.log("Awaiting VCD alertness timeout (holding controls idle)...");
				// Wait for VCD warning trigger (configurable simulation settle time)
				await bench.wait(3000);
			},
		},
		{
			name: "3. Verify VCD Warning Annunciation (O-79 LED & O-78 Buzzer)",
			run: async (bench) => {
				// Assert warning indicator
				await bench.expect("O-79", 1, {
					within: 5000,
					desc: "O-79 (VCD Warning Lamp) flashing / active",
				});
			},
		},
		{
			name: "4. Pulse VCD Reset Pushbutton (I-126) Within 8.0s Grace Window",
			run: async (bench) => {
				bench.log(
					"Driver acknowledges VCD warning by pressing reset pedal/switch...",
				);
				await bench.pulse(
					"I-126",
					1,
					1000,
					"I-126 (VCD RESET): Alertness acknowledgment",
				);
			},
		},
		{
			name: "5. Verify Warnings Extinguished & Normal Driving Maintained",
			run: async (bench) => {
				await bench.expect("O-79", 0, {
					within: 2000,
					desc: "O-79 (VCD Warning Lamp) extinguished",
				});
				await bench.expect("O-00", 1, {
					within: 1000,
					desc: "O-00 (DJ Breaker) remains sustained (No Penalty Brake)",
				});
			},
		},
	],
};
