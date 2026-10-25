/**
 * Action Sequence Registry
 *
 * Discovers and registers test suite definitions in src/sequences/.
 *
 * Adheres to:
 * - plans/action-sequence-engine-plan.md
 */

const fs = require("fs");
const path = require("path");
const log = require("electron-log");

class SequenceRegistry {
	constructor(sequencesDir) {
		this.sequencesDir = sequencesDir || path.join(__dirname, "..", "sequences");
		this.sequences = new Map(); // id -> sequence definition
	}

	/**
	 * Scan directory and load all .js test sequence modules.
	 */
	loadAll() {
		this.sequences.clear();

		if (!fs.existsSync(this.sequencesDir)) {
			try {
				fs.mkdirSync(this.sequencesDir, { recursive: true });
			} catch (err) {
				log.error(
					`[SequenceRegistry] Failed to create sequences dir: ${err.message}`,
				);
				return;
			}
		}

		try {
			const files = fs
				.readdirSync(this.sequencesDir)
				.filter((f) => f.endsWith(".js") && !f.startsWith("common-"));

			for (const file of files) {
				try {
					const filePath = path.join(this.sequencesDir, file);
					// Delete require cache so live development reloads fresh files
					delete require.cache[require.resolve(filePath)];
					const seq = require(filePath);

					if (seq && seq.id && (seq.steps || typeof seq.run === "function")) {
						this.register(seq);
					} else {
						log.warn(
							`[SequenceRegistry] File ${file} does not export a valid sequence definition`,
						);
					}
				} catch (err) {
					log.error(
						`[SequenceRegistry] Error loading sequence from ${file}:`,
						err,
					);
				}
			}

			log.info(
				`[SequenceRegistry] Loaded ${this.sequences.size} sequence(s) from ${this.sequencesDir}`,
			);
		} catch (err) {
			log.error("[SequenceRegistry] Error scanning sequences directory:", err);
		}
	}

	register(sequenceDef) {
		if (!sequenceDef.id) {
			throw new Error("Sequence definition must have an id");
		}
		this.sequences.set(sequenceDef.id, sequenceDef);
	}

	get(id) {
		return this.sequences.get(id);
	}

	list() {
		const result = [];
		for (const [id, seq] of this.sequences.entries()) {
			result.push({
				id,
				name: seq.name || id,
				type: seq.type || "positive",
				category:
					seq.category ||
					(seq.type === "negative" ? "Fault Injection" : "Subsystem Test"),
				description: seq.description || "",
				stepCount: seq.steps ? seq.steps.length : 1,
				estimatedDurationMs: seq.estimatedDurationMs || 0,
			});
		}
		return result;
	}
}

module.exports = {
	SequenceRegistry,
};
