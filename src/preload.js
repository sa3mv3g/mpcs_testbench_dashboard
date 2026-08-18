const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
	// System API
	getAppVersion: () => ipcRenderer.invoke("system:getAppVersion"),
	getNetworkInterfaces: () => ipcRenderer.invoke("system:getNetworkInterfaces"),
	openExternal: (url) => ipcRenderer.invoke("system:openExternal", url),

	// Modbus API
	connectAllDevices: (interfaceIp) => ipcRenderer.invoke("modbus:connectAll", interfaceIp),
	disconnectAllDevices: () => ipcRenderer.invoke("modbus:disconnectAll"),
	refreshConnections: () => ipcRenderer.invoke("modbus:refreshConnections"),
	readRegisters: (params) => ipcRenderer.invoke("modbus:readRegisters", params),
	writeRegister: (params) => ipcRenderer.invoke("modbus:writeRegister", params),
	readRawRegister: (params) => ipcRenderer.invoke("modbus:readRawRegister", params),

	// Database API
	getMappedSignals: () => ipcRenderer.invoke("db:getMappedSignals"),
	addMappedSignal: (signal) => ipcRenderer.invoke("db:addMappedSignal", signal),
	updateMappedSignal: (signal) => ipcRenderer.invoke("db:updateMappedSignal", signal),
	deleteMappedSignal: (id) => ipcRenderer.invoke("db:deleteMappedSignal", id),
	getTestMetadata: () =>
		ipcRenderer.invoke("db:getTestMetadata"),
	saveTestMetadata: (metadata) =>
		ipcRenderer.invoke("db:saveTestMetadata", metadata),
	startRecordingSession: (metadata) =>
		ipcRenderer.invoke("recording:start", metadata),
	stopRecordingSession: () =>
		ipcRenderer.invoke("recording:stop"),
	getRecordingSession: (sessionId) =>
		ipcRenderer.invoke("recording:getSession", sessionId),
	saveDashboardDataAsExcel: (params) =>
		ipcRenderer.invoke("dashboard:saveExcel", params),
	exportExcel: (payload) =>
		ipcRenderer.invoke("dashboard:saveExcel", payload),
	getLayout: () => ipcRenderer.invoke("db:getLayout"),
	clearLayout: () => ipcRenderer.invoke("db:clearLayout"),
	saveLayoutPosition: (params) => ipcRenderer.invoke("db:saveLayoutPosition", params),

	getDesiredStates: () => ipcRenderer.invoke("db:getDesiredStates"),
	setDesiredState: (guiId, value) => ipcRenderer.invoke("db:setDesiredState", { guiId, value }),
	resetAllDesiredStates: () => ipcRenderer.invoke("db:resetAllDesiredStates"),

	modbusPreemptWrite: (signal_id, value) => ipcRenderer.invoke("modbus:preemptWrite", { signal_id, value }),
	directWrite: (params) => ipcRenderer.invoke("modbus:directWrite", params),

	// Device Registry API
	getDevices: () => ipcRenderer.invoke("db:getDevices"),
	addDevice: (device) => ipcRenderer.invoke("db:addDevice", device),
	updateDevice: (device) => ipcRenderer.invoke("db:updateDevice", device),
	deleteDevice: (id) => ipcRenderer.invoke("db:deleteDevice", id),

	getDeviceRegisters: (device_id) => ipcRenderer.invoke("db:getDeviceRegisters", device_id),
	addDeviceRegister: (reg) => ipcRenderer.invoke("db:addDeviceRegister", reg),
	updateDeviceRegister: (reg) => ipcRenderer.invoke("db:updateDeviceRegister", reg),
	deleteDeviceRegister: (id) => ipcRenderer.invoke("db:deleteDeviceRegister", id),

	// Sequence Engine API
	startSequence: (sequenceId) =>
		ipcRenderer.invoke("sequence:start", sequenceId),
	stopSequence: () => ipcRenderer.invoke("sequence:stop"),

	// Calibration API
	performCalibration: (params) =>
		ipcRenderer.invoke("calibration:perform", params),
	calibrationReadCurrent: (params) =>
		ipcRenderer.invoke("calibration:readCurrent", params),
	linearRegression: (points) =>
		ipcRenderer.invoke("calibration:linearRegression", points),
	saveCalibrationHistory: (history) =>
		ipcRenderer.invoke("db:saveCalibrationHistory", history),
	getCalibrationHistory: (signal_label) =>
		ipcRenderer.invoke("db:getCalibrationHistory", signal_label),

	// Receive events from Main Process (e.g. state updates)
	onStateUpdate: (callback) =>
		ipcRenderer.on("state-update", (event, data) => callback(data)),
	removeStateUpdateListener: () =>
		ipcRenderer.removeAllListeners("state-update"),

	onDiscoveryDeviceFound: (callback) => {
		ipcRenderer.removeAllListeners("discovery:device-found");
		ipcRenderer.on("discovery:device-found", (event, device) => callback(device));
	},

	onNetworkUpdate: (callback) =>
		ipcRenderer.on("network-update", (event, data) => callback(data)),

	onRecordingTick: (callback) =>
		ipcRenderer.on("recording:tick", (event, data) => callback(data)),
	removeRecordingTickListener: () =>
		ipcRenderer.removeAllListeners("recording:tick"),

	// Send events to Main Process (e.g. active dashboard changes)
	setActiveDashboard: (tabName) => ipcRenderer.send("app:setActiveDashboard", tabName),
});

// Expose electronAPI for Excel export and file integrations
contextBridge.exposeInMainWorld("electronAPI", {
	getAppVersion: () => ipcRenderer.invoke("system:getAppVersion"),
	openExternal: (url) => ipcRenderer.invoke("system:openExternal", url),
	exportExcel: (payload) => ipcRenderer.invoke("dashboard:saveExcel", payload),
	saveDashboardDataAsExcel: (payload) => ipcRenderer.invoke("dashboard:saveExcel", payload),
});
