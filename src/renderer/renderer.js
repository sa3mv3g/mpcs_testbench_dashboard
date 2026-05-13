// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process because
// `nodeIntegration` is turned off. Use `window.api` instead.

window.openTab = function (evt, tabName) {
	// Get all elements with class="tab-content" and hide them
	const tabcontent = document.getElementsByClassName("tab-content");
	for (let i = 0; i < tabcontent.length; i++) {
		tabcontent[i].style.display = "none";
	}

	// Get all elements with class="tablinks" and remove the class "active"
	const tablinks = document.getElementsByClassName("tablinks");
	for (let i = 0; i < tablinks.length; i++) {
		tablinks[i].className = tablinks[i].className.replace(" active", "");
	}

	// Show the current tab, and add an "active" class to the button that opened the tab
	document.getElementById(tabName).style.display = "block";
	evt.currentTarget.className += " active";
};

document.addEventListener("DOMContentLoaded", async () => {
	const controlsContainer = document.getElementById("controls-container");

	// 1. Load mapped signals to build UI
	const signals = await window.api.getMappedSignals();

	signals.forEach((signal) => {
		const div = document.createElement("div");
		div.className = "control-group";

		const label = document.createElement("span");
		label.className = "control-label";
		label.textContent = signal.label;

		const valueDisplay = document.createElement("span");
		valueDisplay.id = `val-${signal.label}`;
		valueDisplay.textContent = "0.00"; // Initial mock value

		const readBtn = document.createElement("button");
		readBtn.textContent = "Read";
		readBtn.onclick = async () => {
			const result = await window.api.readRegisters({
				deviceIp: signal.ip,
				port: signal.port,
				startAddress: signal.register,
				length: 2,
			});
			if (result.success) {
				valueDisplay.textContent = "Updated..."; // Mock update
			}
		};

		div.appendChild(label);
		div.appendChild(valueDisplay);
		div.appendChild(readBtn);
		controlsContainer.appendChild(div);
	});

	// 2. Setup button listeners
	document
		.getElementById("btn-snapshot")
		.addEventListener("click", async () => {
			const res = await window.api.saveManualSnapshot({
				/* snapshot data */
			});
			if (res.success) alert("Snapshot saved!");
		});

	document
		.getElementById("btn-start-seq")
		.addEventListener("click", async () => {
			document.getElementById("seq-status").textContent = "Running...";
			await window.api.startSequence(1);
		});

	document
		.getElementById("btn-stop-seq")
		.addEventListener("click", async () => {
			document.getElementById("seq-status").textContent = "Idle";
			await window.api.stopSequence();
		});

	document
		.getElementById("btn-calibrate")
		.addEventListener("click", async () => {
			const res = await window.api.performCalibration({
				label: "AO-05",
				scale: 1,
				offset: 0,
				deadzone: 0,
			});
			if (res.success) alert("Calibration completed for AO-05");
		});

	// 3. Listen for state updates from Main Process
	window.api.onStateUpdate((data) => {
		console.log("Received state update from Main:", data);
		// Update UI based on new data
	});

	// --- Device Registry Logic ---
	const loadDevices = async () => {
		const devices = await window.api.getDevices();
		const tbody = document.getElementById("device-list");
		tbody.innerHTML = "";
		devices.forEach((dev) => {
			const tr = document.createElement("tr");
			tr.innerHTML = `
				<td>${dev.id}</td>
				<td>${dev.display_name}</td>
				<td>${dev.ip}</td>
				<td>${dev.port}</td>
				<td>
					<button class="action-btn" onclick="editDevice(${dev.id}, '${dev.display_name}', '${dev.ip}', ${dev.port})">Edit</button>
					<button class="action-btn" onclick="deleteDevice(${dev.id})">Delete</button>
				</td>
			`;
			tbody.appendChild(tr);
		});
	};

	window.editDevice = (id, name, ip, port) => {
		document.getElementById("dev-id").value = id;
		document.getElementById("dev-name").value = name;
		document.getElementById("dev-ip").value = ip;
		document.getElementById("dev-port").value = port;
		// Switch to tab if not already open
		document.getElementById("device-registry").style.display = "block";
	};

	window.deleteDevice = async (id) => {
		if (confirm("Are you sure you want to delete this device?")) {
			const res = await window.api.deleteDevice(id);
			if (res.success) {
				loadDevices();
			} else {
				alert("Error deleting device: " + res.error);
			}
		}
	};

	document
		.getElementById("btn-save-device")
		.addEventListener("click", async () => {
			const id = document.getElementById("dev-id").value;
			const device = {
				display_name: document.getElementById("dev-name").value,
				ip: document.getElementById("dev-ip").value,
				port: parseInt(document.getElementById("dev-port").value, 10),
			};

			let res;
			if (id) {
				device.id = id;
				res = await window.api.updateDevice(device);
			} else {
				res = await window.api.addDevice(device);
			}

			if (res.success) {
				document.getElementById("btn-clear-form").click();
				loadDevices();
			} else {
				alert("Error saving device: " + res.error);
			}
		});

	document.getElementById("btn-clear-form").addEventListener("click", () => {
		document.getElementById("dev-id").value = "";
		document.getElementById("dev-name").value = "";
		document.getElementById("dev-ip").value = "";
		document.getElementById("dev-port").value = "502";
	});

	// Load devices on startup
	loadDevices();
});
