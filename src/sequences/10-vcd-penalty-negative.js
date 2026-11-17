/**
 * TC-10: Vigilance Control Device (VCD) - Penalty Emergency Brake Trip (Negative Test)
 * Source: Step 9, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TC-10",
	name: "VCD Penalty Emergency Brake & DJ Trip (Negative Test)",
	type: "negative",
	category: "Fault Injection & Safety",
	description:
		"Simulates driver incapacitation: ignores VCD audiovisual warnings past the 8.0s window to verify MPCS energizes EM VALVE (O-77) and trips the DJ breaker.",
	estimatedDurationMs: 16000,
	steps: [
		{
			name: "1. Baseline Preconditions: Locomotive Operating Under Load",
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
			name: "2. Verify VCD Warning Annunciation Initiated",
			run: async (bench) => {
				bench.log("Awaiting VCD warning trigger...");
				await bench.expect("O-79", 1, {
					within: 5000,
					desc: "O-79 (VCD Warning Lamp) flashing / active",
				});
			},
		},
		{
			name: "3. Fault Injection: DELIBERATELY IGNORE VCD WARNING (No Reset Pulse)",
			run: async (bench) => {
				bench.log(
					"--- FAULT INJECTION: Simulating driver incapacitation (holding I-126 idle past 8.0s) ---",
				);
				// Do NOT pulse I-126. Allow the 8-second warning grace period to lapse.
				await bench.wait(4000);
			},
		},
		{
			name: "4. Verify Emergency Brake Valve Energized (O-77) & DJ Tripped (O-00)",
			run: async (bench) => {
				bench.log(
					"Awaiting MPCS emergency penalty brake application (O-77) and DJ trip...",
				);
				// Penalty brake valve O-77 MUST pick up
				await bench.expect("O-77", 1, {
					within: 6000,
					desc: "PASS: O-77 (EM VALVE) energized (Emergency penalty brake applied)",
				});
				// DJ breaker O-00 MUST drop to 0
				await bench.expect("O-00", 0, {
					within: 2000,
					desc: "PASS: O-00 (DJ Coil) tripped open by penalty application",
				});
				bench.log(
					"NEGATIVE TEST VERDICT: PASS (Emergency penalty brake and DJ trip successfully enforced).",
				);
			},
		},
	],
};
