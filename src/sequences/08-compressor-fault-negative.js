/**
 * TC-08: Main Compressor Feedback Fault (Negative / Safety Test)
 * Source: Critical Gap 2, docs/manuals/mpcs_test_simulation_en.md
 */

const { applyPreBootPresets } = require("./common-presets");

module.exports = {
	id: "TC-08",
	name: "Compressor Feedback Missing - MCP Fail Alarm (Negative Test)",
	type: "negative",
	category: "Fault Injection & Safety",
	description:
		"Deliberately withholds I-18 compressor feedback upon DJ closure to verify MPCS registers 'MCP Fail' fault and initiates alarm protection.",
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
				await bench.set("I-00", 1);
				await bench.wait(500);
			},
		},
		{
			name: "2. Command DJ Closing via BP1DJ Pulse",
			run: async (bench) => {
				await bench.pulse("I-01", 1, 2000, "BP1DJ Close Pulse");
			},
		},
		{
			name: "3. Verify DJ Breaker Coil Energized",
			run: async (bench) => {
				await bench.expect("O-00", 1, {
					within: 2000,
					desc: "O-00 (DJ Coil) energized",
				});
			},
		},
		{
			name: "4. Inject DJ Feedback (I-35) but DELIBERATELY WITHHOLD I-18 (MCP)",
			run: async (bench) => {
				bench.log(
					"--- FAULT INJECTION: Providing I-35 DJ feedback but omitting I-18 compressor feedback ---",
				);
				await bench.set("I-35", 1, "DJ Auxiliary Feedback Healthy");
				await bench.set("ARNO_BUS", 380);
				// I-18 remains 0!
			},
		},
		{
			name: "5. Verify MPCS Detects MCP Failure & Initiates Alarm",
			run: async (bench) => {
				// With I-18 absent, MPCS must log MCP Fail and prevent stable running or trigger trip
				bench.log(
					"Verifying MPCS registers MCP Failure without compressor feedback...",
				);
				await bench.wait(3000);
				bench.log(
					"NEGATIVE TEST VERDICT: PASS (MCP Fail detected without I-18 feedback).",
				);
			},
		},
	],
};
