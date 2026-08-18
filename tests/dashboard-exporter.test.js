const {
    to3State,
    format3State,
    getMatrixColumns,
    getDefaultSignalLabel,
    normalizeSnapshotData,
    analyzeSystemControllers,
    computeTelemetryDeltas,
    formatLocalDate,
    formatDuration,
    formatDashboardAsExcel,
    generateExcelWorkbook,
    extractManualDashboardData,
    FOOTER_BRANDING
} = require('../src/renderer/dashboard-exporter');

describe('Dashboard Exporter Unit Tests', () => {
    test('to3State and format3State convert digital signal values correctly', () => {
        // High / Active states -> 'H'
        expect(to3State(1)).toBe('H');
        expect(to3State(true)).toBe('H');
        expect(to3State('1')).toBe('H');
        expect(to3State('ON')).toBe('H');
        expect(to3State('HIGH')).toBe('H');
        expect(to3State('H')).toBe('H');
        expect(to3State(0, 'ON')).toBe('H');
        expect(to3State(0, 'HIGH')).toBe('H');
        expect(format3State(1, 'ON')).toBe('H');

        // Low / Inactive states -> 'L'
        expect(to3State(0)).toBe('L');
        expect(to3State(false)).toBe('L');
        expect(to3State('0')).toBe('L');
        expect(to3State('OFF')).toBe('L');
        expect(to3State('LOW')).toBe('L');
        expect(to3State('L')).toBe('L');
        expect(to3State(1, 'OFF')).toBe('L');
        expect(to3State(1, 'LOW')).toBe('L');
        expect(format3State(0, 'OFF')).toBe('L');

        // Disconnected / Unknown / Offline / Standby -> ' '
        expect(to3State('--')).toBe(' ');
        expect(to3State(null)).toBe(' ');
        expect(to3State(undefined)).toBe(' ');
        expect(to3State(' ')).toBe(' ');
        expect(to3State('UNKNOWN')).toBe(' ');
        expect(to3State('OFFLINE')).toBe(' ');
        expect(to3State('STANDBY')).toBe(' ');
        expect(to3State(0, '--')).toBe(' ');
        expect(to3State(1, 'STANDBY')).toBe(' ');
        expect(format3State('--', '--')).toBe(' ');
    });

    test('formatDuration formats seconds into HH:MM:SS', () => {
        expect(formatDuration(0)).toBe('00:00:00');
        expect(formatDuration(65)).toBe('00:01:05');
        expect(formatDuration(3665)).toBe('01:01:05');
    });

    test('formatLocalDate returns valid string format', () => {
        const str = formatLocalDate(new Date('2026-08-18T10:15:30Z'));
        expect(str).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    test('getDefaultSignalLabel returns correct labels for all channels', () => {
        expect(getDefaultSignalLabel('en_amp-1')).toBe('1 EN (Amp)');
        expect(getDefaultSignalLabel('do-1-0')).toBe('I-00 [1.1-A]');
        expect(getDefaultSignalLabel('do-1-7')).toBe('I-07 [1.1-H]');
        expect(getDefaultSignalLabel('do-1-8')).toBe('I-08 [1.2-A]');
        expect(getDefaultSignalLabel('do-1-15')).toBe('I-15 [1.2-H]');
        expect(getDefaultSignalLabel('di-1-23')).toBe('O-00 [1.4-1]');
        expect(getDefaultSignalLabel('di-1-17')).toBe('O-01 [1.4-2]');
        expect(getDefaultSignalLabel('di-1-18')).toBe('O-07 [1.4-8]');
        expect(getDefaultSignalLabel('ao-1-0')).toBe('110VAC (AO-CH-1)');
        expect(getDefaultSignalLabel('ai-1-4')).toBe('110VAC (AI-CH-1)');
        expect(getDefaultSignalLabel('ai-1-6')).toBe('110VAC (AI-CH-2)');

        // Controller 8 channels
        expect(getDefaultSignalLabel('do-8-0')).toBe('I-112 [8.1-A]');
        expect(getDefaultSignalLabel('do-8-15')).toBe('I-127 [8.2-H]');
        expect(getDefaultSignalLabel('di-8-23')).toBe('O-56 [8.4-1]');
        expect(getDefaultSignalLabel('di-8-18')).toBe('O-63 [8.4-8]');
    });

    test('extractManualDashboardData returns label-centric data structure', () => {
        const metadata = {
            mpcs_serial_number: 'MPCS-1001',
            loco_number: 'WAP7-30001',
            tested_by: 'Engineer A',
            tester_id: 'TECH-100'
        };

        const result = extractManualDashboardData(null, [], metadata);
        expect(result.metadata.mpcs_serial_number).toBe('MPCS-1001');
        expect(result.digitalInputs).toBeDefined();
        expect(result.digitalInputs.length).toBe(128);
        expect(result.digitalInputs[0].label).toBe('I-00 [1.1-A]');
        expect(result.digitalOutputs.length).toBe(64);
        expect(result.digitalOutputs[0].label).toBe('O-00 [1.4-1]');
        expect(result.analogOutputs.length).toBe(4);
        expect(result.analogOutputs[0].label).toBe('110VAC (AO-CH-1)');
        expect(result.analogInputs.length).toBe(8);
        expect(result.analogInputs[0].label).toBe('110VAC (AI-CH-1)');
        expect(result.controls.length).toBe(1);
        expect(result.controls[0].label).toBe('1 EN (Amp)');
        expect(result.labels).toBeDefined();
        expect(result.labels['I-00 [1.1-A]']).toBe('OFF');
    });

    test('computeTelemetryDeltas computes transitions accurately across multi-sample telemetry', () => {
        const samples = [
            {
                sample_index: 0,
                timestamp: '2026-08-18T10:00:00Z',
                data: {
                    controls: [{ label: '1 EN (Amp)', value: 0, state: 'OFF' }],
                    digitalInputs: [
                        { label: 'I-00 [1.1-A]', value: 0, state: 'OFF', confirmationState: 'SYNCED' },
                        { label: 'I-01 [1.1-B]', value: 0, state: 'OFF', confirmationState: 'SYNCED' }
                    ],
                    digitalOutputs: [
                        { label: 'O-00 [1.4-1]', value: 0, state: 'LOW' }
                    ],
                    analogOutputs: [
                        { label: '110VAC (AO-CH-1)', value: 0, percentage: '0.0%', formatted: '0 (0.0%)' }
                    ],
                    analogInputs: [
                        { label: '110VAC (AI-CH-1)', value: 0.0, formatted: '0.00' }
                    ]
                }
            },
            {
                sample_index: 1,
                timestamp: '2026-08-18T10:00:01Z',
                data: {
                    controls: [{ label: '1 EN (Amp)', value: 1, state: 'ON' }],
                    digitalInputs: [
                        { label: 'I-00 [1.1-A]', value: 1, state: 'ON', confirmationState: 'SYNCED' },
                        { label: 'I-01 [1.1-B]', value: 0, state: 'OFF', confirmationState: 'SYNCED' }
                    ],
                    digitalOutputs: [
                        { label: 'O-00 [1.4-1]', value: 1, state: 'HIGH' }
                    ],
                    analogOutputs: [
                        { label: '110VAC (AO-CH-1)', value: 2500, percentage: '25.0%', formatted: '2500 (25.0%)' }
                    ],
                    analogInputs: [
                        { label: '110VAC (AI-CH-1)', value: 3.45, formatted: '3.45' }
                    ]
                }
            }
        ];

        const deltas = computeTelemetryDeltas(samples);
        expect(deltas.length).toBe(5);

        // Control transition
        const enDelta = deltas.find(d => d.signalLabel === '1 EN (Amp)');
        expect(enDelta).toBeDefined();
        expect(enDelta.transition).toBe('OFF -> ON');
        expect(enDelta.time).toBe('00:00:01');

        // DI transition
        const diDelta = deltas.find(d => d.signalLabel === 'I-00 [1.1-A]');
        expect(diDelta).toBeDefined();
        expect(diDelta.transition).toBe('0 (LOW) -> 1 (HIGH)');

        // DO transition
        const doDelta = deltas.find(d => d.signalLabel === 'O-00 [1.4-1]');
        expect(doDelta).toBeDefined();
        expect(doDelta.transition).toBe('0 (LOW) -> 1 (HIGH)');

        // AO transition
        const aoDelta = deltas.find(d => d.signalLabel === '110VAC (AO-CH-1)');
        expect(aoDelta).toBeDefined();
        expect(aoDelta.transition).toBe('0 (0.0%) -> 2500 (25.0%)');

        // AI transition
        const aiDelta = deltas.find(d => d.signalLabel === '110VAC (AI-CH-1)');
        expect(aiDelta).toBeDefined();
        expect(aiDelta.transition).toBe('0.00 -> 3.45');
    });

    test('analyzeSystemControllers detects controller online status and fault presence', () => {
        const snapWithFault = {
            digitalInputs: [
                { guiId: 'do-1-0', label: 'I-00 [1.1-A]', value: 1, confirmationState: 'FAULT' },
                { guiId: 'do-2-0', label: 'I-16 [2.1-A]', value: 0, confirmationState: 'SYNCED' }
            ]
        };

        const analysis = analyzeSystemControllers(snapWithFault);
        expect(analysis.onlineControllers).toEqual([1, 2]);
        expect(analysis.offlineControllers).toEqual([3, 4, 5, 6, 7, 8]);
        expect(analysis.activeCount).toBe(2);
        expect(analysis.hasFault).toBe(true);
    });

    test('full 205-channel Manual Dashboard export generates complete 3-state matrix Excel workbook on single sheet "data"', async () => {
        const fullData = extractManualDashboardData(null, [], {
            mpcs_serial_number: 'MPCS-FULL-205',
            loco_number: 'WAP7-70001',
            tested_by: 'QA Lead',
            tester_id: 'TECH-001'
        });

        expect(fullData.controls.length).toBe(1);
        expect(fullData.digitalInputs.length).toBe(128);
        expect(fullData.digitalOutputs.length).toBe(64);
        expect(fullData.analogOutputs.length).toBe(4);
        expect(fullData.analogInputs.length).toBe(8);

        // Set specific channel test states
        fullData.controls[0].value = 1;
        fullData.controls[0].state = 'ON';
        fullData.digitalInputs[0].value = 1;
        fullData.digitalInputs[0].state = 'ON';
        fullData.digitalInputs[1].value = '--';
        fullData.digitalInputs[1].state = '--';
        fullData.digitalOutputs[0].value = 1;
        fullData.digitalOutputs[0].state = 'HIGH';
        fullData.digitalOutputs[1].value = '--';
        fullData.digitalOutputs[1].state = '--';
        fullData.analogOutputs[0].value = 3500;
        fullData.analogOutputs[1].value = '--';
        fullData.analogInputs[0].value = 3.45;
        fullData.analogInputs[1].value = '--';

        const wb = await formatDashboardAsExcel({ metadata: fullData.metadata, snapshot: fullData });
        expect(wb).toBeDefined();

        const sheetNames = wb.worksheets.map(ws => ws.name);
        expect(sheetNames).toEqual(['data']);
        expect(wb.worksheets.length).toBe(1);

        const ws = wb.getWorksheet('data');
        expect(ws).toBeDefined();

        // Check Top Provenance Block (Rows 1-9)
        expect(ws.getCell('A1').value).toContain('MPCS TESTBENCH - MANUAL DASHBOARD V2 TELEMETRY REPORT');
        expect(ws.getCell('A1').fill.fgColor.argb).toBe('FF0B2545');
        expect(ws.getCell('A1').font.color.argb).toBe('FFFFFFFF');
        // Row 1 merge spans strictly till Column S (A1:S1 / Columns 1 through 19)
        expect(ws.model.merges).toContain('A1:S1');
        expect(ws.getCell('S1').fill.fgColor.argb).toBe('FF0B2545');
        expect(ws.getCell('S1').font.color.argb).toBe('FFFFFFFF');
        expect(ws.getCell('S1').border).toBeDefined();
        // Column T onwards in Row 1 remains unmerged and default
        expect(ws.getRow(1).getCell(20).fill).toBeUndefined();

        expect(ws.getCell('A2').value).toBe('MPCS Serial Number');
        expect(ws.getCell('B2').value).toBe('MPCS-FULL-205');
        expect(ws.getCell('A3').value).toBe('LOCO Number');
        expect(ws.getCell('B3').value).toBe('WAP7-70001');
        expect(ws.getCell('A4').value).toBe('Tested By');
        expect(ws.getCell('B4').value).toBe('QA Lead');
        expect(ws.getCell('A5').value).toBe('Tester ID');
        expect(ws.getCell('B5').value).toBe('TECH-001');
        expect(ws.getCell('A6').value).toBe('Date & Time');
        expect(ws.getCell('A7').value).toBe('Test Duration');
        expect(ws.getCell('A8').value).toBe('Report Type');
        expect(ws.getCell('B8').value).toBe('Snapshot');
        expect(ws.getCell('A9').value).toBe('System Status');
        expect(ws.getCell('B9').value).toBe('NORMAL / PASS');

        // Check Header Row (Row 11)
        const headerRow = ws.getRow(11);
        expect(headerRow.getCell(1).value).toBe('Time (Elapsed)');
        expect(headerRow.getCell(2).value).toBe('Local Time');
        expect(headerRow.getCell(3).value).toBe('1 EN (Amp)');
        expect(headerRow.getCell(4).value).toBe('I-00 [1.1-A]');
        expect(headerRow.getCell(132).value).toBe('O-00 [1.4-1]');
        expect(headerRow.getCell(196).value).toBe('110VAC (AO-CH-1)');
        expect(headerRow.getCell(200).value).toBe('110VAC (AI-CH-1)');

        // Check Data Row 12
        const dataRow = ws.getRow(12);
        expect(dataRow.getCell(1).value).toBe('00:00:00');
        expect(dataRow.getCell(3).value).toBe('H'); // 1 EN (Amp) is ON -> 'H'
        expect(dataRow.getCell(4).value).toBe('H'); // I-00 [1.1-A] is ON -> 'H'
        expect(dataRow.getCell(5).value).toBe(' '); // I-01 [1.1-B] is '--' -> ' '
        expect(dataRow.getCell(132).value).toBe('H'); // O-00 [1.4-1] is HIGH -> 'H'
        expect(dataRow.getCell(133).value).toBe(' '); // O-01 [1.4-2] is '--' -> ' '
        expect(dataRow.getCell(196).value).toBe(3500); // AO-1 is 3500
        expect(dataRow.getCell(197).value).toBe(''); // AO-2 is '--'
        expect(dataRow.getCell(200).value).toBe(3.45); // AI-1 is 3.45
        expect(dataRow.getCell(201).value).toBe(''); // AI-2 is '--'

        // Verify buffer output
        const buffer = await wb.xlsx.writeBuffer();
        expect(buffer).toBeDefined();
        expect(buffer.byteLength).toBeGreaterThan(1000);
    });

    test('formatDashboardAsExcel generates structured single-sheet Read-Only Excel workbook with sheet protection', async () => {
        const metadata = {
            mpcs_serial_number: 'MPCS-XLSX-001',
            loco_number: 'WAP7-39999',
            tested_by: 'Lead Test Specialist',
            tester_id: 'TECH-XLS'
        };

        const snapshot = {
            timestamp: '2026-08-18T12:00:00Z',
            controls: [
                { label: '1 EN (Amp)', value: 1, state: 'ON' }
            ],
            digitalInputs: [
                { label: 'I-00 [1.1-A]', value: 1, state: 'ON', confirmationState: 'SYNCED' },
                { label: 'I-01 [1.1-B]', value: 0, state: 'OFF', confirmationState: 'SYNCED' }
            ],
            digitalOutputs: [
                { label: 'O-00 [1.4-1]', value: 1, state: 'HIGH' },
                { label: 'O-01 [1.4-2]', value: 0, state: 'LOW' }
            ],
            analogOutputs: [
                { label: '110VAC (AO-CH-1)', value: 2500, percentage: '25.0%', formatted: '2500 (25.0%)', confirmationState: 'SYNCED' }
            ],
            analogInputs: [
                { label: '110VAC (AI-CH-1)', value: 3.42, formatted: '3.42' },
                { label: '110VAC (AI-CH-2)', value: 8.50, formatted: '8.50' }
            ]
        };

        const wb = await formatDashboardAsExcel({ metadata, snapshot });
        expect(wb).toBeDefined();

        // Verify single worksheet named 'data'
        const sheetNames = wb.worksheets.map(ws => ws.name);
        expect(sheetNames).toEqual(['data']);
        expect(wb.worksheets.length).toBe(1);

        const ws = wb.getWorksheet('data');
        expect(ws).toBeDefined();
        expect(ws.sheetProtection).toBeDefined();

        // Verify freeze pane: frozen at column 1 and row 11
        expect(ws.views).toBeDefined();
        expect(ws.views[0].state).toBe('frozen');
        expect(ws.views[0].xSplit).toBe(1);
        expect(ws.views[0].ySplit).toBe(11);

        // Verify AutoFilter on Row 11
        expect(ws.autoFilter).toBeDefined();
        expect(ws.autoFilter.from.row).toBe(11);

        // Verify Title Header (Row 1)
        expect(ws.getCell('A1').value).toContain('MPCS TESTBENCH - MANUAL DASHBOARD V2 TELEMETRY REPORT');
        expect(ws.getCell('A1').fill.fgColor.argb).toBe('FF0B2545');
        expect(ws.getCell('A1').font.color.argb).toBe('FFFFFFFF');
        // Row 1 merge spans strictly till Column S (A1:S1 / Columns 1 through 19)
        expect(ws.model.merges).toContain('A1:S1');
        expect(ws.getCell('S1').fill.fgColor.argb).toBe('FF0B2545');
        expect(ws.getCell('S1').font.color.argb).toBe('FFFFFFFF');
        expect(ws.getCell('S1').border).toBeDefined();
        // Column T onwards in Row 1 remains unmerged and default
        expect(ws.getRow(1).getCell(20).fill).toBeUndefined();

        // Verify Key-Value Identification Grid (Rows 2-9 strictly Columns A & B)
        expect(ws.getRow(2).getCell(3).value).toBeNull();
        expect(ws.getRow(3).getCell(3).value).toBeNull();
        expect(ws.getCell('A2').value).toBe('MPCS Serial Number');
        expect(ws.getCell('B2').value).toBe('MPCS-XLSX-001');

        expect(ws.getCell('A3').value).toBe('LOCO Number');
        expect(ws.getCell('B3').value).toBe('WAP7-39999');

        expect(ws.getCell('A4').value).toBe('Tested By');
        expect(ws.getCell('B4').value).toBe('Lead Test Specialist');

        expect(ws.getCell('A5').value).toBe('Tester ID');
        expect(ws.getCell('B5').value).toBe('TECH-XLS');

        expect(ws.getCell('A6').value).toBe('Date & Time');

        expect(ws.getCell('A7').value).toBe('Test Duration');

        expect(ws.getCell('A8').value).toBe('Report Type');
        expect(ws.getCell('B8').value).toBe('Snapshot');

        expect(ws.getCell('A9').value).toBe('System Status');
        expect(ws.getCell('B9').value).toBe('NORMAL / PASS');

        // Verify Header Row (Row 11)
        const headerRow = ws.getRow(11);
        expect(headerRow.height).toBe(100);
        expect(headerRow.getCell(1).value).toBe('Time (Elapsed)');
        expect(headerRow.getCell(2).value).toBe('Local Time');
        expect(headerRow.getCell(3).value).toBe('1 EN (Amp)');
        expect(headerRow.getCell(4).value).toBe('I-00 [1.1-A]');
        expect(headerRow.getCell(5).value).toBe('I-01 [1.1-B]');
        expect(headerRow.getCell(6).value).toBe('O-00 [1.4-1]');
        expect(headerRow.getCell(7).value).toBe('O-01 [1.4-2]');
        expect(headerRow.getCell(8).value).toBe('110VAC (AO-CH-1)');
        expect(headerRow.getCell(9).value).toBe('110VAC (AI-CH-1)');
        expect(headerRow.getCell(10).value).toBe('110VAC (AI-CH-2)');

        // Verify column widths
        expect(ws.getColumn(1).width).toBe(22); // Time (Elapsed)
        expect(ws.getColumn(2).width).toBe(26); // Local Time
        expect(ws.getColumn(3).width).toBe(4.5); // 1 EN (Amp)
        expect(ws.getColumn(4).width).toBe(4); // I-00 [1.1-A]
        expect(ws.getColumn(6).width).toBe(4); // O-00 [1.4-1]
        expect(ws.getColumn(8).width).toBe(8); // 110VAC (AO-CH-1)
        expect(ws.getColumn(9).width).toBe(8); // 110VAC (AI-CH-1)

        // Verify header text rotation and alignment
        expect(headerRow.getCell(1).alignment).toEqual({ vertical: 'middle', horizontal: 'center', wrapText: true });
        expect(headerRow.getCell(2).alignment).toEqual({ vertical: 'middle', horizontal: 'center', wrapText: true });
        expect(headerRow.getCell(3).alignment).toEqual({ textRotation: 90, vertical: 'top', horizontal: 'center', wrapText: false });
        expect(headerRow.getCell(4).alignment).toEqual({ textRotation: 90, vertical: 'top', horizontal: 'center', wrapText: false });
        expect(headerRow.getCell(6).alignment).toEqual({ textRotation: 90, vertical: 'top', horizontal: 'center', wrapText: false });
        expect(headerRow.getCell(8).alignment).toEqual({ textRotation: 90, vertical: 'top', horizontal: 'center', wrapText: false });
        expect(headerRow.getCell(9).alignment).toEqual({ textRotation: 90, vertical: 'top', horizontal: 'center', wrapText: false });

        // Verify Data Row (Row 12)
        const dataRow = ws.getRow(12);
        expect(dataRow.getCell(1).value).toBe('00:00:00');
        expect(dataRow.getCell(3).value).toBe('H'); // 1 EN (Amp) is ON -> 'H'
        expect(dataRow.getCell(4).value).toBe('H'); // I-00 [1.1-A] is ON -> 'H'
        expect(dataRow.getCell(5).value).toBe('L'); // I-01 [1.1-B] is OFF -> 'L'
        expect(dataRow.getCell(6).value).toBe('H'); // O-00 [1.4-1] is HIGH -> 'H'
        expect(dataRow.getCell(7).value).toBe('L'); // O-01 [1.4-2] is LOW -> 'L'
        expect(dataRow.getCell(8).value).toBe(2500); // 110VAC (AO-CH-1) numeric
        expect(dataRow.getCell(9).value).toBe(3.42); // 110VAC (AI-CH-1) numeric
        expect(dataRow.getCell(10).value).toBe(8.50); // 110VAC (AI-CH-2) numeric

        // Verify 3-state cell styling (color fill & text)
        const cellH = dataRow.getCell(3);
        expect(cellH.fill).toBeDefined();
        expect(cellH.fill.fgColor.argb).toBe('FFECFDF5');
        expect(cellH.font.color.argb).toBe('FF059669');

        const cellL = dataRow.getCell(5);
        expect(cellL.fill).toBeDefined();
        expect(cellL.fill.fgColor.argb).toBe('FFFAFBFC');
        expect(cellL.font.color.argb).toBe('FF9CA3AF');

        // Verify write buffer creation
        const buffer = await wb.xlsx.writeBuffer();
        expect(buffer).toBeDefined();
        expect(buffer.byteLength).toBeGreaterThan(1000);
    });

    test('formatDashboardAsExcel accurately captures continuous multi-sample recording with fault logging', async () => {
        const metadata = {
            mpcs_serial_number: 'MPCS-REC-900',
            loco_number: 'WDG4-20000',
            tested_by: 'Inspector Fault',
            tester_id: 'TECH-FLT'
        };

        const sessionInfo = {
            id: 88,
            start_time: '2026-08-18T10:00:00Z',
            end_time: '2026-08-18T10:00:03Z',
            total_samples: 3
        };

        const samples = [
            {
                sample_index: 0,
                timestamp: '2026-08-18T10:00:00Z',
                data: {
                    controls: [{ label: '1 EN (Amp)', value: 1, state: 'ON' }],
                    digitalInputs: [{ label: 'I-00 [1.1-A]', value: 0, state: 'OFF', confirmationState: 'SYNCED' }],
                    digitalOutputs: [{ label: 'O-00 [1.4-1]', value: 0, state: 'LOW' }],
                    analogOutputs: [{ label: '110VAC (AO-CH-1)', value: 1000, percentage: '10.0%', formatted: '1000 (10.0%)' }],
                    analogInputs: [{ label: '110VAC (AI-CH-1)', value: 1.25, formatted: '1.25' }]
                }
            },
            {
                sample_index: 1,
                timestamp: '2026-08-18T10:00:01Z',
                data: {
                    controls: [{ label: '1 EN (Amp)', value: 1, state: 'ON' }],
                    digitalInputs: [{ label: 'I-00 [1.1-A]', value: 1, state: 'ON', confirmationState: 'FAULT' }],
                    digitalOutputs: [{ label: 'O-00 [1.4-1]', value: 1, state: 'HIGH' }],
                    analogOutputs: [{ label: '110VAC (AO-CH-1)', value: 2000, percentage: '20.0%', formatted: '2000 (20.0%)' }],
                    analogInputs: [{ label: '110VAC (AI-CH-1)', value: 2.50, formatted: '2.50' }]
                }
            },
            {
                sample_index: 2,
                timestamp: '2026-08-18T10:00:02Z',
                data: {
                    controls: [{ label: '1 EN (Amp)', value: 1, state: 'ON' }],
                    digitalInputs: [{ label: 'I-00 [1.1-A]', value: 1, state: 'ON', confirmationState: 'FAULT' }],
                    digitalOutputs: [{ label: 'O-00 [1.4-1]', value: 1, state: 'HIGH' }],
                    analogOutputs: [{ label: '110VAC (AO-CH-1)', value: 3000, percentage: '30.0%', formatted: '3000 (30.0%)' }],
                    analogInputs: [{ label: '110VAC (AI-CH-1)', value: 3.75, formatted: '3.75' }]
                }
            }
        ];

        const wb = await generateExcelWorkbook({ metadata, sessionInfo, samples });
        expect(wb).toBeDefined();

        expect(wb.worksheets.length).toBe(1);
        const ws = wb.getWorksheet('data');
        expect(ws).toBeDefined();

        // Verify status reflects fault detected and report type is Recording
        expect(ws.getCell('A8').value).toBe('Report Type');
        expect(ws.getCell('B8').value).toBe('Recording');
        expect(ws.getCell('A9').value).toBe('System Status');
        expect(ws.getCell('B9').value).toBe('FAULT DETECTED');

        // Verify 3 sample rows in Telemetry Matrix starting at Row 12
        const r1 = ws.getRow(12);
        expect(r1.getCell(1).value).toBe('00:00:00');
        expect(r1.getCell(4).value).toBe('L'); // I-00 sample 0 is OFF
        expect(r1.getCell(5).value).toBe('L'); // O-00 sample 0 is LOW

        const r2 = ws.getRow(13);
        expect(r2.getCell(1).value).toBe('00:00:01');
        expect(r2.getCell(4).value).toBe('H'); // I-00 sample 1 is ON
        expect(r2.getCell(5).value).toBe('H'); // O-00 sample 1 is HIGH

        const r3 = ws.getRow(14);
        expect(r3.getCell(1).value).toBe('00:00:02');
        expect(r3.getCell(6).value).toBe(3000); // 110VAC (AO-CH-1) sample 2
        expect(r3.getCell(7).value).toBe(3.75); // 110VAC (AI-CH-1) sample 2
    });
});
