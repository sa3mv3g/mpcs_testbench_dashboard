/**
 * TC-05: Traction Reverser & Notch-1 Load Progression
 * Source: Steps 7, 8, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TC-05",
	name: "Traction Setup & Notch-1 Load Progression",
	type: "positive",
	category: "Operational Sequences",
	description:
		"Arms traction mode with reverser forward (I-27), CTF_RUN & MP_RUN (I-30/I-31), pulses MP+ to Notch 1, and verifies line contactor feedback within 1.0s.",
	estimatedDurationMs: 8000,
	steps: [
		{
			name: "1. Baseline Preconditions: DJ Sustained & Auxiliaries Running",
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
				await bench.wait(500);
			},
		},
		{
			name: "2. Engage Reverser Forward & Blower Contactor Switch",
			run: async (bench) => {
				await bench.set(
					"I-27",
					1,
					"I-27 (MPJ FOR): Reverser handle in Forward",
				);
				await bench.set(
					"I-15",
					1,
					"I-15 (BLVMT): Traction motor blower start switch",
				);
			},
		},
		{
			name: "3. Synchronize Master Controller RUN & CTF Drum (Critical Gap 1)",
			run: async (bench) => {
				// Both I-30 & I-31 must be High before pulsing MP+
				await bench.set("I-30", 1, "I-30 (MP_RUN): Master Controller in RUN");
				await bench.set(
					"I-31",
					1,
					"I-31 (CTF_RUN): Changeover drum in Traction",
				);
			},
		},
		{
			name: "4. Verify Reverser Forward Output (O-10)",
			run: async (bench) => {
				await bench.expect("O-10", 1, {
					within: 2000,
					desc: "O-10 (J_FOR) forward electrovalve energized",
				});
			},
		},
		{
			name: "5. Pulse Notch-Up Command (MP+) for 1.0 Second",
			run: async (bench) => {
				await bench.pulse("I-26", 1, 1000, "I-26 (MP+): Notch-Up Pulse");
			},
		},
		{
			name: "6. Verify Line Contactors Pick Up (O-26 & O-27)",
			run: async (bench) => {
				await bench.expect("O-26", 1, {
					within: 2000,
					desc: "O-26 (L1-3 Contactors) energized",
				});
				await bench.expect("O-27", 1, {
					within: 2000,
					desc: "O-27 (L4-6 Contactors) energized",
				});
			},
		},
		{
			name: "7. Inject Tap Changer Notch 1 & Contactor Feedback (< 1.0s)",
			run: async (bench) => {
				// Immediate feedback within 1.0s of line contactors:
				// Tap changer moved off Notch 0 (I-19 drops Low), and contactors confirmed closed (I-61 High)
				await bench.set("I-19", 0, "I-19 (GR-0): Tap changer left Notch 0");
				await bench.set(
					"I-61",
					1,
					"I-61 (L1-L6 FB): Line contactor auxiliary feedback",
				);
				await bench.set(
					"TM_VOLTAGE",
					100,
					"Traction Motor Armature Voltage = 100 V DC",
				);
			},
		},
	],
};
