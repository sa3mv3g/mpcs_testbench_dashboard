const db = require("../src/db");

describe("Manual Dashboard Offline & Failed Write Toggle Handling", () => {
	let mockApi;
	let statusMessages;
	let devicesInDb;

	beforeAll(async () => {
		await db.initDatabase(":memory:");
	});

	afterAll(() => {
		db.closeDatabase();
	});

	beforeEach(async () => {
		// Reset DB tables
		await db.resetAllDesiredStates();
		devicesInDb = [
			{
				id: 1,
				display_name: "Controller 1",
				ip: "192.168.0.200",
				port: 502,
				key1: 0x5555,
				key2: 0xdddd,
			},
			{
				id: 2,
				display_name: "Controller 2",
				ip: null,
				port: null,
				key1: 0x5555,
				key2: 0xdddd,
			},
		];

		statusMessages = [];

		// Mock window.showStatus
		global.window = global.window || {};
		global.window.showStatus = (msg, isError) => {
			statusMessages.push({ msg, isError });
		};

		// Mock window.api
		mockApi = {
			getDevices: jest.fn().mockImplementation(async () => devicesInDb),
			getDesiredStates: jest
				.fn()
				.mockImplementation(async () => db.getDesiredStates()),
			setDesiredState: jest
				.fn()
				.mockImplementation(async (guiId, value) =>
					db.setDesiredState(guiId, value),
				),
			directWrite: jest.fn(),
		};
		global.window.api = mockApi;
	});

	// Helper functions representing the handler logic
	const getDeviceIp = async (devId) => {
		const devices = await global.window.api.getDevices();
		const dev = devices.find((d) => d.id === devId);
		return dev ? dev.ip : null;
	};

	const handleSwitchChange = async (swElement) => {
		const dev = parseInt(swElement.dataset.dev, 10);
		const addr = parseInt(swElement.dataset.addr, 10);
		const val = swElement.value;
		const prevVal = val ? 0 : 1;
		const guiId = swElement.id;

		const ip = await getDeviceIp(dev);
		if (!ip) {
			global.window.showStatus(
				`Cannot write: Device ${dev} is not configured or offline`,
				true,
			);
			if (typeof swElement.setValue === "function") {
				swElement.setValue(prevVal, false);
			} else {
				swElement.value = prevVal;
			}
			return;
		}

		const res = await global.window.api.directWrite({
			ip: ip,
			port: 502,
			fc: "writeCoil",
			address: addr,
			value: !!val,
			unitId: dev,
		});

		if (!res || !res.success) {
			const errMsg =
				res && res.error ? res.error : `Device ${dev} write failed`;
			global.window.showStatus(`Cannot write: ${errMsg}`, true);
			if (typeof swElement.setValue === "function") {
				swElement.setValue(prevVal, false);
			} else {
				swElement.value = prevVal;
			}
			return;
		}

		// Save desired state ONLY after successful write
		await global.window.api.setDesiredState(guiId, val);
	};

	const handleSliderChange = async (sliderElement) => {
		const dev = parseInt(sliderElement.dataset.dev, 10);
		const addr = parseInt(sliderElement.dataset.addr, 10);
		const rawVal = Math.round(sliderElement.value);
		const prevVal = parseFloat(
			sliderElement.dataset.lastVal != null ? sliderElement.dataset.lastVal : 0,
		);
		const guiId = sliderElement.id;

		const ip = await getDeviceIp(dev);
		if (!ip) {
			global.window.showStatus(
				`Cannot write: Device ${dev} is not configured or offline`,
				true,
			);
			if (typeof sliderElement.setValue === "function") {
				sliderElement.setValue(prevVal, false);
			} else {
				sliderElement.value = prevVal;
			}
			return;
		}

		const res = await global.window.api.directWrite({
			ip: ip,
			port: 502,
			fc: "writeRegister",
			address: addr,
			value: rawVal,
			unitId: dev,
		});

		if (!res || !res.success) {
			const errMsg =
				res && res.error ? res.error : `Device ${dev} write failed`;
			global.window.showStatus(`Cannot write: ${errMsg}`, true);
			if (typeof sliderElement.setValue === "function") {
				sliderElement.setValue(prevVal, false);
			} else {
				sliderElement.value = prevVal;
			}
			return;
		}

		sliderElement.dataset.lastVal = rawVal;
		await global.window.api.setDesiredState(guiId, rawVal);
	};

	test("I-00 (do-1-0, Device 1 configured with IP) when network is disconnected: write fails, switch reverts, no DB persistence", async () => {
		// Device 1 has IP 192.168.0.200, but modbus is disconnected
		mockApi.directWrite.mockResolvedValue({
			success: false,
			error: "Device at 192.168.0.200:502 is not connected",
		});

		const mockSwitch = {
			id: "do-1-0",
			dataset: { dev: "1", addr: "0" },
			value: 1, // User clicked to turn ON
			setValue: jest.fn(function (v) {
				this.value = v;
			}),
		};

		await handleSwitchChange(mockSwitch);

		// 1. Error status must be shown
		expect(statusMessages.length).toBeGreaterThan(0);
		expect(statusMessages[0].isError).toBe(true);
		expect(statusMessages[0].msg).toContain(
			"Device at 192.168.0.200:502 is not connected",
		);

		// 2. Switch must revert to 0
		expect(mockSwitch.setValue).toHaveBeenCalledWith(0, false);
		expect(mockSwitch.value).toBe(0);

		// 3. Database desired state must NOT have saved value 1
		const desiredStates = await db.getDesiredStates();
		expect(desiredStates["do-1-0"]).toBe(0); // From initial resetAllDesiredStates, not 1
	});

	test("I-16 (do-2-0, Device 2 with ip: null): shows offline error, switch reverts, no DB persistence", async () => {
		const mockSwitch = {
			id: "do-2-0",
			dataset: { dev: "2", addr: "0" },
			value: 1, // User clicked to turn ON
			setValue: jest.fn(function (v) {
				this.value = v;
			}),
		};

		await handleSwitchChange(mockSwitch);

		// 1. Offline error status must be shown
		expect(statusMessages.length).toBeGreaterThan(0);
		expect(statusMessages[0].isError).toBe(true);
		expect(statusMessages[0].msg).toBe(
			"Cannot write: Device 2 is not configured or offline",
		);

		// 2. directWrite should NOT even be called
		expect(mockApi.directWrite).not.toHaveBeenCalled();

		// 3. Switch must revert to 0
		expect(mockSwitch.setValue).toHaveBeenCalledWith(0, false);
		expect(mockSwitch.value).toBe(0);

		// 4. Database desired state must NOT have saved value 1
		const desiredStates = await db.getDesiredStates();
		expect(desiredStates["do-2-0"]).toBe(0);
	});

	test("Analog slider (ao-1-0, Device 1) when write fails: reverts to previous value, no DB persistence", async () => {
		mockApi.directWrite.mockResolvedValue({
			success: false,
			error: "Port Not Open",
		});

		const mockSlider = {
			id: "ao-1-0",
			dataset: { dev: "1", addr: "0", lastVal: 0 },
			value: 5000, // User dragged to 50%
			setValue: jest.fn(function (v) {
				this.value = v;
			}),
		};

		await handleSliderChange(mockSlider);

		expect(statusMessages.length).toBeGreaterThan(0);
		expect(statusMessages[0].isError).toBe(true);
		expect(statusMessages[0].msg).toContain("Port Not Open");
		expect(mockSlider.setValue).toHaveBeenCalledWith(0, false);
		expect(mockSlider.value).toBe(0);

		const desiredStates = await db.getDesiredStates();
		expect(desiredStates["ao-1-0"]).toBe(0);
	});

	test("When write succeeds: switch state remains and persists to DB", async () => {
		mockApi.directWrite.mockResolvedValue({
			success: true,
		});

		const mockSwitch = {
			id: "do-1-0",
			dataset: { dev: "1", addr: "0" },
			value: 1,
			setValue: jest.fn(function (v) {
				this.value = v;
			}),
		};

		await handleSwitchChange(mockSwitch);

		expect(mockSwitch.value).toBe(1);
		expect(mockSwitch.setValue).not.toHaveBeenCalled(); // Did not revert

		const desiredStates = await db.getDesiredStates();
		expect(desiredStates["do-1-0"]).toBe(1);
	});
});
