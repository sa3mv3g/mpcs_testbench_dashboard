/**
 * TC-01: Cab Activation & Health Diagnostics
 * Source: Step 1, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TC-01",
	name: "Cab-1 Activation & Baseline Diagnostics",
	type: "positive",
	category: "Operational Sequences",
	description:
		"Asserts the 21 pre-boot safety presets, sets battery voltage to 110V DC, and activates Cab 1 with BL Key and BL1.",
	estimatedDurationMs: 4000,
	steps: [
		{
			name: "1. Apply 21 Pre-Boot Baseline Presets",
			run: async (bench) => {
				await applyPreBootPresets(bench);
			},
		},
		{
			name: "2. Set Control Battery Voltage to 110 V DC",
			run: async (bench) => {
				await bench.set(
					"BATTERY_VOLTAGE",
					110,
					"Control battery voltage pot = 110V DC",
				);
			},
		},
		{
			name: "3. Engage BL Master Key and Cab 1 Switch",
			run: async (bench) => {
				await bench.set("I-48", 1, "BL Key: Master cab control key unlocked");
				await bench.set("I-72", 1, "BL1: Cab-1 activation switch turned ON");
			},
		},
		{
			name: "4. Verify MPCS Boots with Red LSDJ Lamp Lit",
			run: async (bench) => {
				// MPCS boots, confirms DJ is open by illuminating red LSDJ lamp (O-28)
				await bench.expect("O-28", 1, {
					within: 3000,
					desc: "O-28 (LSDJ) illuminated (DJ Open / System Ready)",
				});
			},
		},
	],
};
