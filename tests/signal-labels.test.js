const {
	SIGNAL_LABELS,
	resolveSignalLabel,
} = require("../src/renderer/signal-labels");

describe("Signal Labels Unit Tests", () => {
	test("SIGNAL_LABELS contains all 128 digital inputs and 64 digital outputs", () => {
		expect(SIGNAL_LABELS).toBeDefined();

		// Check digital inputs I-00 to I-127
		for (let i = 0; i < 128; i++) {
			const sid = `I-${String(i).padStart(2, "0")}`;
			expect(SIGNAL_LABELS[sid]).toBeDefined();
			expect(SIGNAL_LABELS[sid].v3).toBeDefined();
			expect(SIGNAL_LABELS[sid].v2).toBeDefined();
		}

		// Check digital outputs O-00 to O-63
		for (let o = 0; o < 64; o++) {
			const sid = `O-${String(o).padStart(2, "0")}`;
			expect(SIGNAL_LABELS[sid]).toBeDefined();
			expect(SIGNAL_LABELS[sid].v3).toBeDefined();
			expect(SIGNAL_LABELS[sid].v2).toBeDefined();
		}
	});

	test("resolveSignalLabel defaults to v3 and formats active label properly", () => {
		expect(resolveSignalLabel("I-00")).toBe("(I-00)<br><b>BP1DJ / BLDJ</b>");
		expect(resolveSignalLabel("I-00", "v3")).toBe(
			"(I-00)<br><b>BP1DJ / BLDJ</b>",
		);
		expect(resolveSignalLabel("O-00", "v3")).toBe("(O-00)<br><b>DJ</b>");
	});

	test("resolveSignalLabel resolves v2 label when available", () => {
		expect(resolveSignalLabel("I-00", "v2")).toBe(
			"(I-00)<br><b>BP1DJ / BLDJ</b>",
		);
		expect(resolveSignalLabel("I-84", "v2")).toBe("(I-84)<br><b>MU_FB</b>");
		expect(resolveSignalLabel("I-84", "v3")).toBe("(I-84)<br><b>Q51_FB</b>");
		expect(resolveSignalLabel("I-123", "v2")).toBe("(I-123)<br><b>HORN</b>");
		expect(resolveSignalLabel("I-123", "v3")).toBe("(I-123)<br><b>C103_FB</b>");
	});

	test("resolveSignalLabel falls back to canonical ID format (I-XX) when V2 is empty/missing", () => {
		// I-69 is unassigned in V2
		expect(SIGNAL_LABELS["I-69"].v2).toBe("");
		expect(resolveSignalLabel("I-69", "v2")).toBe("(I-69)");
		expect(resolveSignalLabel("I-69", "v3")).toBe("(I-69)<br><b>LSGRP_O</b>");

		// I-86 is unassigned in V2
		expect(SIGNAL_LABELS["I-86"].v2).toBe("");
		expect(resolveSignalLabel("I-86", "v2")).toBe("(I-86)");
		expect(resolveSignalLabel("I-86", "v3")).toBe("(I-86)<br><b>VCD_ACK</b>");

		// Non-existent signal ID fallback
		expect(resolveSignalLabel("I-999", "v2")).toBe("(I-999)");
		expect(resolveSignalLabel("I-999", "v3")).toBe("(I-999)");
		expect(resolveSignalLabel("O-999", "v2")).toBe("(O-999)");
	});

	test("DOM hydration and toggle behavior works with resolveSignalLabel", () => {
		// Mock a document element list
		const mockElements = [
			{
				attributes: { "data-signal": "I-00" },
				getAttribute(name) {
					return this.attributes[name];
				},
				setAttribute(name, val) {
					this.attributes[name] = val;
				},
				innerHTML: "",
			},
			{
				attributes: { "data-signal": "I-84" },
				getAttribute(name) {
					return this.attributes[name];
				},
				setAttribute(name, val) {
					this.attributes[name] = val;
				},
				innerHTML: "",
			},
			{
				attributes: { "data-signal": "I-69" },
				getAttribute(name) {
					return this.attributes[name];
				},
				setAttribute(name, val) {
					this.attributes[name] = val;
				},
				innerHTML: "",
			},
		];

		// Apply V2
		mockElements.forEach((el) => {
			const sig = el.getAttribute("data-signal");
			el.innerHTML = resolveSignalLabel(sig, "v2");
		});

		expect(mockElements[0].innerHTML).toBe("(I-00)<br><b>BP1DJ / BLDJ</b>");
		expect(mockElements[1].innerHTML).toBe("(I-84)<br><b>MU_FB</b>");
		expect(mockElements[2].innerHTML).toBe("(I-69)");

		// Apply V3
		mockElements.forEach((el) => {
			const sig = el.getAttribute("data-signal");
			el.innerHTML = resolveSignalLabel(sig, "v3");
		});

		expect(mockElements[0].innerHTML).toBe("(I-00)<br><b>BP1DJ / BLDJ</b>");
		expect(mockElements[1].innerHTML).toBe("(I-84)<br><b>Q51_FB</b>");
		expect(mockElements[2].innerHTML).toBe("(I-69)<br><b>LSGRP_O</b>");
	});

	test("DOM dynamic signal ID derivation from textContent without data-signal attribute", () => {
		const mockElements = [
			{
				attributes: {},
				textContent: "(I-00)\nBP1DJ / BLDJ",
				getAttribute(name) {
					return this.attributes[name];
				},
				setAttribute(name, val) {
					this.attributes[name] = val;
				},
				innerHTML: "",
			},
			{
				attributes: {},
				textContent: "(I-84)\nQ51_FB",
				getAttribute(name) {
					return this.attributes[name];
				},
				setAttribute(name, val) {
					this.attributes[name] = val;
				},
				innerHTML: "",
			},
			{
				attributes: {},
				textContent: "(O-60)\nCTF (RUN)",
				getAttribute(name) {
					return this.attributes[name];
				},
				setAttribute(name, val) {
					this.attributes[name] = val;
				},
				innerHTML: "",
			},
		];

		// Simulate dynamic extraction in applySignalLabelVersion
		const applyVersion = (elements, version) => {
			elements.forEach((el) => {
				let sigId = el.getAttribute("data-signal");
				if (!sigId) {
					const match = el.textContent.match(/\(([IO]-\d+)\)/);
					if (match) {
						sigId = match[1];
						el.setAttribute("data-signal", sigId);
					}
				}
				if (sigId) {
					el.innerHTML = resolveSignalLabel(sigId, version);
				}
			});
		};

		// Initial switch to V2
		applyVersion(mockElements, "v2");
		expect(mockElements[0].getAttribute("data-signal")).toBe("I-00");
		expect(mockElements[0].innerHTML).toBe("(I-00)<br><b>BP1DJ / BLDJ</b>");
		expect(mockElements[1].getAttribute("data-signal")).toBe("I-84");
		expect(mockElements[1].innerHTML).toBe("(I-84)<br><b>MU_FB</b>");
		expect(mockElements[2].getAttribute("data-signal")).toBe("O-60");
		expect(mockElements[2].innerHTML).toBe("(O-60)<br><b>CTF (RUN)</b>");

		// Switch back to V3
		applyVersion(mockElements, "v3");
		expect(mockElements[1].innerHTML).toBe("(I-84)<br><b>Q51_FB</b>");
	});
});
