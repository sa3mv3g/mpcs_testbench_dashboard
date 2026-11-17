/**
 * TC-03: Arno Converter Starting & DJ Circuit Breaker Closing (Positive)
 * Source: Steps 3, 4, 5, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TC-03",
	name: "DJ Circuit Breaker Closing & Arno Synchronization",
	type: "positive",
	category: "Operational Sequences",
	description:
		"Engages BLDJ starting contactor (C118), commands DJ closing via BP1DJ, and provides synchronous DJ/compressor feedback within the 4.0s watchdog window.",
	estimatedDurationMs: 8000,
	steps: [
		{
			name: "1. Baseline Preconditions: Panto & HV Established",
			run: async (bench) => {
				await applyPreBootPresets(bench);
				await bench.set("BATTERY_VOLTAGE", 110);
				await bench.set("I-48", 1);
				await bench.set("I-72", 1);
				await bench.set("I-05", 1, "Panto UP");
				await bench.set("I-63", 1, "QCON FB");
				await bench.set("OHE_CATENARY", 25);
				await bench.set("AUX_WINDING", 380);
				await bench.wait(500);
			},
		},
		{
			name: "2. Command Arno Starting Phase via BLDJ",
			run: async (bench) => {
				await bench.set("I-00", 1, "BLDJ Switch ON");
			},
		},
		{
			name: "3. Verify Starting Contactor Output (C118 / BLSI)",
			run: async (bench) => {
				await bench.expect("O-01", 1, {
					within: 2000,
					desc: "O-01 (C118) starting contactor energized",
				});
			},
		},
		{
			name: "4. Pulse BP1DJ Pushbutton for 2.0 Seconds",
			run: async (bench) => {
				// Pulse BP1DJ (I-01) High for 2.0s
				await bench.pulse("I-01", 1, 2000, "BP1DJ Closing Command");
			},
		},
		{
			name: "5. Verify DJ Breaker Closing Coil Energized",
			run: async (bench) => {
				await bench.expect("O-00", 1, {
					within: 2000,
					desc: "O-00 (DJ Coil) energized",
				});
			},
		},
		{
			name: "6. Inject Synchronous DJ & Compressor Feedback (Within 4.0s)",
			run: async (bench) => {
				// Feedbacks must arrive before the 4.0s watchdog timer expires
				await bench.set(
					"I-35",
					1,
					"I-35 (DJ FB): Main breaker auxiliary contact closed",
				);
				await bench.set(
					"I-18",
					1,
					"I-18 (C101_3 FB): Compressor contactor closed",
				);
				await bench.set(
					"ARNO_BUS",
					380,
					"Arno Converter 3-Phase Bus = 380V AC",
				);
			},
		},
		{
			name: "7. Verify C118 De-energized & Red LSDJ Extinguished",
			run: async (bench) => {
				// MPCS automatically de-energizes starting contactor O-01 and turns OFF red LSDJ lamp O-28
				await bench.expect("O-01", 0, {
					within: 3000,
					desc: "O-01 (C118) de-energized (Arno accelerated)",
				});
				await bench.expect("O-28", 0, {
					within: 3000,
					desc: "O-28 (LSDJ) extinguished (DJ Closed & Sustained)",
				});
			},
		},
	],
};
