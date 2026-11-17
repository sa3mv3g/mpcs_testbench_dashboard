// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `window.api` instead.

const manual_dashboard_max_elements_horz = 15;

window.openTab = function (evt, tabName) {
	console.log(`[Renderer] Switching to tab: ${tabName}`);
	window.api.setActiveDashboard(tabName);
	const tabcontent = document.getElementsByClassName("tab-content");
	for (let i = 0; i < tabcontent.length; i++) {
		tabcontent[i].style.display = "none";
	}

	const tablinks = document.getElementsByClassName("tablinks");
	for (let i = 0; i < tablinks.length; i++) {
		tablinks[i].className = tablinks[i].className.replace(" active", "");
	}

	document.getElementById(tabName).style.display = "block";
	evt.currentTarget.className += " active";
};

window.showStatus = function(message, isError = false) {
    const bar = document.getElementById('bottom-status-bar');
    if (!bar) return;
    bar.textContent = message;
    bar.style.backgroundColor = isError ? '#dc3545' : '#333';
    clearTimeout(window.statusTimeout);
    window.statusTimeout = setTimeout(() => {
        bar.textContent = 'Ready';
        bar.style.backgroundColor = '#333';
    }, 4000);
};

document.addEventListener("DOMContentLoaded", async () => {
	// Populate App Version
	const getVersionFn = window.api?.getAppVersion || window.electronAPI?.getAppVersion;
	if (getVersionFn) {
		try {
			const version = await getVersionFn();
			const versionEl = document.getElementById("app-version");
			if (versionEl && version) {
				versionEl.textContent = `v${version}`;
			}
			const aboutVersionEl = document.getElementById("about-modal-version");
			if (aboutVersionEl && version) {
				aboutVersionEl.textContent = `v${version}`;
			}
		} catch (err) {
			console.error("Failed to load app version:", err);
		}
	}

	// --- External Links Delegate Handler ---
	document.addEventListener("click", (e) => {
		const link = e.target.closest("a.external-link, a[href^='http://'], a[href^='https://']");
		if (link) {
			e.preventDefault();
			const url = link.getAttribute("href");
			if (url) {
				const openFn = (window.api && window.api.openExternal) || (window.electronAPI && window.electronAPI.openExternal);
				if (openFn) {
					openFn(url);
				}
			}
		}
	});

	// --- About Modal Dialog Handling ---
	const btnAboutDialog = document.getElementById("btn-about-dialog");
	const modalAbout = document.getElementById("modal-about");
	const btnCloseAboutModal = document.getElementById("btn-close-about-modal");

	if (btnAboutDialog && modalAbout) {
		btnAboutDialog.addEventListener("click", () => {
			modalAbout.style.display = "flex";
		});
	}

	if (btnCloseAboutModal && modalAbout) {
		btnCloseAboutModal.addEventListener("click", () => {
			modalAbout.style.display = "none";
		});
	}

	if (modalAbout) {
		modalAbout.addEventListener("click", (e) => {
			if (e.target === modalAbout) {
				modalAbout.style.display = "none";
			}
		});
	}

	// Global ESC key to close open modals
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			if (modalAbout && modalAbout.style.display === "flex") {
				modalAbout.style.display = "none";
			}
			const modalMeta = document.getElementById("modal-test-metadata");
			if (modalMeta && modalMeta.style.display === "flex") {
				modalMeta.style.display = "none";
			}
			const modalPost = document.getElementById("modal-post-recording");
			if (modalPost && modalPost.style.display === "flex") {
				modalPost.style.display = "none";
			}
		}
	});

	const controlsContainer = document.getElementById("controls-container");

	// --- Global Network State ---
	const networkInterfaceSelect = document.getElementById("network-interface-select");
	const btnConnect = document.getElementById("btn-network-connect");
	const btnDisconnect = document.getElementById("btn-network-disconnect");
	const btnRefresh = document.getElementById("btn-network-refresh");
	const statusText = document.getElementById("network-status-text");

	// Populate Network Interfaces
	if (networkInterfaceSelect && window.api.getNetworkInterfaces) {
		const interfaces = await window.api.getNetworkInterfaces();
		interfaces.forEach(iface => {
			const opt = document.createElement("option");
			opt.value = iface.address;
			opt.textContent = `${iface.name} - ${iface.address}`;
			networkInterfaceSelect.appendChild(opt);
		});
	}

	btnConnect.addEventListener("click", async () => {
		const interfaceIp = networkInterfaceSelect ? networkInterfaceSelect.value : null;
		if (!interfaceIp) {
			window.showStatus("Please select a network interface", true);
			return;
		}

		btnConnect.disabled = true;
		networkInterfaceSelect.disabled = true;
		statusText.textContent = "Discovering...";
		statusText.style.color = "#17a2b8"; // Info color
		
		const res = await window.api.connectAllDevices(interfaceIp);
		if (res && res.success) {
			btnConnect.style.display = "none";
			if (networkInterfaceSelect) networkInterfaceSelect.style.display = "none";
			btnDisconnect.style.display = "inline-block";
			btnRefresh.style.display = "inline-block";
			btnConnect.disabled = false;
			statusText.textContent = "Connected (Polling)";
			statusText.style.color = "#28a745"; // Green
			
			// Refresh UI tables to show newly discovered IPs
			if (typeof loadDevices === 'function') loadDevices();
			if (typeof loadMappedSignalsForCal === 'function') loadMappedSignalsForCal();
			if (typeof window.renderManualDashboard === 'function') window.renderManualDashboard();
		} else {
			statusText.textContent = res && res.error ? `Error: ${res.error}` : "Error Connecting";
			statusText.style.color = "#dc3545"; // Red
			btnConnect.disabled = false;
			networkInterfaceSelect.disabled = false;
		}
	});

	btnDisconnect.addEventListener("click", async () => {
		btnDisconnect.disabled = true;
		const res = await window.api.disconnectAllDevices();
		if (res && res.success) {
			btnDisconnect.style.display = "none";
			btnRefresh.style.display = "none";
			btnConnect.style.display = "inline-block";
			if (networkInterfaceSelect) {
				networkInterfaceSelect.style.display = "inline-block";
				networkInterfaceSelect.disabled = false;
			}
			btnDisconnect.disabled = false;
			statusText.textContent = "Disconnected";
			statusText.style.color = "#dc3545";
			
			// Refresh UI tables to show cleared IPs
			if (typeof loadDevices === 'function') loadDevices();
			if (typeof loadMappedSignalsForCal === 'function') loadMappedSignalsForCal();
			if (typeof window.renderManualDashboard === 'function') window.renderManualDashboard();
		} else {
			statusText.textContent = "Error Disconnecting";
			btnDisconnect.disabled = false;
		}
	});

	btnRefresh.addEventListener("click", async () => {
		btnRefresh.disabled = true;
		await window.api.refreshConnections();
		
		// Refresh UI tables
		if (typeof loadDevices === 'function') loadDevices();
		if (typeof loadMappedSignalsForCal === 'function') loadMappedSignalsForCal();
		if (typeof window.renderManualDashboard === 'function') window.renderManualDashboard();
		
		setTimeout(() => {
			btnRefresh.disabled = false;
		}, 1000);
	});

	// --- Live Device Status Monitoring ---
	const liveDeviceStatusContainer = document.getElementById("live-device-status");
	
	// Stream Discovery devices
	if (window.api.onDiscoveryDeviceFound) {
		window.api.onDiscoveryDeviceFound((device) => {
			if (liveDeviceStatusContainer.innerHTML.includes("No devices registered") || liveDeviceStatusContainer.innerHTML.includes("No devices discovered yet")) {
				liveDeviceStatusContainer.innerHTML = "";
			}
			const div = document.createElement("div");
			div.style.display = "flex";
			div.style.alignItems = "center";
			div.style.fontSize = "12px";
			div.style.marginRight = "10px";
			div.innerHTML = `
				<div style="width:10px; height:10px; border-radius:50%; background-color:#17a2b8; margin-right:5px;"></div>
				[Found] ${device.name} (${device.ip}:${device.port})
			`;
			liveDeviceStatusContainer.appendChild(div);
		});
	}

	if (window.api.onNetworkUpdate) {
		window.api.onNetworkUpdate((statuses) => {
			liveDeviceStatusContainer.innerHTML = "";
			if (!statuses || statuses.length === 0) {
				liveDeviceStatusContainer.innerHTML = "<span style='color:#666; font-size:12px;'>No devices registered</span>";
				return;
			}
			statuses.forEach(s => {
				const color = s.state === 'LIVE' ? "#28a745" : (s.state === 'PROBATION' ? "#ffc107" : "#dc3545");
				const age = s.lastResponseAt ? ((Date.now() - s.lastResponseAt)/1000).toFixed(1) + 's ago' : 'never';
				const details = `[${s.state}] Age: ${age} | TOs: ${s.consecutiveTimeouts} | TIDs: ${s.tidMismatches} | BO: ${s.backoffIndex}`;
				
				const label = s.error ? `Unit ${s.unitId} (${s.ip}:${s.port}) <span style="color:#dc3545;font-weight:bold;">[${s.error}]</span>` : `Unit ${s.unitId} (${s.ip}:${s.port})`;
				const div = document.createElement("div");
				div.style.display = "flex";
				div.style.alignItems = "center";
				div.style.fontSize = "12px";
				div.style.marginRight = "10px";
	               // Show details on hover instead of alert popup
				div.title = `${details} | Queue: ${s.queueDepth}`;
				div.innerHTML = `
					<div style="width:10px; height:10px; border-radius:50%; background-color:${color}; margin-right:5px;"></div>
					<span style="cursor: help; text-decoration: underline dotted;">${label}</span>
				`;
				liveDeviceStatusContainer.appendChild(div);
			});
		});
	}

	// --- Global State Polling Listener (Manual Dashboard v2) ---
	if (window.api.onStateUpdate) {
		window.api.onStateUpdate((updates) => {
			updates.forEach(({ guiId, processValue, confirmationState }) => {
				const el = document.getElementById(guiId);
				if (!el) return;

				const feedbackDot = document.getElementById(guiId.replace('do-', 'do-fb-').replace('ao-', 'ao-fb-'));

				if (guiId.startsWith('do-') || guiId.startsWith('ao-')) {
					// Update feedback dot for output controls
					if (feedbackDot) {
						feedbackDot.className = 'v2-feedback-dot'; // Reset classes
						feedbackDot.title = `State: ${confirmationState}`;
						if (confirmationState === 'PENDING') {
							feedbackDot.classList.add('pending');
						} else if (confirmationState === 'MISMATCH') {
							feedbackDot.classList.add('mismatch');
						} else if (confirmationState === 'FAULT') {
							feedbackDot.classList.add('fault');
						}
					}
				} else if (guiId.startsWith('di-')) {
					// webaudio-switch (enable=0) used as LED indicator
					el.value = processValue ? 1 : 0;
				} else if (guiId.startsWith('ai-')) {
					// webaudio-param used as read-only numeric display
					el.value = typeof processValue === 'number' ? processValue.toFixed(1) : "0.0";
				}
			});
		});
	}

	// --- Manual Dashboard v2 — directWrite event handlers ---
	// Helper to fetch the dynamic IP of a device from the database
	const getDeviceIp = async (devId) => {
		const devices = await window.api.getDevices();
		const dev = devices.find(d => d.id === devId);
		return dev ? dev.ip : null;
	};

	/* Digital output switches (webaudio-switch) — writeCoil on change */
	document.querySelectorAll('.v2-do-switch').forEach(sw => {
		sw.addEventListener('change', async (e) => {
			const dev    = parseInt(e.target.dataset.dev,  10);
			const addr   = parseInt(e.target.dataset.addr, 10);
			const val    = e.target.value;          // webaudio-switch: 0 or 1
			const prevVal = val ? 0 : 1;
			const guiId  = e.target.id;

			const ip = await getDeviceIp(dev);
			if (!ip) {
				window.showStatus(`Cannot write: Device ${dev} is not configured or offline`, true);
				if (typeof e.target.setValue === 'function') {
					e.target.setValue(prevVal, false);
				} else {
					e.target.value = prevVal;
				}
				return;
			}

			const res = await window.api.directWrite({
				ip: ip, port: 502,
				fc: 'writeCoil', address: addr, value: !!val,
				unitId: dev
			});

			if (!res || !res.success) {
				const errMsg = res && res.error ? res.error : `Device ${dev} is offline or write failed`;
				window.showStatus(`Cannot write: ${errMsg}`, true);
				if (typeof e.target.setValue === 'function') {
					e.target.setValue(prevVal, false);
				} else {
					e.target.value = prevVal;
				}
				return;
			}

			// Save desired state ONLY after successful write
			await window.api.setDesiredState(guiId, val);
		});
	});

	/* Analog output sliders (webaudio-slider) — writeRegister on change */
	document.querySelectorAll('.v2-ao-slider').forEach(slider => {
		slider.dataset.lastVal = slider.value || 0;
		slider.addEventListener('change', async (e) => {
			/* webaudio-slider fires 'change' continuously while dragging and
			 * on release. We write on every change for live feel. */
			const dev    = parseInt(e.target.dataset.dev,  10);
			const addr   = parseInt(e.target.dataset.addr, 10);
			const rawVal = Math.round(e.target.value);
			const prevVal = parseFloat(e.target.dataset.lastVal != null ? e.target.dataset.lastVal : 0);
			const guiId  = e.target.id;

			const ip = await getDeviceIp(dev);
			if (!ip) {
				window.showStatus(`Cannot write: Device ${dev} is not configured or offline`, true);
				if (typeof e.target.setValue === 'function') {
					e.target.setValue(prevVal, false);
				} else {
					e.target.value = prevVal;
				}
				e.target.dispatchEvent(new Event('input'));
				return;
			}

			const res = await window.api.directWrite({
				ip: ip, port: 502,
				fc: 'writeRegister', address: addr, value: rawVal,
				unitId: dev
			});

			if (!res || !res.success) {
				const errMsg = res && res.error ? res.error : `Device ${dev} is offline or write failed`;
				window.showStatus(`Cannot write: ${errMsg}`, true);
				if (typeof e.target.setValue === 'function') {
					e.target.setValue(prevVal, false);
				} else {
					e.target.value = prevVal;
				}
				e.target.dispatchEvent(new Event('input'));
				return;
			}

			slider.dataset.lastVal = rawVal;
			// Save desired state ONLY after successful write
			await window.api.setDesiredState(guiId, rawVal);
		});
	});

	// --- Set sprite src from preloaded data URIs (avoids Electron path issues) ---
	if (window.SWITCH_METAL_SRC) {
		document.querySelectorAll('.v2-do-switch').forEach(sw => {
			sw.src = window.SWITCH_METAL_SRC;
		});
	}

	// --- Dynamic Feedback Dot Generation ---
	// Appends a feedback dot to each output widget. The dot is absolutely
	// positioned in the top-right corner of the widget via CSS and is invisible
	// in the SYNCED state, only appearing for PENDING/MISMATCH/FAULT.
	const generateFeedbackDots = () => {
		document.querySelectorAll('.v2-do-switch, .v2-ao-slider').forEach(control => {
			const guiId = control.id;
			const fbId = guiId.replace('do-', 'do-fb-').replace('ao-', 'ao-fb-');

			const dot = document.createElement('div');
			dot.id = fbId;
			dot.className = 'v2-feedback-dot';
			dot.title = 'State: SYNCED';

			// The widget container holds the label, the control, and (for ao) the readout.
			const widget = control.closest('.v2-widget');
			if (widget) {
				widget.appendChild(dot);
			}
		});
	};
	generateFeedbackDots();

	// --- Initialize Desired States from DB ---
	const initDesiredStates = async () => {
		const states = await window.api.getDesiredStates();
		for (const [guiId, val] of Object.entries(states)) {
			const el = document.getElementById(guiId);
			if (!el) continue;

			if (guiId.startsWith('do-')) {
				// webaudio-switch: set .value (0 or 1)
				if (typeof el.setValue === 'function') el.setValue(val ? 1 : 0, false);
				else el.value = val ? 1 : 0;
			} else if (guiId.startsWith('ao-')) {
				// webaudio-slider: set .value directly
				el.dataset.lastVal = val;
				if (typeof el.setValue === 'function') el.setValue(val, false);
				else el.value = val;
				el.dispatchEvent(new Event('input'));
			}
		}
	};
	initDesiredStates();

	// --- 1. Manual Dashboard Logic (v1 — hidden) ---
	const canvasContainer = document.getElementById("canvas-container");

	let isDragging = false;
	let currentWidget = null;
	let offsetX = 0, offsetY = 0;

	// Drag events - DISABLED
	/*
	canvasContainer.addEventListener("mousedown", (e) => {
		const widget = e.target.closest('.canvas-widget');
		if (widget && !e.target.closest('button') && !e.target.closest('input')) {
			isDragging = true;
			currentWidget = widget;
			offsetX = e.clientX - widget.offsetLeft;
			offsetY = e.clientY - widget.offsetTop;
		}
	});

	document.addEventListener("mousemove", (e) => {
		if (isDragging && currentWidget) {
			let newX = e.clientX - offsetX;
			let newY = e.clientY - offsetY;
			
			// Constrain to canvas
			newX = Math.max(0, Math.min(newX, canvasContainer.clientWidth - currentWidget.offsetWidth));
			newY = Math.max(0, Math.min(newY, canvasContainer.clientHeight - currentWidget.offsetHeight));

			currentWidget.style.left = newX + "px";
			currentWidget.style.top = newY + "px";
		}
	});

	document.addEventListener("mouseup", async () => {
		if (isDragging && currentWidget) {
			const sigId = currentWidget.dataset.id;
			const x = parseInt(currentWidget.style.left, 10) || 0;
			const y = parseInt(currentWidget.style.top, 10) || 0;
			
			// Save layout
			await window.api.saveLayoutPosition({ signal_id: parseInt(sigId, 10), pos_x: x, pos_y: y });
		}
		isDragging = false;
		currentWidget = null;
	});
	*/

	window.renderManualDashboard = async () => {
		const signals = await window.api.getMappedSignals();
		const layout = await window.api.getLayout();

		canvasContainer.innerHTML = "";
		
		let manual_dashboard_max_elements_horz = Math.floor(canvasContainer.clientWidth / 90) || 10;
		if (manual_dashboard_max_elements_horz < 1) manual_dashboard_max_elements_horz = 1;

		for (let i = 0; i < signals.length; i++) {
			const signal = signals[i];
			
			/*
			 * The old condition rejected (0,0) as "uninitialized" because it was falsy.
			 * A saved position is valid as long as the database row exists (pos != null).
			 * Only fall back to the auto-grid when no DB row is present.
			 */
			let pos = layout.find(l => l.signal_id === signal.id);
			if (!pos) {
				pos = { pos_x: 10 + (i % manual_dashboard_max_elements_horz) * 105, pos_y: 10 + parseInt(i / manual_dashboard_max_elements_horz) * 75 };
			}

			const div = document.createElement("div");
			div.className = "canvas-widget";
			div.dataset.id = signal.id;
			div.style.left = pos.pos_x + "px";
			div.style.top = pos.pos_y + "px";

			const label = document.createElement("div");
			label.className = "widget-label";
			label.textContent = signal.label;
			div.appendChild(label);

			// SVG Sprites / HTML based on type
			if (signal.type === "analog-in") {
				// Number Read
				const display = document.createElement("div");
				display.className = "number-display";
				display.id = `ui-val-${signal.id}`;
				display.textContent = "0.00";
				div.appendChild(display);
			} 
			else if (signal.type === "analog-out") {
				// Number Write
				const input = document.createElement("input");
				input.type = "number";
				input.className = "number-display";
				input.style.width = "100%";
				input.id = `ui-write-${signal.id}`;
				input.value = "0.00";
				
				const btn = document.createElement("button");
				btn.textContent = "SET";
				btn.style.marginTop = "2px";
				btn.style.fontSize = "10px";
				btn.style.padding = "1px 4px";
				btn.onclick = () => window.api.modbusPreemptWrite(signal.id, parseFloat(input.value));

				div.appendChild(input);
				div.appendChild(btn);
			}
			else if (signal.type === "digital-in") {
				// Digital Read (LED)
				const led = document.createElement("div");
				led.className = "svg-led led-off";
				led.id = `ui-val-${signal.id}`;
				div.appendChild(led);
			}
			else if (signal.type === "digital-out") {
				// Digital Write (Toggle)
				const toggle = document.createElement("input");
				toggle.type = "checkbox";
				toggle.style.transform = "scale(1.2)";
				toggle.style.margin = "5px";
				toggle.id = `ui-write-${signal.id}`;
				toggle.onchange = async (e) => {
					const newVal = e.target.checked ? 1 : 0;
					const prevVal = newVal === 1 ? 0 : 1;
					const res = await window.api.modbusPreemptWrite(signal.id, newVal);
					if (res && !res.success) {
						// Revert checkbox to previous state on failure
						e.target.checked = prevVal === 1;
					}
				};
				div.appendChild(toggle);
			}

			canvasContainer.appendChild(div);
		}
	};
	renderManualDashboard();
	
	document.getElementById("btn-refresh-layout").addEventListener("click", renderManualDashboard);

	// --- Test Provenance Metadata Modal Handling ---
	const modalMetadata = document.getElementById("modal-test-metadata");
	const inputMpcsSerial = document.getElementById("input-mpcs-serial");
	const inputLocoNumber = document.getElementById("input-loco-number");
	const inputTestedBy = document.getElementById("input-tested-by");
	const inputTesterId = document.getElementById("input-tester-id");
	const btnModalCancel = document.getElementById("btn-modal-cancel");
	const btnModalProceed = document.getElementById("btn-modal-proceed");

	let onMetadataConfirmedCallback = null;

	const openMetadataModal = async (callback) => {
		onMetadataConfirmedCallback = callback;
		if (window.api && window.api.getTestMetadata) {
			const meta = await window.api.getTestMetadata();
			if (meta) {
				inputMpcsSerial.value = meta.mpcs_serial_number || "";
				inputLocoNumber.value = meta.loco_number || "";
				inputTestedBy.value = meta.tested_by || "";
				inputTesterId.value = meta.tester_id || "";
			}
		}
		modalMetadata.style.display = "flex";
		inputMpcsSerial.focus();
	};

	const closeMetadataModal = () => {
		modalMetadata.style.display = "none";
		onMetadataConfirmedCallback = null;
	};

	btnModalCancel.addEventListener("click", closeMetadataModal);

	btnModalProceed.addEventListener("click", async () => {
		const mpcs_serial_number = inputMpcsSerial.value.trim();
		const loco_number = inputLocoNumber.value.trim();
		const tested_by = inputTestedBy.value.trim();
		const tester_id = inputTesterId.value.trim();

		if (!mpcs_serial_number || !loco_number || !tested_by || !tester_id) {
			alert("Please fill in all 4 test metadata fields before proceeding.");
			return;
		}

		const metadata = { mpcs_serial_number, loco_number, tested_by, tester_id };
		if (window.api && window.api.saveTestMetadata) {
			await window.api.saveTestMetadata(metadata);
		}

		modalMetadata.style.display = "none";
		if (typeof onMetadataConfirmedCallback === "function") {
			const cb = onMetadataConfirmedCallback;
			onMetadataConfirmedCallback = null;
			cb(metadata);
		}
	});

	// --- 1 Hz Recording Session Controls ---
	const btnStartRecord = document.getElementById("btn-start-record");
	const btnStopRecord = document.getElementById("btn-stop-record");
	const recordingBanner = document.getElementById("recording-live-banner");
	const recordingTimerEl = document.getElementById("recording-timer");
	const recordingSampleCountEl = document.getElementById("recording-sample-count");

	const modalPostRec = document.getElementById("modal-post-recording");
	const postRecSummaryText = document.getElementById("post-rec-summary-text");
	const postRecMpcs = document.getElementById("post-rec-mpcs");
	const postRecLoco = document.getElementById("post-rec-loco");
	const postRecTester = document.getElementById("post-rec-tester");
	const postRecSamples = document.getElementById("post-rec-samples");
	const btnExportSessionExcel = document.getElementById("btn-export-session-excel");
	const btnCloseExportModal = document.getElementById("btn-close-export-modal");

	let currentExportSession = null;

	if (btnStartRecord) {
		btnStartRecord.addEventListener("click", () => {
			openMetadataModal(async (metadata) => {
				const res = await window.api.startRecordingSession(metadata);
				if (res && res.success) {
					btnStartRecord.style.display = "none";
					btnStopRecord.style.display = "inline-block";
					recordingBanner.style.display = "inline-flex";
					recordingTimerEl.textContent = "00:00:00";
					recordingSampleCountEl.textContent = "(1 sample)";
					window.showStatus("1 Hz recording session started — logging to SQLite database");
				} else {
					window.showStatus(res && res.error ? `Error: ${res.error}` : "Failed to start recording", true);
				}
			});
		});
	}

	if (window.api && window.api.onRecordingTick) {
		window.api.onRecordingTick(({ sampleCount, elapsedSeconds }) => {
			if (recordingTimerEl && window.DashboardExporter) {
				recordingTimerEl.textContent = window.DashboardExporter.formatDuration(elapsedSeconds);
			}
			if (recordingSampleCountEl) {
				recordingSampleCountEl.textContent = `(${sampleCount} sample${sampleCount === 1 ? '' : 's'})`;
			}
		});
	}

	if (btnStopRecord) {
		btnStopRecord.addEventListener("click", async () => {
			const res = await window.api.stopRecordingSession();
			if (res && res.success && res.session) {
				btnStopRecord.style.display = "none";
				recordingBanner.style.display = "none";
				btnStartRecord.style.display = "inline-block";

				currentExportSession = res.session;
				const sampleCount = (res.session.samples && res.session.samples.length) || res.session.total_samples || 0;
				const duration = window.DashboardExporter ? window.DashboardExporter.formatDuration(sampleCount) : `${sampleCount}s`;

				postRecSummaryText.textContent = `${sampleCount} samples recorded (${duration})`;
				postRecMpcs.textContent = res.session.mpcs_serial_number || "N/A";
				postRecLoco.textContent = res.session.loco_number || "N/A";
				postRecTester.textContent = `${res.session.tested_by || 'N/A'} (${res.session.tester_id || 'N/A'})`;
				postRecSamples.textContent = `${sampleCount} samples @ 1 Hz`;

				modalPostRec.style.display = "flex";
				window.showStatus(`Recording stopped. Total ${sampleCount} samples recorded.`);
			} else {
				window.showStatus(res && res.error ? `Error: ${res.error}` : "Failed to stop recording", true);
			}
		});
	}

	if (btnCloseExportModal) {
		btnCloseExportModal.addEventListener("click", () => {
			modalPostRec.style.display = "none";
		});
	}

	if (btnExportSessionExcel) {
		btnExportSessionExcel.addEventListener("click", async () => {
			if (!currentExportSession) return;
			const exportFn = (window.electronAPI && window.electronAPI.exportExcel) ||
				(window.api && window.api.saveDashboardDataAsExcel) ||
				(window.api && window.api.exportExcel);

			if (!exportFn) {
				window.showStatus("Excel export API is unavailable", true);
				return;
			}

			const res = await exportFn({
				metadata: currentExportSession,
				sessionInfo: currentExportSession,
				samples: currentExportSession.samples
			});

			if (res && res.success) {
				window.showStatus(`Excel report saved successfully to ${res.fileName}`);
			} else if (res && res.canceled) {
				window.showStatus("Save cancelled");
			} else {
				window.showStatus(res && res.error ? `Error: ${res.error}` : "Failed to save Excel workbook", true);
			}
		});
	}

	// --- Instantaneous Snapshot Export Controls ---
	const btnSaveExcel = document.getElementById("btn-save-excel");
	if (btnSaveExcel) {
		btnSaveExcel.addEventListener("click", () => {
			openMetadataModal(async (metadata) => {
				const devices = await window.api.getDevices();
				const snapshot = window.DashboardExporter.extractManualDashboardData(document, devices, metadata);

				const exportFn = (window.electronAPI && window.electronAPI.exportExcel) ||
					(window.api && window.api.saveDashboardDataAsExcel) ||
					(window.api && window.api.exportExcel);

				if (!exportFn) {
					window.showStatus("Excel export API is unavailable", true);
					return;
				}

				const res = await exportFn({
					metadata,
					snapshot
				});

				if (res && res.success) {
					window.showStatus(`Snapshot Excel workbook saved to ${res.fileName}`);
				} else if (res && res.canceled) {
					window.showStatus("Save cancelled");
				} else {
					window.showStatus(res && res.error ? `Error: ${res.error}` : "Failed to save Excel workbook", true);
				}
			});
		});
	}

	const btnResetDesired = document.getElementById("btn-reset-desired");
	if (btnResetDesired) {
		btnResetDesired.addEventListener("click", async () => {
			if (confirm("Reset all manual controls to default (0/Off)?")) {
				await window.api.resetAllDesiredStates();

				// Zero-out the UI elements immediately and set all feedback dots to PENDING.
				for (const sw of document.querySelectorAll('.v2-do-switch')) {
					await new Promise(resolve => setTimeout(resolve, 10));
					if (typeof sw.setValue === 'function') sw.setValue(0, false);
					else sw.value = 0;
					const feedbackDot = document.getElementById(sw.id.replace('do-', 'do-fb-'));
					if (feedbackDot) {
						feedbackDot.className = 'v2-feedback-dot pending';
						feedbackDot.title = 'State: PENDING';
					}
				}
				document.querySelectorAll('.v2-ao-slider').forEach(slider => {
					slider.dataset.lastVal = 0;
					if (typeof slider.setValue === 'function') slider.setValue(0, false);
					else slider.value = 0;
					slider.dispatchEvent(new Event('input'));
					const feedbackDot = document.getElementById(slider.id.replace('ao-', 'ao-fb-'));
					if (feedbackDot) {
						feedbackDot.className = 'v2-feedback-dot pending';
						feedbackDot.title = 'State: PENDING';
					}
				});

				window.showStatus("All states reset to default. Hardware will de-energize on the next polling tick.");
			}
		});
	}

	// --- Manual Dashboard V2 / V3 Signal Label Version Toggle ---
	function applySignalLabelVersion(version) {
		const activeVersion = String(version).toLowerCase() === "v2" ? "v2" : "v3";
		try {
			localStorage.setItem("manual_dashboard_label_version", activeVersion);
		} catch (e) {
			console.warn("Failed to save manual_dashboard_label_version to localStorage:", e);
		}

		const btnV2 = document.getElementById("btn-label-v2");
		const btnV3 = document.getElementById("btn-label-v3");
		if (btnV2 && btnV3) {
			if (activeVersion === "v2") {
				btnV2.classList.add("active");
				btnV3.classList.remove("active");
			} else {
				btnV3.classList.add("active");
				btnV2.classList.remove("active");
			}
		}

		const resolver = window.resolveSignalLabel || (typeof resolveSignalLabel === "function" ? resolveSignalLabel : null);
		if (resolver) {
			const labels = document.querySelectorAll(".v2-widget-label");
			labels.forEach((el) => {
				let sigId = el.getAttribute("data-signal");
				if (!sigId) {
					const match = el.textContent.match(/\(([IO]-\d+)\)/);
					if (match) {
						sigId = match[1];
						el.setAttribute("data-signal", sigId);
					}
				}
				if (sigId) {
					el.innerHTML = resolver(sigId, activeVersion);
				}
			});
		}
	}

	window.applySignalLabelVersion = applySignalLabelVersion;

	const btnLabelV2 = document.getElementById("btn-label-v2");
	if (btnLabelV2) {
		btnLabelV2.addEventListener("click", () => {
			applySignalLabelVersion("v2");
		});
	}

	const btnLabelV3 = document.getElementById("btn-label-v3");
	if (btnLabelV3) {
		btnLabelV3.addEventListener("click", () => {
			applySignalLabelVersion("v3");
		});
	}

	// --- Action Sequence Dashboard Controller ---
	const seqSelect = document.getElementById("seq-select");
	const btnStartSeq = document.getElementById("btn-start-seq");
	const btnStopSeq = document.getElementById("btn-stop-seq");
	const chkDebugFreeze = document.getElementById("chk-debug-freeze");
	const seqVerdictBadge = document.getElementById("seq-verdict-badge");
	const seqStatusText = document.getElementById("seq-status-text");
	const seqProgressBar = document.getElementById("seq-progress-bar");
	const seqStepCountLbl = document.getElementById("seq-step-count-lbl");
	const seqWatchdogInd = document.getElementById("seq-watchdog-indicator");
	const seqWatchdogText = document.getElementById("seq-watchdog-text");
	const seqDescLbl = document.getElementById("seq-desc-lbl");
	const seqElapsedTime = document.getElementById("seq-elapsed-time");
	const seqStepsTbody = document.getElementById("seq-steps-tbody");
	const seqLogBox = document.getElementById("seq-log-box");
	const btnClearSeqLog = document.getElementById("btn-clear-seq-log");
	const btnExportSeqExcel = document.getElementById("btn-export-seq-excel");
	const seqHistoryTbody = document.getElementById("seq-history-tbody");
	const btnRefreshHistory = document.getElementById("btn-refresh-history");
	const seqActiveBadge = document.getElementById("seq-active-badge");

	let activeSeqTimer = null;
	let seqStartTime = null;
	let lastFinishedRunId = null;

	const formatSeqMs = (ms) => {
		const totalSec = Math.floor(ms / 1000);
		const mins = String(Math.floor(totalSec / 60)).padStart(2, "0");
		const secs = String(totalSec % 60).padStart(2, "0");
		const tenths = Math.floor((ms % 1000) / 100);
		return `${mins}:${secs}.${tenths}`;
	};

	const appendSeqLog = (msg) => {
		if (!seqLogBox) return;
		const line = document.createElement("div");
		line.textContent = msg;
		seqLogBox.appendChild(line);
		seqLogBox.scrollTop = seqLogBox.scrollHeight;
	};

	const loadSequencesDropdown = async () => {
		if (!seqSelect || !window.api || !window.api.listSequences) return;
		try {
			const list = await window.api.listSequences();
			seqSelect.innerHTML = "";

			const masterGroup = document.createElement("optgroup");
			masterGroup.label = "Master Commissioning Suite";

			const opGroup = document.createElement("optgroup");
			opGroup.label = "Subsystem Operational Tests (Positive)";

			const faultGroup = document.createElement("optgroup");
			faultGroup.label = "Fault Injection & Protection (Negative)";

			list.forEach((item) => {
				const opt = document.createElement("option");
				opt.value = item.id;
				opt.textContent = `${item.id}: ${item.name}`;
				opt.dataset.desc = item.description || "";
				opt.dataset.steps = item.stepCount;

				if (item.id === "TS-00") {
					masterGroup.appendChild(opt);
				} else if (item.type === "negative") {
					faultGroup.appendChild(opt);
				} else {
					opGroup.appendChild(opt);
				}
			});

			if (masterGroup.children.length > 0) seqSelect.appendChild(masterGroup);
			if (opGroup.children.length > 0) seqSelect.appendChild(opGroup);
			if (faultGroup.children.length > 0) seqSelect.appendChild(faultGroup);

			onSequenceSelectionChanged();
		} catch (err) {
			console.error("Failed to load sequence list:", err);
		}
	};

	const onSequenceSelectionChanged = async () => {
		if (!seqSelect || !window.api || !window.api.getSequence) return;
		const id = seqSelect.value;
		if (!id) return;

		try {
			const seq = await window.api.getSequence(id);
			if (!seq) return;

			if (seqDescLbl) {
				seqDescLbl.textContent = seq.description || seq.name;
			}
			if (seqStepCountLbl) {
				seqStepCountLbl.textContent = `Steps: 0 / ${seq.steps ? seq.steps.length : 1}`;
			}

			// Render steps table in ready state
			if (seqStepsTbody) {
				seqStepsTbody.innerHTML = "";
				const steps = seq.steps || [{ name: seq.name }];
				steps.forEach((st, idx) => {
					const tr = document.createElement("tr");
					tr.id = `seq-step-row-${idx}`;
					tr.style.borderBottom = "1px solid #f1f5f9";
					tr.innerHTML = `
						<td style="padding: 6px 8px; color: #64748b; font-weight: bold;">${idx + 1}</td>
						<td style="padding: 6px 8px; font-weight: 500; color: #1e293b;">${st.name}</td>
						<td style="padding: 6px 8px; text-align: center; color: #64748b; font-family: monospace;" id="seq-step-time-${idx}">-</td>
						<td style="padding: 6px 8px; text-align: center;" id="seq-step-badge-${idx}">
							<span style="background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">READY</span>
						</td>
					`;
					seqStepsTbody.appendChild(tr);
				});
			}

			// Reset verdict badge
			if (seqVerdictBadge) {
				seqVerdictBadge.textContent = "STANDBY";
				seqVerdictBadge.style.backgroundColor = "#64748b";
			}
			if (seqStatusText) {
				seqStatusText.textContent = `Ready to execute "${seq.name}". Click Run Sequence.`;
			}
			if (seqProgressBar) seqProgressBar.style.width = "0%";
			if (btnExportSeqExcel) btnExportSeqExcel.style.display = "none";
		} catch (err) {
			console.error("Failed to load sequence details:", err);
		}
	};

	const loadSequenceHistory = async () => {
		if (!seqHistoryTbody || !window.api || !window.api.getSequenceHistory) return;
		try {
			const runs = await window.api.getSequenceHistory(20);
			seqHistoryTbody.innerHTML = "";
			if (!runs || runs.length === 0) {
				seqHistoryTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 18px;">No test history recorded yet</td></tr>`;
				return;
			}

			runs.forEach((r) => {
				const tr = document.createElement("tr");
				tr.style.borderBottom = "1px solid #f1f5f9";
				const statusColor = r.status === "PASS" ? "#16a34a" : r.status === "FAIL" ? "#dc2626" : "#f59e0b";
				const statusBg = r.status === "PASS" ? "#dcfce7" : r.status === "FAIL" ? "#fee2e2" : "#fef3c7";
				const dateStr = r.started_at ? r.started_at.replace("T", " ").substring(0, 19) : "-";
				const durStr = r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "-";

				tr.innerHTML = `
					<td style="padding: 6px 8px; font-weight: bold; color: #64748b;">#${r.id}</td>
					<td style="padding: 6px 8px; font-weight: 500; color: #0f172a;">${r.sequence_name} (${r.sequence_id})</td>
					<td style="padding: 6px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569;">${r.test_type}</td>
					<td style="padding: 6px 8px; text-align: center;">
						<span style="background: ${statusBg}; color: ${statusColor}; font-weight: bold; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${r.status}</span>
					</td>
					<td style="padding: 6px 8px; font-family: monospace; font-size: 11px; color: #475569;">${dateStr}</td>
					<td style="padding: 6px 8px; text-align: center; font-family: monospace;">${durStr}</td>
					<td style="padding: 6px 8px; text-align: center; color: #64748b;">${r.passed_steps || 0}/${r.total_steps || 0}</td>
				`;
				seqHistoryTbody.appendChild(tr);
			});
		} catch (err) {
			console.error("Failed to load sequence history:", err);
		}
	};

	if (seqSelect) {
		seqSelect.addEventListener("change", onSequenceSelectionChanged);
	}

	if (btnStartSeq) {
		btnStartSeq.addEventListener("click", async () => {
			const seqId = seqSelect ? seqSelect.value : null;
			if (!seqId) {
				alert("Please select a sequence to run.");
				return;
			}
			const debugFreeze = chkDebugFreeze ? chkDebugFreeze.checked : false;

			btnStartSeq.style.display = "none";
			if (btnStopSeq) btnStopSeq.style.display = "inline-flex";
			if (seqActiveBadge) seqActiveBadge.style.display = "inline-block";
			if (btnExportSeqExcel) btnExportSeqExcel.style.display = "none";

			seqStartTime = Date.now();
			if (activeSeqTimer) clearInterval(activeSeqTimer);
			activeSeqTimer = setInterval(() => {
				if (seqElapsedTime && seqStartTime) {
					seqElapsedTime.textContent = formatSeqMs(Date.now() - seqStartTime);
				}
			}, 100);

			appendSeqLog(`=== STARTING SEQUENCE: ${seqId} ===`);
			try {
				await window.api.startSequence(seqId, { debugFreezeOnFailure: debugFreeze });
			} catch (err) {
				appendSeqLog(`[ERROR] ${err.message}`);
			}
		});
	}

	if (btnStopSeq) {
		btnStopSeq.addEventListener("click", async () => {
			appendSeqLog(">>> OPERATOR PRESSED EMERGENCY STOP / ABORT <<<");
			await window.api.stopSequence();
		});
	}

	if (btnClearSeqLog) {
		btnClearSeqLog.addEventListener("click", () => {
			if (seqLogBox) seqLogBox.innerHTML = "";
		});
	}

	if (btnRefreshHistory) {
		btnRefreshHistory.addEventListener("click", loadSequenceHistory);
	}

	// Register IPC Event Listeners
	if (window.api && window.api.onSequenceStarted) {
		window.api.onSequenceStarted((data) => {
			if (seqVerdictBadge) {
				seqVerdictBadge.textContent = "RUNNING";
				seqVerdictBadge.style.backgroundColor = "#0284c7";
			}
			if (seqStatusText) {
				seqStatusText.textContent = `Running ${data.sequenceName}...`;
			}
		});
	}

	if (window.api && window.api.onSequenceStepUpdate) {
		window.api.onSequenceStepUpdate((data) => {
			const { stepIndex, totalSteps, stepName, status, durationMs, error } = data;
			if (seqStepCountLbl) {
				seqStepCountLbl.textContent = `Step: ${stepIndex + 1} / ${totalSteps}`;
			}
			if (seqProgressBar && totalSteps > 0) {
				const pct = Math.round(((stepIndex + (status === "PASS" ? 1 : 0.5)) / totalSteps) * 100);
				seqProgressBar.style.width = `${pct}%`;
			}

			const badgeEl = document.getElementById(`seq-step-badge-${stepIndex}`);
			const timeEl = document.getElementById(`seq-step-time-${stepIndex}`);
			const rowEl = document.getElementById(`seq-step-row-${stepIndex}`);

			if (rowEl) {
				if (status === "RUNNING") {
					rowEl.style.backgroundColor = "#fef9c3";
				} else if (status === "PASS") {
					rowEl.style.backgroundColor = "#f0fdf4";
				} else if (status === "FAIL") {
					rowEl.style.backgroundColor = "#fef2f2";
				}
			}

			if (timeEl && durationMs != null) {
				timeEl.textContent = `${durationMs}ms`;
			}

			if (badgeEl) {
				if (status === "RUNNING") {
					badgeEl.innerHTML = `<span style="background: #fef08a; color: #854d0e; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">RUNNING</span>`;
				} else if (status === "PASS") {
					badgeEl.innerHTML = `<span style="background: #bbf7d0; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">PASS</span>`;
				} else if (status === "FAIL") {
					badgeEl.innerHTML = `<span style="background: #fecaca; color: #991b1b; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;" title="${error || ''}">FAIL</span>`;
				}
			}
		});
	}

	if (window.api && window.api.onSequenceStepProgress) {
		window.api.onSequenceStepProgress((data) => {
			if (seqWatchdogInd && seqWatchdogText) {
				seqWatchdogInd.style.display = "inline";
				const remaining = Math.max(0, data.timeoutMs - data.elapsed);
				seqWatchdogText.textContent = `${data.signalTag} == ${data.expectedValue} (${(remaining / 1000).toFixed(1)}s left)`;
			}
		});
	}

	if (window.api && window.api.onSequenceLog) {
		window.api.onSequenceLog((data) => {
			appendSeqLog(data.message);
		});
	}

	if (window.api && window.api.onSequenceFinished) {
		window.api.onSequenceFinished((data) => {
			if (activeSeqTimer) clearInterval(activeSeqTimer);
			if (btnStartSeq) btnStartSeq.style.display = "inline-flex";
			if (btnStopSeq) btnStopSeq.style.display = "none";
			if (seqActiveBadge) seqActiveBadge.style.display = "none";
			if (seqWatchdogInd) seqWatchdogInd.style.display = "none";

			lastFinishedRunId = data.runId;

			if (seqVerdictBadge) {
				seqVerdictBadge.textContent = data.status;
				seqVerdictBadge.style.backgroundColor =
					data.status === "PASS" ? "#16a34a" : data.status === "FAIL" ? "#dc2626" : "#f59e0b";
			}

			if (seqStatusText) {
				if (data.status === "PASS") {
					seqStatusText.textContent = `Completed Successfully! All ${data.passedSteps}/${data.totalSteps} steps passed (${(data.durationMs / 1000).toFixed(1)}s).`;
				} else if (data.status === "FAIL") {
					seqStatusText.textContent = `Test FAILED: ${data.failureReason || "Assertion failure"} (${(data.durationMs / 1000).toFixed(1)}s).`;
				} else {
					seqStatusText.textContent = `Test Aborted by Operator (${(data.durationMs / 1000).toFixed(1)}s).`;
				}
			}

			if (btnExportSeqExcel) {
				btnExportSeqExcel.style.display = "inline-flex";
			}

			loadSequenceHistory();
		});
	}

	if (btnExportSeqExcel) {
		btnExportSeqExcel.addEventListener("click", async () => {
			if (!lastFinishedRunId) {
				alert("No test run available to export.");
				return;
			}
			btnExportSeqExcel.disabled = true;
			btnExportSeqExcel.textContent = "Generating Certificate...";
			try {
				const res = await window.api.exportSequenceCertificate(lastFinishedRunId);
				if (res && res.success) {
					window.showStatus(`Test certificate exported: ${res.filePath}`);
				} else if (res && !res.canceled) {
					window.showStatus(`Export failed: ${res.error}`, true);
				}
			} catch (err) {
				window.showStatus(`Export error: ${err.message}`, true);
			} finally {
				btnExportSeqExcel.disabled = false;
				btnExportSeqExcel.textContent = "📊 Export Test Certificate (.xlsx)";
			}
		});
	}

	// Trigger initial sequence dropdown & history load
	loadSequencesDropdown();
	loadSequenceHistory();

	// --- Raw Registers Explorer Logic ---
	let currentRawDevIp = "";
	let currentRawDevPort = 0;

	window.selectDeviceForRaw = async (id, name, ip, port) => {
		document.getElementById("raw-dev-id").value = id;
		document.getElementById("raw-active-dev").textContent = `${name} (${ip}:${port})`;
		currentRawDevIp = ip;
		currentRawDevPort = port;
		await loadRawRegisters(id);
	};

	const loadRawRegisters = async (deviceId) => {
		const regs = await window.api.getDeviceRegisters(deviceId);
		const tbody = document.getElementById("raw-reg-list");
		tbody.innerHTML = "";
		
		regs.forEach(r => {
			const tr = document.createElement("tr");
			tr.innerHTML = `
				<td>${r.type}</td>
				<td>${r.address}</td>
				<td>${r.description}</td>
				<td id="raw-val-${r.id}">--</td>
				<td>
					${(r.type === 'coil' || r.type === 'holding') ? `<input type="text" id="raw-input-${r.id}" style="width:50px" placeholder="val"/> <button onclick="writeRawRegister(${r.id}, '${r.type}', ${r.address})">W</button>` : 'ReadOnly'}
				</td>
				<td>
					<button onclick="readRawRegister(${r.id}, '${r.type}', ${r.address})">Read</button>
					<button onclick="editRawRegister(${r.id}, '${r.type}', ${r.address}, '${r.description}')">Edit</button>
					<button onclick="deleteRawRegister(${r.id})">Del</button>
				</td>
			`;
			tr.addEventListener("click", () => {
				document.querySelectorAll("#raw-reg-list tr.selected").forEach(el => el.classList.remove("selected"));
				tr.classList.add("selected");
			});
			tbody.appendChild(tr);
		});
	};

	window.readRawRegister = async (regId, type, address) => {
		if(!currentRawDevIp) return window.showStatus("Select device first");
		const res = await window.api.readRawRegister({
			deviceIp: currentRawDevIp, port: currentRawDevPort, address, type
		});
		if(res.success) {
			document.getElementById(`raw-val-${regId}`).textContent = res.value;
		} else {
			window.showStatus("Read Error: " + res.error, true);
		}
	};

	window.writeRawRegister = async (regId, type, address) => {
		if(!currentRawDevIp) return window.showStatus("Select device first");
		const valStr = document.getElementById(`raw-input-${regId}`).value;
		if(!valStr) return window.showStatus("Enter value to write");
		
		const res = await window.api.writeRegister({
			deviceIp: currentRawDevIp, port: currentRawDevPort, address, value: parseFloat(valStr), type
		});
		if(res.success) window.showStatus("Write successful");
		else window.showStatus("Write Error: " + res.error, true);
	};

	window.editRawRegister = (id, type, address, desc) => {
		document.getElementById("raw-reg-id").value = id;
		document.getElementById("raw-reg-type").value = type;
		document.getElementById("raw-reg-addr").value = address;
		document.getElementById("raw-reg-desc").value = desc;
	};

	window.deleteRawRegister = async (id) => {
		if(confirm("Delete register?")) {
			const devId = parseInt(document.getElementById("raw-dev-id").value, 10);
			await window.api.deleteDeviceRegister(id);
			if(devId) loadRawRegisters(devId);
		}
	};

	document.getElementById("btn-save-raw-reg").addEventListener("click", async () => {
		const devId = parseInt(document.getElementById("raw-dev-id").value, 10);
		if(!devId) return window.showStatus("Select a device from the left panel first.");

		const id = document.getElementById("raw-reg-id").value;
		const address = parseInt(document.getElementById("raw-reg-addr").value, 10);

		if (isNaN(address) || address < 0 || address > 49999) return window.showStatus("Protocol Address must be between 0 and 49999.");

		const reg = {
			device_id: devId,
			type: document.getElementById("raw-reg-type").value,
			address,
			description: document.getElementById("raw-reg-desc").value
		};

		let res = id ? await window.api.updateDeviceRegister({ ...reg, id }) : await window.api.addDeviceRegister(reg);
		
		if(res.success) {
			document.getElementById("btn-clear-raw-reg").click();
			loadRawRegisters(devId);
		} else {
			window.showStatus("Error saving: " + res.error, true);
		}
	});

	document.getElementById("btn-clear-raw-reg").addEventListener("click", () => {
		document.getElementById("raw-reg-id").value = "";
		document.getElementById("raw-reg-addr").value = "";
		document.getElementById("raw-reg-desc").value = "";
	});

	// --- Device Registry Logic ---
	const loadDevices = async () => {
		const devices = await window.api.getDevices();
		
		const tbody = document.getElementById("device-list");
		tbody.innerHTML = "";
		
		const ulRaw = document.getElementById("raw-dev-list");
		ulRaw.innerHTML = "";

		const sigDeviceSelect = document.getElementById("cal-sig-device");
		sigDeviceSelect.innerHTML = '<option value="">Select Device...</option>';

		devices.forEach((dev) => {
			// Main device table
			const tr = document.createElement("tr");
			tr.innerHTML = `
				<td>${dev.id}</td>
				<td>${dev.display_name}</td>
				<td>${dev.ip}</td>
				<td>${dev.port}</td>
				<td>
					<button class="action-btn" onclick="editDevice(${dev.id}, '${dev.display_name}', '${dev.ip}', ${dev.port}, ${dev.key1}, ${dev.key2})">Edit</button>
					<button class="action-btn" onclick="deleteDevice(${dev.id})">Delete</button>
				</td>
			`;
			tr.addEventListener("click", () => {
				document.querySelectorAll("#device-list tr.selected").forEach(el => el.classList.remove("selected"));
				tr.classList.add("selected");
			});
			tbody.appendChild(tr);

			// Raw Registers Selection List
			const li = document.createElement("li");
			li.style.marginBottom = "8px";
			li.innerHTML = `
				${dev.display_name} 
				<button class="action-btn" onclick="selectDeviceForRaw(${dev.id}, '${dev.display_name}', '${dev.ip}', ${dev.port})">Select</button>
			`;
			ulRaw.appendChild(li);

			// Populate Signal Mapping Device Dropdown
			const opt = document.createElement("option");
			opt.value = dev.id;
			opt.textContent = `${dev.display_name} (${dev.ip})`;
			document.getElementById("cal-sig-device").appendChild(opt);
		});
	};

	window.editDevice = (id, name, ip, port, key1, key2) => {
		document.getElementById("dev-id").value = id;
		document.getElementById("dev-name").value = name;
		document.getElementById("dev-ip").value = ip;
		document.getElementById("dev-port").value = port;
		document.getElementById("dev-key1").value = key1 != null ? "0x" + key1.toString(16).toUpperCase() : "";
		document.getElementById("dev-key2").value = key2 != null ? "0x" + key2.toString(16).toUpperCase() : "";
		document.getElementById("device-registry").style.display = "block";
	};

	window.deleteDevice = async (id) => {
		if (confirm("Are you sure you want to delete this device?")) {
			const res = await window.api.deleteDevice(id);
			if (res.success) loadDevices();
			else window.showStatus("Error deleting device: " + res.error, true);
		}
	};

	document.getElementById("btn-save-device").addEventListener("click", async () => {
		const id = document.getElementById("dev-id").value;
		const name = document.getElementById("dev-name").value;
		const ip = document.getElementById("dev-ip").value;
		const port = parseInt(document.getElementById("dev-port").value, 10);
		const key1Val = document.getElementById("dev-key1").value;
		const key2Val = document.getElementById("dev-key2").value;
		const key1 = key1Val ? parseInt(key1Val, 16) : NaN;
		const key2 = key2Val ? parseInt(key2Val, 16) : NaN;

		if (!isNaN(key1) && (key1 < 0 || key1 > 65535)) return window.showStatus("Key 1 Value must be a valid 16-bit hex value.");
		if (!isNaN(key2) && (key2 < 0 || key2 > 65535)) return window.showStatus("Key 2 Value must be a valid 16-bit hex value.");

		const device = { display_name: name, ip, port, key1: isNaN(key1) ? null : key1, key2: isNaN(key2) ? null : key2 };

		let res = id ? await window.api.updateDevice({ ...device, id }) : await window.api.addDevice(device);
		if (res.success) {
			document.getElementById("btn-clear-form").click();
			loadDevices();
		} else {
			window.showStatus("Error saving device: " + res.error, true);
		}
	});

	document.getElementById("btn-clear-form").addEventListener("click", () => {
		document.getElementById("dev-id").value = "";
		document.getElementById("dev-name").value = "";
		document.getElementById("dev-ip").value = "";
		document.getElementById("dev-port").value = "502";
		document.getElementById("dev-key1").value = "";
		document.getElementById("dev-key2").value = "";
	});

	loadDevices();

	document.getElementById("cal-sig-device").addEventListener("change", async (e) => {
		const devId = parseInt(e.target.value, 10);
		const readSelect = document.getElementById("cal-sig-read");
		const scaleSelect = document.getElementById("cal-sig-scale");
		const offsetSelect = document.getElementById("cal-sig-offset");
		const dzSelect = document.getElementById("cal-sig-deadzone");
		
		readSelect.innerHTML = '<option value="">Read Reg...</option>';
		scaleSelect.innerHTML = '<option value="">Scale Reg...</option>';
		offsetSelect.innerHTML = '<option value="">Offset Reg...</option>';
		dzSelect.innerHTML = '<option value="">Deadzone Reg...</option>';
		
		if (!devId) return;

		const regs = await window.api.getDeviceRegisters(devId);
		regs.forEach(r => {
			const optLabel = `${r.description} (${r.type} ${r.address})`;
			
			const opt1 = document.createElement("option"); opt1.value = r.address; opt1.textContent = optLabel;
			const opt2 = document.createElement("option"); opt2.value = r.address; opt2.textContent = optLabel;
			const opt3 = document.createElement("option"); opt3.value = r.address; opt3.textContent = optLabel;
			const opt4 = document.createElement("option"); opt4.value = r.address; opt4.textContent = optLabel;

			readSelect.appendChild(opt1);
			scaleSelect.appendChild(opt2);
			offsetSelect.appendChild(opt3);
			dzSelect.appendChild(opt4);
		});
	});

	// --- Calibration Logic ---

	let currentActiveSignal = null;
	
	const loadMappedSignalsForCal = async () => {
		const signals = await window.api.getMappedSignals();
		const tbodyMap = document.getElementById("signal-list");
		const tbodyCal = document.getElementById("cal-target-list");
		
		tbodyMap.innerHTML = "";
		tbodyCal.innerHTML = "";

		signals.forEach((sig) => {
			// Populate Signal Mapping Management Table
			const trMap = document.createElement("tr");
			trMap.innerHTML = `
				<td>${sig.label}</td>
				<td>${sig.type}</td>
				<td>${sig.device_id}</td>
				<td>${sig.encoding}</td>
				<td>R:${sig.read_register}, S:${sig.cal_scale_reg}, O:${sig.cal_offset_reg}, D:${sig.cal_deadzone_reg}</td>
				<td>
					<button onclick="editSignal(${sig.id}, '${sig.label}', '${sig.type}', ${sig.device_id}, ${sig.read_reg_id}, '${sig.encoding}', ${sig.cal_scale_reg_id}, ${sig.cal_offset_reg_id}, ${sig.cal_deadzone_reg_id})">Edit</button>
					<button onclick="deleteSignal(${sig.id})">Del</button>
				</td>
			`;
			trMap.addEventListener("click", () => {
				document.querySelectorAll("#signal-list tr.selected").forEach(el => el.classList.remove("selected"));
				trMap.classList.add("selected");
			});
			tbodyMap.appendChild(trMap);

			// Populate Calibration Target Selection Table (analog-in only)
			if (sig.type !== 'analog-in') return;
			const trCal = document.createElement("tr");
			trCal.innerHTML = `
				<td>${sig.label}</td>
				<td>${sig.device_id}</td>
				<td>
					<button onclick="selectForCal(${sig.id}, '${sig.label}', '${sig.encoding}')" style="background:#007bff;color:white;">Select</button>
				</td>
			`;
			trCal.addEventListener("click", () => {
				document.querySelectorAll("#cal-target-list tr.selected").forEach(el => el.classList.remove("selected"));
				trCal.classList.add("selected");
			});
			tbodyCal.appendChild(trCal);
		});
	};

	window.editSignal = async (id, label, type, deviceId, readReg, enc, scaleReg, offsetReg, dzReg) => {
		document.getElementById("cal-sig-id").value = id;
		document.getElementById("cal-sig-label").value = label;
		document.getElementById("cal-sig-type").value = type;
		
		const deviceSelect = document.getElementById("cal-sig-device");
		deviceSelect.value = deviceId;
		
		// Manually trigger the change event to populate the register dropdowns
		deviceSelect.dispatchEvent(new Event("change"));

		// Wait a tiny bit for the dropdowns to populate from SQLite
		await new Promise(r => setTimeout(r, 100));

		document.getElementById("cal-sig-read").value = readReg || "";
		document.getElementById("cal-sig-enc").value = enc || "ABCD";
		document.getElementById("cal-sig-scale").value = scaleReg || "";
		document.getElementById("cal-sig-offset").value = offsetReg || "";
		document.getElementById("cal-sig-deadzone").value = dzReg || "";
		updateCalSigFormState();
	};

	window.deleteSignal = async (id) => {
		if(confirm("Delete signal?")) {
			const res = await window.api.deleteMappedSignal(id);
			if(res.success) {
				loadMappedSignalsForCal();
				renderManualDashboard();
			}
		}
	};

	window.selectForCal = async (id, label, encoding) => {
		currentActiveSignal = { id, label, encoding };
		document.getElementById("active-cal-target").textContent = `${label} (${encoding})`;
		
		document.getElementById("cal-active-m").textContent = "reading...";
		document.getElementById("cal-active-c").textContent = "reading...";
		document.getElementById("cal-active-dz").textContent = "reading...";

		loadCalibrationHistoryForSignal(label);

		const res = await window.api.calibrationReadCurrent({ id });
		if (res && res.success) {
			document.getElementById("cal-active-m").textContent = res.scale.toFixed(4);
			document.getElementById("cal-active-c").textContent = res.offset.toFixed(4);
			document.getElementById("cal-active-dz").textContent = res.deadzone.toFixed(4);
		} else {
			document.getElementById("cal-active-m").textContent = "--";
			document.getElementById("cal-active-c").textContent = "--";
			document.getElementById("cal-active-dz").textContent = "--";
		}
	};

	document.getElementById("btn-save-signal").addEventListener("click", async () => {
		const id = document.getElementById("cal-sig-id").value;
		const type = document.getElementById("cal-sig-type").value;
		const isAnalog = type.startsWith("analog");
		
		const read_register = parseInt(document.getElementById("cal-sig-read").value, 10);
		if (isNaN(read_register) || read_register < 0 || read_register > 49999) return window.showStatus("Read Register must be between 0 and 49999.");

		let cal_scale_reg = null;
		let cal_offset_reg = null;
		let cal_deadzone_reg = null;
		let encoding = null;

		if (isAnalog) {
			cal_scale_reg = parseInt(document.getElementById("cal-sig-scale").value, 10);
			cal_offset_reg = parseInt(document.getElementById("cal-sig-offset").value, 10);
			cal_deadzone_reg = parseInt(document.getElementById("cal-sig-deadzone").value, 10);
			encoding = document.getElementById("cal-sig-enc").value;

			if (isNaN(cal_scale_reg) || cal_scale_reg < 0 || cal_scale_reg > 49999) return window.showStatus("Scale Register must be between 0 and 49999.");
			if (isNaN(cal_offset_reg) || cal_offset_reg < 0 || cal_offset_reg > 49999) return window.showStatus("Offset Register must be between 0 and 49999.");
			if (isNaN(cal_deadzone_reg) || cal_deadzone_reg < 0 || cal_deadzone_reg > 49999) return window.showStatus("Deadzone Register must be between 0 and 49999.");
		}

		const signal = {
			label: document.getElementById("cal-sig-label").value,
			type: type,
			device_id: parseInt(document.getElementById("cal-sig-device").value, 10),
			read_reg_id: read_register,
			encoding: encoding,
			cal_scale_reg_id: cal_scale_reg,
			cal_offset_reg_id: cal_offset_reg,
			cal_deadzone_reg_id: cal_deadzone_reg
		};

		if (isNaN(signal.device_id)) return window.showStatus("Please select a valid device.");

		let res = id ? await window.api.updateMappedSignal({...signal, id}) : await window.api.addMappedSignal(signal);
		if(res.success) {
			document.getElementById("btn-clear-signal").click();
			loadMappedSignalsForCal();
			renderManualDashboard();
		} else {
			window.showStatus("Error: " + res.error, true);
		}
	});

	document.getElementById("btn-clear-signal").addEventListener("click", () => {
		document.getElementById("cal-sig-id").value = "";
		document.getElementById("cal-sig-label").value = "";
		document.getElementById("cal-sig-device").value = "";
		document.getElementById("cal-sig-read").innerHTML = '<option value="">Read Reg...</option>';
		document.getElementById("cal-sig-scale").innerHTML = '<option value="">Scale Reg...</option>';
		document.getElementById("cal-sig-offset").innerHTML = '<option value="">Offset Reg...</option>';
		document.getElementById("cal-sig-deadzone").innerHTML = '<option value="">Deadzone Reg...</option>';
		updateCalSigFormState();
	});

	const updateCalSigFormState = () => {
		const type = document.getElementById("cal-sig-type").value;
		const isAnalog = type.startsWith("analog");
		
		const controls = [
			document.getElementById("cal-sig-enc"),
			document.getElementById("cal-sig-scale"),
			document.getElementById("cal-sig-offset"),
			document.getElementById("cal-sig-deadzone")
		];

		controls.forEach(ctrl => {
			if (ctrl) {
				ctrl.disabled = !isAnalog;
				if (!isAnalog) {
					ctrl.value = ""; // Clear values if not analog
				}
			}
		});
	};

	document.getElementById("cal-sig-type").addEventListener("change", updateCalSigFormState);
	updateCalSigFormState(); // Initialize state

	// --- Calibration Process Data Points ---
	const ptsContainer = document.getElementById("data-points-container");
	let pointsCount = 0;

	const addPointRow = (xVal = "", yVal = "") => {
		const div = document.createElement("div");
		div.style.marginBottom = "5px";
		div.innerHTML = `
			<input type="number" step="any" class="pt-x" placeholder="Expected (X)" value="${xVal}" style="width: 100px;">
			<input type="number" step="any" class="pt-y" placeholder="Actual (Y)" value="${yVal}" style="width: 100px;">
			<button onclick="this.parentElement.remove()">X</button>
		`;
		ptsContainer.appendChild(div);
		pointsCount++;
	};

	document.getElementById("btn-add-point").addEventListener("click", () => addPointRow());
	addPointRow(); addPointRow(); // Init 2 points

	/**
	 * Shared helper that validates all visible calibration point inputs and
	 * highlights invalid ones with a red outline.
	 * Returns { xs, ys } on success, or null when validation fails so callers
	 * can bail out early.
	 */
	const validateCalibrationPoints = () => {
		const xInputs = Array.from(document.getElementsByClassName("pt-x"));
		const yInputs = Array.from(document.getElementsByClassName("pt-y"));

		let hasError = false;

		// Reset previous error styling
		[...xInputs, ...yInputs].forEach(el => {
			el.style.outline = "";
			el.style.borderColor = "";
		});

		const xs = xInputs.map((el, idx) => {
			const v = parseFloat(el.value);
			if (el.value.trim() === "" || isNaN(v)) {
				el.style.outline = "2px solid #dc3545";
				el.style.borderColor = "#dc3545";
				hasError = true;
			}
			return v;
		});

		const ys = yInputs.map((el, idx) => {
			const v = parseFloat(el.value);
			if (el.value.trim() === "" || isNaN(v)) {
				el.style.outline = "2px solid #dc3545";
				el.style.borderColor = "#dc3545";
				hasError = true;
			}
			return v;
		});

		if (hasError || xs.length < 2) {
			window.showStatus("Please fill in at least 2 valid numeric data points (highlighted in red).");
			return null;
		}

		return { xs, ys };
	};

	document.getElementById("btn-cal-calculate").addEventListener("click", async () => {
		/* Use shared validator so invalid inputs are highlighted before calculating. */
		const points = validateCalibrationPoints();
		if (!points) return;
		const { xs, ys } = points;

		// Linear Regression y = mx + c using simple-statistics
		const { m, c } = await window.api.linearRegression(
			xs.map((x, i) => [x, ys[i]])
		);

		document.getElementById("cal-calc-m").value = m.toFixed(5);
		document.getElementById("cal-calc-c").value = c.toFixed(5);
	});

	document.getElementById("btn-cal-zero").addEventListener("click", async () => {
		if(!currentActiveSignal) return window.showStatus("Select a signal first.");
		const res = await window.api.performCalibration({
			id: currentActiveSignal.id,
			scale: 1.0, offset: 0.0, deadzone: 0.0
		});
		if(res.success) window.showStatus("Device Zeroed!");
	});

	document.getElementById("btn-cal-program").addEventListener("click", async () => {
		if(!currentActiveSignal) return window.showStatus("Select a signal first.");
		
		const m = parseFloat(document.getElementById("cal-calc-m").value);
		const c = parseFloat(document.getElementById("cal-calc-c").value);
		const dz = parseFloat(document.getElementById("cal-input-dz").value);

		if(isNaN(m) || isNaN(c) || isNaN(dz)) return window.showStatus("Invalid m, c, or deadzone values.");

		/*
		 * Validate data points before sending to main process.
		 * Without this check, empty inputs produce NaN arrays that get written
		 * as corrupted coefficients to the hardware EEPROM.
		 */
		const points = validateCalibrationPoints();
		if (!points) return;
		const { xs, ys } = points;
		const dataPoints = xs.map((x, i) => ({ expected: x, actual: ys[i] }));

		// 1. Program
		const res = await window.api.performCalibration({
			id: currentActiveSignal.id,
			scale: m, offset: c, deadzone: dz
		});

		if(res.success) {
			window.showStatus("Successfully programmed and handshaked!");
			// 2. Audit Log
			await window.api.saveCalibrationHistory({
				signal_label: currentActiveSignal.label,
				m_value: m, c_value: c, deadzone: dz,
				data_points: dataPoints
			});
			loadCalibrationHistoryForSignal(currentActiveSignal.label);
		} else {
			window.showStatus("Error programming: " + res.error, true);
		}
	});

	// --- Calibration History ---
	const loadCalibrationHistoryForSignal = async (label) => {
		const history = await window.api.getCalibrationHistory(label);
		const ul = document.getElementById("cal-history-list");
		ul.innerHTML = "";
		history.forEach(h => {
			const li = document.createElement("li");
			li.style.marginBottom = "8px";
			li.style.cursor = "pointer";
			li.style.color = "blue";
			li.textContent = `[${h.timestamp}] m:${h.m_value.toFixed(4)}, c:${h.c_value.toFixed(4)}, dz:${h.deadzone.toFixed(4)}`;
			li.onclick = () => {
				document.getElementById("cal-calc-m").value = h.m_value;
				document.getElementById("cal-calc-c").value = h.c_value;
				document.getElementById("cal-input-dz").value = h.deadzone;
				// Load points
				ptsContainer.innerHTML = "";
				if(h.data_points && Array.isArray(h.data_points)) {
					h.data_points.forEach(pt => addPointRow(pt.expected, pt.actual));
				}
			};
			ul.appendChild(li);
		});
	};

	// Init Dashboard
	let initialLabelVersion = "v3";
	try {
		initialLabelVersion = localStorage.getItem("manual_dashboard_label_version") || "v3";
	} catch (e) {
		initialLabelVersion = "v3";
	}
	applySignalLabelVersion(initialLabelVersion);

	loadMappedSignalsForCal();
	document.getElementById("tab-manual-v2").click();
});
