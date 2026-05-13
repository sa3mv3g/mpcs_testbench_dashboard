const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
	// Modbus API
	readRegisters: (params) => ipcRenderer.invoke("modbus:readRegisters", params),
	writeRegister: (params) => ipcRenderer.invoke("modbus:writeRegister", params),

	// Database API
	getMappedSignals: () => ipcRenderer.invoke("db:getMappedSignals"),
	saveManualSnapshot: (data) =>
		ipcRenderer.invoke("db:saveManualSnapshot", data),

	// Device Registry API
	getDevices: () => ipcRenderer.invoke("db:getDevices"),
	addDevice: (device) => ipcRenderer.invoke("db:addDevice", device),
	updateDevice: (device) => ipcRenderer.invoke("db:updateDevice", device),
	deleteDevice: (id) => ipcRenderer.invoke("db:deleteDevice", id),

	// Sequence Engine API
	startSequence: (sequenceId) =>
		ipcRenderer.invoke("sequence:start", sequenceId),
	stopSequence: () => ipcRenderer.invoke("sequence:stop"),

	// Calibration API
	performCalibration: (params) =>
		ipcRenderer.invoke("calibration:perform", params),

	// Receive events from Main Process (e.g. state updates)
	onStateUpdate: (callback) =>
		ipcRenderer.on("state-update", (event, data) => callback(data)),
	removeStateUpdateListener: () =>
		ipcRenderer.removeAllListeners("state-update"),
});
