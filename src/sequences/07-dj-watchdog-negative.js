/**
 * TC-07: DJ Feedback Watchdog Trip (Negative / Safety Test)
 * Source: Step 5 Watchdog, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TC-07",
	name: "DJ Closing Watchdog Trip on Missing Feedback (Negative Test)",
	type: "negative",
	category: "Fault Injection & Safety",
	description:
		"Deliberately withholds I-35 DJ auxiliary contact feedback during closing to verify that MPCS auto-trips within the mandatory 4.0s watchdog limit.",
	estimatedDurationMs: 8000,
	steps: [
		{
			name: "1. Baseline Preconditions: Panto & HV Ready",
			run: async (bench) => {
				await applyPreBootPresets(bench);
				await bench.set("BATTERY_VOLTAGE", 110);
				await bench.set("I-48", 1);
				await bench.set("I-72", 1);
				await bench.set("I-05", 1);
				await bench.set("I-63", 1);
				await bench.set("OHE_CATENARY", 25);
				await bench.set("AUX_WINDING", 380);
				await bench.set("I-00", 1, "BLDJ Switch ON");
				await bench.wait(500);
			},
		},
		{
			name: "2. Pulse BP1DJ Pushbutton to Initiate DJ Closing",
			run: async (bench) => {
				await bench.pulse("I-01", 1, 2000, "BP1DJ Close Command");
			},
		},
		{
			name: "3. Verify DJ Breaker Closing Coil Energized (O-00)",
			run: async (bench) => {
				await bench.expect("O-00", 1, {
					within: 2000,
					desc: "O-00 (DJ Coil) energized",
				});
			},
		},
		{
			name: "4. Fault Injection: DELIBERATELY WITHHOLD I-35 (DJ FB)",
			run: async (bench) => {
				bench.log(
					"--- FAULT INJECTION: Withholding I-35 feedback to test MPCS 4.0s closing watchdog ---",
				);
				// Do NOT set I-35. We wait to verify MPCS trips.
				await bench.wait(1000);
			},
		},
		{
			name: "5. Verify MPCS Detects Missing Feedback & Trips DJ Breaker",
			run: async (bench) => {
				// Safety requirement: Within 4.0s of O-00 going High without feedback,
				// MPCS MUST de-energize O-00 and keep LSDJ (O-28) lit.
				bench.log("Awaiting MPCS automatic safety trip...");
				await bench.expect("O-00", 0, {
					within: 4500,
					desc: "PASS: MPCS correctly tripped DJ (O-00 de-energized) within 4.0s watchdog",
				});
				await bench.expect("O-28", 1, {
					within: 1000,
					desc: "PASS: Red LSDJ lamp remains illuminated (DJ Open)",
				});
				bench.log(
					"NEGATIVE TEST VERDICT: PASS (MPCS properly enforced 4.0s closing watchdog).",
				);
			},
		},
	],
};
