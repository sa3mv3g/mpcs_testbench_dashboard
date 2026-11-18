/**
 * TC-09: Auxiliary Blower Airflow Failure - Q118 Safety Timer Trip (Negative Test)
 * Source: Critical Gap 3 & Step 6, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TC-09",
	name: "Blower Airflow Failure - Q118 Safety Timer Trip (Negative Test)",
	type: "negative",
	category: "Fault Injection & Safety",
	description:
		"Closes DJ but deliberately withholds auxiliary blower airflow feedbacks to verify MPCS trips DJ upon expiration of the 5.6-second Q118 safety timer.",
	estimatedDurationMs: 9000,
	steps: [
		{
			name: "1. Baseline Preconditions: DJ Closed",
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
				await bench.pulse("I-01", 1, 2000);
				await bench.set("I-35", 1);
				await bench.set("I-18", 1);
				await bench.set("ARNO_BUS", 380);
				bench.log(
					"DJ is temporarily closed. Internal Q118 safety timer (5.6s) is now running...",
				);
			},
		},
		{
			name: "2. Fault Injection: DELIBERATELY WITHHOLD ALL BLOWER FEEDBACKS",
			run: async (bench) => {
				bench.log(
					"--- FAULT INJECTION: Withholding QVRH (I-04), QVMT1 (I-02), and QVMT2 (I-03) ---",
				);
				// Do NOT set I-04, I-02, or I-03
				// Hardware safety timer Q118 must trip DJ in 5.6 seconds
				await bench.wait(2000);
			},
		},
		{
			name: "3. Verify Q118 Safety Timer Trips DJ Circuit Breaker",
			run: async (bench) => {
				bench.log("Awaiting Q118 timeout (5.6s from DJ close)...");
				// MPCS MUST drop O-00 and illuminate O-28 (LSDJ)
				await bench.expect("O-00", 0, {
					within: 6000,
					desc: "PASS: MPCS correctly tripped DJ (O-00 de-energized) on Q118 blower failure",
				});
				await bench.expect("O-28", 1, {
					within: 1000,
					desc: "PASS: Red LSDJ lamp illuminated (DJ Tripped)",
				});
				bench.log(
					"NEGATIVE TEST VERDICT: PASS (Q118 5.6-second safety trip successfully verified).",
				);
			},
		},
	],
};
