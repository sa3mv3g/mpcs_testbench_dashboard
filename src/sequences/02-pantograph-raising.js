/**
 * TC-02: Pantograph Raising & Catenary Detection
 * Source: Step 2, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TC-02",
	name: "Pantograph Raising & High Voltage Interlock",
	type: "positive",
	category: "Operational Sequences",
	description:
		"Raises pantograph 1 (ZPT1_2), confirms VEPT1 electrovalve output, and injects I-63 no-volt interlock within 1.0 second.",
	estimatedDurationMs: 6000,
	steps: [
		{
			name: "1. Baseline Preconditions & Cab Activation",
			run: async (bench) => {
				await applyPreBootPresets(bench);
				await bench.set("BATTERY_VOLTAGE", 110, "Battery = 110V");
				await bench.set("I-48", 1, "BL Key = High");
				await bench.set("I-72", 1, "BL1 = High");
				await bench.wait(1000);
			},
		},
		{
			name: "2. Raise Pantograph 1 via ZPT Switch",
			run: async (bench) => {
				await bench.set("I-05", 1, "ZPT1_2: Pantograph 1 Raise Command");
			},
		},
		{
			name: "3. Verify Pantograph Electrovalve Output (VEPT1)",
			run: async (bench) => {
				await bench.expect("O-02", 1, {
					within: 2000,
					desc: "O-02 (VEPT1) solenoid coil energized",
				});
			},
		},
		{
			name: "4. Inject C118 N/C / QCON Feedback (< 1.0s) & Catenary Voltage",
			run: async (bench) => {
				// Immediate feedback within 1.0s of O-02
				await bench.set(
					"I-63",
					1,
					"I-63 (C118 N/C / QCON): Initial converter no-volt feedback",
				);
				// Set analog catenary voltage
				await bench.set("OHE_CATENARY", 25, "OHE Catenary Voltage = 25 kV AC");
				await bench.set(
					"AUX_WINDING",
					380,
					"Auxiliary Transformer Winding = 380 V AC",
				);
			},
		},
	],
};
