const db = require('../src/db');

// Use an in-memory SQLite database for testing
const TEST_DB_PATH = ':memory:';

describe('Device Registry DB Operations', () => {
    // Before all tests, initialize the in-memory database
    beforeAll(async () => {
        await db.initDatabase(TEST_DB_PATH);
    });

    // After all tests, close the database connection
    afterAll(() => {
        db.closeDatabase();
    });

    // We'll store the created device ID here to use across tests
    let createdDeviceId;

    it('should add a new device successfully', async () => {
        const newDevice = {
            display_name: 'Test-DAQ-01',
            ip: '192.168.1.50',
            port: 502,
            key1: 100,
            key2: 101
        };

        const result = await db.addDevice(newDevice);
        
        expect(result.success).toBe(true);
        expect(result.id).toBeDefined();
        expect(typeof result.id).toBe('number');
        
        createdDeviceId = result.id;

        // Verify it was added by fetching the list
        const devices = await db.getDevices();
        const found = devices.find(d => d.id === createdDeviceId);
        
        expect(found).toBeDefined();
        expect(found.display_name).toBe('Test-DAQ-01');
        expect(found.ip).toBe('192.168.1.50');
        expect(found.port).toBe(502);
        expect(found.key1).toBe(100);
        expect(found.key2).toBe(101);
    });

    it('should edit an existing device successfully', async () => {
        // Ensure we have an ID from the previous test
        expect(createdDeviceId).toBeDefined();

        const updatedDevice = {
            id: createdDeviceId,
            display_name: 'Test-DAQ-01-Updated',
            ip: '10.0.0.100',
            port: 8502,
            key1: 200,
            key2: 201
        };

        const result = await db.updateDevice(updatedDevice);
        
        expect(result.success).toBe(true);
        expect(result.changes).toBe(1);

        // Verify it was updated by fetching the list
        const devices = await db.getDevices();
        const found = devices.find(d => d.id === createdDeviceId);
        
        expect(found).toBeDefined();
        expect(found.display_name).toBe('Test-DAQ-01-Updated');
        expect(found.ip).toBe('10.0.0.100');
        expect(found.port).toBe(8502);
        expect(found.key1).toBe(200);
        expect(found.key2).toBe(201);
    });

    it('should remove a device successfully', async () => {
        // Ensure we have an ID from the previous test
        expect(createdDeviceId).toBeDefined();

        const result = await db.deleteDevice(createdDeviceId);
        
        expect(result.success).toBe(true);
        expect(result.changes).toBe(1);

        // Verify it was deleted by fetching the list
        const devices = await db.getDevices();
        const found = devices.find(d => d.id === createdDeviceId);
        
        expect(found).toBeUndefined(); // Should not exist anymore
    });
});
