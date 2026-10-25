/**
 * Action Sequence Runner
 *
 * Orchestrates step-by-step test execution, tracks progress,
 * manages abort/emergency stop, evaluates pass/fail verdicts,
 * coordinates safe teardown, and persists results to SQLite.
 *
 * Adheres to:
 * - plans/action-sequence-engine-plan.md
 * - docs/adr/0003-sequence-engine-architecture-and-safety-teardown.md
 */

const { TestbenchHarness, AbortError } = require("./harness");
const db = require("../db");
const log = require("electron-log");

class SequenceRunner {
	/**
	 * @param {Object} options
	 * @param {Function} options.directWrite - Direct Modbus write function from main.js
	 * @param {Function} options.getDeviceIp - Function to get IP for device ID
	 * @param {Object} options.latestIndicatorState - Real-time polled indicator cache
	 * @param {Function} options.emitToRenderer - (channel, payload) => void
	 * @param {Function} options.onSequenceStateChange - (isActive) => void
	 * @param {Function} options.resetAllDesiredStates - () => Promise<void>
	 */
	constructor(options = {}) {
		this.directWrite = options.directWrite;
		this.getDeviceIp = options.getDeviceIp;
		this.latestIndicatorState = options.latestIndicatorState || {};
		this.emitToRenderer = options.emitToRenderer || (() => {});
		this.onSequenceStateChange = options.onSequenceStateChange || (() => {});
		this.resetAllDesiredStates =
			options.resetAllDesiredStates || (async () => {});

		this.state = "IDLE"; // 'IDLE' | 'RUNNING' | 'FINISHED' | 'ABORTED'
		this.currentSequence = null;
		this.currentHarness = null;
		this.abortController = { aborted: false };
		this.activeRunId = null;
	}

	get isRunning() {
		return this.state === "RUNNING";
	}

	/**
	 * Abort the active running sequence immediately.
	 */
	async abort() {
		if (this.state !== "RUNNING") {
			return { success: false, message: "No sequence is currently running" };
		}
		log.warn("[SequenceRunner] Operator requested emergency stop / abort");
		this.abortController.aborted = true;
		return { success: true };
	}

