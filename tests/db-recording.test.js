const db = require('../src/db');

describe('Manual Test Metadata & Recording Session Database Operations', () => {
    beforeAll(async () => {
        await db.initDatabase(':memory:');
    });

    afterAll(() => {
        db.closeDatabase();
    });

    test('saveTestMetadata and getTestMetadata', async () => {
        const initial = await db.getTestMetadata();
        expect(initial).toEqual({
            mpcs_serial_number: '',
            loco_number: '',
            tested_by: '',
            tester_id: ''
        });

        const saveRes = await db.saveTestMetadata({
            mpcs_serial_number: 'MPCS-2026-X1',
            loco_number: 'WAP7-30201',
            tested_by: 'Engineer Test',
            tester_id: 'ID-554'
        });
        expect(saveRes.success).toBe(true);

        const fetched = await db.getTestMetadata();
        expect(fetched.mpcs_serial_number).toBe('MPCS-2026-X1');
        expect(fetched.loco_number).toBe('WAP7-30201');
        expect(fetched.tested_by).toBe('Engineer Test');
        expect(fetched.tester_id).toBe('ID-554');
    });

    test('createRecordingSession, addRecordingSample, finishRecordingSession, and getRecordingSession with label-centric data', async () => {
        const metadata = {
            mpcs_serial_number: 'MPCS-TEST-99',
            loco_number: 'WAG9-12345',
            tested_by: 'John Smith',
            tester_id: 'TECH-10'
        };

        const sessionRes = await db.createRecordingSession(metadata);
        expect(sessionRes.success).toBe(true);
        expect(sessionRes.sessionId).toBeDefined();

        const sessionId = sessionRes.sessionId;

        // Add sample 0 with label-centric payload
        const sample1Res = await db.addRecordingSample({
            sessionId,
            sampleIndex: 0,
            timestamp: new Date().toISOString(),
            data: {
                digitalOutputs: [
                    { label: 'MV-1', value: 1, state: 'ON', confirmationState: 'SYNCED' }
                ],
                digitalInputs: [
                    { label: 'REV', value: 1, state: 'HIGH' }
                ],
                analogOutputs: [
                    { label: 'THROTTLE', value: 2500, percentage: '25.0%' }
                ],
                analogInputs: [
                    { label: 'BAP_PRESS', value: 3.45, formatted: '3.45' }
                ],
                labels: {
                    'MV-1': 'ON',
                    'REV': 'HIGH',
                    'THROTTLE': '25.0%',
                    'BAP_PRESS': '3.45'
                }
            }
        });
        expect(sample1Res.success).toBe(true);

        // Add sample 1 with updated label-centric states
        const sample2Res = await db.addRecordingSample({
            sessionId,
            sampleIndex: 1,
            timestamp: new Date().toISOString(),
            data: {
                digitalOutputs: [
                    { label: 'MV-1', value: 0, state: 'OFF', confirmationState: 'SYNCED' }
                ],
                digitalInputs: [
                    { label: 'REV', value: 0, state: 'LOW' }
                ],
                analogOutputs: [
                    { label: 'THROTTLE', value: 0, percentage: '0.0%' }
                ],
                analogInputs: [
                    { label: 'BAP_PRESS', value: 0.00, formatted: '0.00' }
                ],
                labels: {
                    'MV-1': 'OFF',
                    'REV': 'LOW',
                    'THROTTLE': '0.0%',
                    'BAP_PRESS': '0.00'
                }
            }
        });
        expect(sample2Res.success).toBe(true);

        // Finish session
        const finishRes = await db.finishRecordingSession({ sessionId, totalSamples: 2 });
        expect(finishRes.success).toBe(true);

        // Fetch session
        const fullSession = await db.getRecordingSession(sessionId);
        expect(fullSession).toBeDefined();
        expect(fullSession.status).toBe('COMPLETED');
        expect(fullSession.total_samples).toBe(2);
        expect(fullSession.mpcs_serial_number).toBe('MPCS-TEST-99');
        expect(fullSession.samples).toHaveLength(2);
        expect(fullSession.samples[0].sample_index).toBe(0);
        expect(fullSession.samples[0].data.digitalOutputs[0].label).toBe('MV-1');
        expect(fullSession.samples[0].data.digitalOutputs[0].value).toBe(1);
        expect(fullSession.samples[0].data.labels['MV-1']).toBe('ON');
        expect(fullSession.samples[0].data.labels['BAP_PRESS']).toBe('3.45');

        expect(fullSession.samples[1].sample_index).toBe(1);
        expect(fullSession.samples[1].data.digitalOutputs[0].label).toBe('MV-1');
        expect(fullSession.samples[1].data.digitalOutputs[0].value).toBe(0);
        expect(fullSession.samples[1].data.labels['MV-1']).toBe('OFF');
        expect(fullSession.samples[1].data.labels['BAP_PRESS']).toBe('0.00');
    });
});