	/**
	 * Execute a sequence definition object.
	 *
	 * @param {Object} sequenceDef - Sequence definition from src/sequences/
	 * @param {Object} [runOptions] - { debugFreezeOnFailure?: boolean, metadata?: Object }
	 */
	async start(sequenceDef, runOptions = {}) {
		if (this.state === "RUNNING") {
			throw new Error(
				`Cannot start sequence "${sequenceDef.name}": another sequence is currently running`,
			);
		}

		this.state = "RUNNING";
		this.currentSequence = sequenceDef;
		this.abortController = { aborted: false };
		const debugFreeze = !!runOptions.debugFreezeOnFailure;
		const metadata = runOptions.metadata || {};

		// Notify main process to engage 100ms high-speed polling
		this.onSequenceStateChange(true);

		const startTime = Date.now();
		const stepAudit = [];
		let overallStatus = "PASS";
		let failureReason = null;
		let failedStepIndex = null;
		let finalPayload = null;

		// Initialize Testbench Harness
		const harness = new TestbenchHarness({
			directWrite: this.directWrite,
			getDeviceIp: this.getDeviceIp,
			latestIndicatorState: this.latestIndicatorState,
			logger: (msg) => {
				log.info(`[Sequence:${sequenceDef.id}] ${msg}`);
				this.emitToRenderer("sequence:log", {
					sequenceId: sequenceDef.id,
					message: msg,
				});
			},
			isAborted: () => this.abortController.aborted,
			onStepProgress: (progress) => {
				this.emitToRenderer("sequence:step-progress", progress);
			},
		});
		this.currentHarness = harness;

		this.emitToRenderer("sequence:started", {
			sequenceId: sequenceDef.id,
			sequenceName: sequenceDef.name,
			testType: sequenceDef.type || "positive",
			totalSteps: sequenceDef.steps ? sequenceDef.steps.length : 1,
			startTime,
		});

		try {
			// Normalize steps
			const steps = sequenceDef.steps || [
				{ name: sequenceDef.name, run: sequenceDef.run },
			];

			for (let i = 0; i < steps.length; i++) {
				if (this.abortController.aborted) {
					throw new AbortError("Test aborted by operator.");
				}

				const step = steps[i];
				const stepName = step.name || `Step ${i + 1}`;
				const stepStart = Date.now();

				this.emitToRenderer("sequence:step-update", {
					sequenceId: sequenceDef.id,
					stepIndex: i,
					totalSteps: steps.length,
					stepName,
					status: "RUNNING",
				});

				harness.log(`>>> START STEP ${i + 1}/${steps.length}: ${stepName}`);

				try {
					if (typeof step.run === "function") {
						await step.run(harness);
					} else if (typeof step.fn === "function") {
						await step.fn(harness);
					} else {
						throw new Error(
							`Step ${stepName} does not have an executable run() function`,
						);
					}

					const stepElapsed = Date.now() - stepStart;
					harness.log(`<<< STEP ${i + 1} PASSED (${stepElapsed}ms)`);

					stepAudit.push({
						stepIndex: i,
						name: stepName,
						status: "PASS",
						durationMs: stepElapsed,
					});

					this.emitToRenderer("sequence:step-update", {
						sequenceId: sequenceDef.id,
						stepIndex: i,
						totalSteps: steps.length,
						stepName,
						status: "PASS",
						durationMs: stepElapsed,
					});
				} catch (stepErr) {
					const stepElapsed = Date.now() - stepStart;

					if (stepErr instanceof AbortError) {
						throw stepErr; // Re-throw to outer handler
					}

					failedStepIndex = i;
					failureReason = stepErr.message;
					harness.log(
						`<<< STEP ${i + 1} FAILED (${stepElapsed}ms): ${stepErr.message}`,
					);

					stepAudit.push({
						stepIndex: i,
						name: stepName,
						status: "FAIL",
						durationMs: stepElapsed,
						error: stepErr.message,
					});

					this.emitToRenderer("sequence:step-update", {
						sequenceId: sequenceDef.id,
						stepIndex: i,
						totalSteps: steps.length,
						stepName,
						status: "FAIL",
						durationMs: stepElapsed,
						error: stepErr.message,
					});

					// Stop execution on first step failure
					overallStatus = "FAIL";
					break;
				}
			}
		} catch (err) {
			if (err instanceof AbortError) {
				overallStatus = "ABORTED";
				failureReason = "Aborted by operator / emergency stop.";
				harness.log("Test sequence execution halted by operator.");
			} else {
				overallStatus = "FAIL";
				failureReason = err.message;
				harness.log(
					`Test sequence encountered unhandled error: ${err.message}`,
				);
			}
		} finally {
			const completedAt = Date.now();
			const durationMs = completedAt - startTime;
			const passedCount = stepAudit.filter((s) => s.status === "PASS").length;

			// Handle Teardown Protocol (ADR 0003)
			if (overallStatus === "FAIL" && debugFreeze) {
				harness.log(
					"DEBUG FREEZE ACTIVE: Preserving hardware output states for multimeter inspection.",
				);
			} else {
				harness.log("Executing automatic safe teardown...");
				try {
					await harness.teardown();
					await this.resetAllDesiredStates();
				} catch (teardownErr) {
					log.error("[SequenceRunner] Teardown error:", teardownErr);
				}
			}

			// Save Run to SQLite
			try {
				const runRecord = {
					sequence_id: sequenceDef.id,
					sequence_name: sequenceDef.name,
					test_type: sequenceDef.type || "positive",
					status: overallStatus,
					started_at: new Date(startTime).toISOString(),
					completed_at: new Date(completedAt).toISOString(),
					duration_ms: durationMs,
					total_steps: sequenceDef.steps ? sequenceDef.steps.length : 1,
					passed_steps: passedCount,
					failed_step_index: failedStepIndex,
					failure_reason: failureReason,
					step_details: stepAudit,
					metadata,
				};

				const saveRes = await db.saveSequenceRun(runRecord);
				this.activeRunId = saveRes.id;
			} catch (dbErr) {
				log.error(
					"[SequenceRunner] Failed to persist sequence run to database:",
					dbErr,
				);
			}

			this.state = overallStatus === "ABORTED" ? "ABORTED" : "FINISHED";

			// Notify main process to revert to 500ms normal polling
			this.onSequenceStateChange(false);

			finalPayload = {
				runId: this.activeRunId,
				sequenceId: sequenceDef.id,
				sequenceName: sequenceDef.name,
				status: overallStatus,
				durationMs,
				totalSteps: sequenceDef.steps ? sequenceDef.steps.length : 1,
				passedSteps: passedCount,
				failureReason,
				stepAudit,
			};

			this.emitToRenderer("sequence:finished", finalPayload);
		}

		return finalPayload;
	}
}

module.exports = {
	SequenceRunner,
};
