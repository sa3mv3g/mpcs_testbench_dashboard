/**
 * dashboard-exporter.js
 *
 * Provides label-centric extraction, 3-State signal normalization,
 * and Executive Read-Only Excel (.xlsx) workbook generation with sheet protection
 * for Manual Dashboard v2.
 * Compatible with both Node.js (Jest tests / Electron main) and browser renderer execution.
 */

let ExcelJS;
if (typeof require !== 'undefined') {
    try {
        ExcelJS = require('exceljs');
    } catch (e) {}
}
if (!ExcelJS && typeof window !== 'undefined' && window.ExcelJS) {
    ExcelJS = window.ExcelJS;
}

const FOOTER_BRANDING = "Generated using: www.aics.co.in MPCS Testbench v2";

/**
 * 3-State Digital Signal Representation
 * 'H' = High / Active (1 / ON)
 * 'L' = Low / Inactive (0 / OFF)
 * ' ' = Disconnected / Unknown / Offline / Standby (single space or blank)
 */
function to3State(val, state) {
    if (state === '--' || state === ' ' || state === 'UNKNOWN' || state === 'OFFLINE' || state === 'STANDBY') {
        return ' ';
    }
    if (state === 'ON' || state === 'HIGH' || state === 'H') {
        return 'H';
    }
    if (state === 'OFF' || state === 'LOW' || state === 'L') {
        return 'L';
    }
    if (val === '--' || val === null || val === undefined || val === ' ' || val === 'UNKNOWN' || val === 'OFFLINE' || val === 'STANDBY') {
        return ' ';
    }
    if (val === 1 || val === true || val === '1' || val === 'ON' || val === 'HIGH' || val === 'H') {
        return 'H';
    }
    if (val === 0 || val === false || val === '0' || val === 'OFF' || val === 'LOW' || val === 'L') {
        return 'L';
    }
    return ' ';
}

const format3State = to3State;

const AO_DEFAULT_LABELS = {
    1: '110VAC (AO-CH-1)',
    2: '5A AC (AO-CH-2)',
    3: '4-20mA (AO-CH-3)',
    4: '0-10V (AO-CH-4)'
};

const AI_DEFAULT_LABELS = {
    1: '110VAC (AI-CH-1)',
    2: '110VAC (AI-CH-2)',
    3: '5A AC (AI-CH-3)',
    4: '5A AC (AI-CH-4)',
    5: '0-10V (AI-CH-5)',
    6: '0-10V (AI-CH-6)',
    7: '4-20mA (AI-CH-7)',
    8: '4-20mA (AI-CH-8)'
};

/**
 * Get the standardized signal label for any Manual Dashboard v2 GUI identifier
 */
function getDefaultSignalLabel(guiId) {
    if (!guiId) return 'UNKNOWN';

    // en_amp-1
    if (guiId === 'en_amp-1') return '1 EN (Amp)';

    // do-{devId}-{index} (index 0..15) -> MPCS Digital Inputs I-00 to I-127
    const doMatch = guiId.match(/^do-(\d+)-(\d+)$/);
    if (doMatch) {
        const devId = parseInt(doMatch[1], 10);
        const i = parseInt(doMatch[2], 10);
        const letter = i < 8 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + (i - 8));
        const subCard = i < 8 ? `${devId}.1` : `${devId}.2`;
        const bitNum = String((devId - 1) * 16 + i).padStart(2, '0');
        return `I-${bitNum} [${subCard}-${letter}]`;
    }

    // di-{devId}-{addr} -> MPCS Digital Outputs O-00 to O-63
    const diMatch = guiId.match(/^di-(\d+)-(\d+)$/);
    if (diMatch) {
        const devId = parseInt(diMatch[1], 10);
        const addr = parseInt(diMatch[2], 10);
        const diMap = {
            23: 1,
            17: 2,
            22: 3,
            16: 4,
            21: 5,
            20: 6,
            19: 7,
            18: 8
        };
        const pos = diMap[addr] || (addr >= 16 ? addr - 15 : 1);
        const outBit = String((devId - 1) * 8 + (pos - 1)).padStart(2, '0');
        return `O-${outBit} [${devId}.4-${pos}]`;
    }

    // ao-{devId}-{addr}
    const aoMatch = guiId.match(/^ao-(\d+)-(\d+)$/);
    if (aoMatch) {
        const devId = parseInt(aoMatch[1], 10);
        return AO_DEFAULT_LABELS[devId] || `AO-CH-${devId}`;
    }

    // ai-{devId}-{addr}
    const aiMatch = guiId.match(/^ai-(\d+)-(\d+)$/);
    if (aiMatch) {
        const devId = parseInt(aiMatch[1], 10);
        const addr = parseInt(aiMatch[2], 10);
        const ch = addr === 4 ? (devId - 1) * 2 + 1 : (devId - 1) * 2 + 2;
        return AI_DEFAULT_LABELS[ch] || `AI-CH-${ch}`;
    }

    return guiId;
}

/**
 * Format date to clean local string: YYYY-MM-DD HH:MM:SS
 */
function formatLocalDate(dateInput) {
    const d = dateInput ? new Date(dateInput) : new Date();
    if (isNaN(d.getTime())) return "N/A";
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Format duration in seconds to HH:MM:SS
 */
function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

/**
 * Normalize snapshot/sample data into label-centric functional groups
 */
function normalizeSnapshotData(input) {
    if (!input) {
        return { digitalOutputs: [], digitalInputs: [], analogOutputs: [], analogInputs: [], controls: [], labels: {} };
    }
    const data = input.data || input;

    // 1. Direct label-centric format
    if (data.digitalOutputs || data.digitalInputs || data.analogOutputs || data.analogInputs || data.controls || data.signals) {
        const digitalOutputs = data.digitalOutputs || (data.signals && data.signals.digitalOutputs) || [];
        const digitalInputs = data.digitalInputs || (data.signals && data.signals.digitalInputs) || [];
        const analogOutputs = data.analogOutputs || (data.signals && data.signals.analogOutputs) || [];
        const analogInputs = data.analogInputs || (data.signals && data.signals.analogInputs) || [];
        const controls = data.controls || (data.signals && data.signals.controls) || (data.enableAmp ? [data.enableAmp] : []);
        const labels = data.labels || {};
        return { digitalOutputs, digitalInputs, analogOutputs, analogInputs, controls, labels };
    }

    // 2. Legacy controller-centric structure adapter
    if (Array.isArray(data.controllers)) {
        const digitalOutputs = [];
        const digitalInputs = [];
        const analogOutputs = [];
        const analogInputs = [];
        const controls = [];
        const labels = {};

        data.controllers.forEach(ctrl => {
            if (ctrl.enableAmp) {
                const en = ctrl.enableAmp;
                const label = en.label || `${ctrl.name || 'Ctrl'} 1 EN (Amp)`;
                const val = en.value;
                const state = val === '--' ? '--' : (val ? 'ON' : 'OFF');
                controls.push({ label, value: val, state, guiId: en.guiId || `en_amp-${ctrl.id}` });
                labels[label] = state;
            }

            (ctrl.digitalOutputs || []).forEach((d, idx) => {
                const label = d.label || `${ctrl.name || `Ctrl ${ctrl.id}`} I-${idx}`;
                const val = d.value;
                const state = val === '--' ? '--' : (val ? 'ON' : 'OFF');
                const isDI = label.startsWith('I-') || (d.guiId && d.guiId.startsWith('do-'));
                const targetList = isDI ? digitalInputs : digitalOutputs;
                targetList.push({
                    label,
                    value: val,
                    state,
                    confirmationState: d.confirmationState || 'SYNCED',
                    guiId: d.guiId
                });
                labels[label] = state;
            });

            (ctrl.digitalInputs || []).forEach((d, idx) => {
                const label = d.label || `${ctrl.name || `Ctrl ${ctrl.id}`} O-${idx}`;
                const val = d.value;
                const state = val === '--' ? '--' : (val ? 'HIGH' : 'LOW');
                const isDO = label.startsWith('O-') || (d.guiId && d.guiId.startsWith('di-'));
                const targetList = isDO ? digitalOutputs : digitalInputs;
                targetList.push({
                    label,
                    value: val,
                    state,
                    guiId: d.guiId
                });
                labels[label] = state;
            });

            (ctrl.analogOutputs || []).forEach((a, idx) => {
                const devId = ctrl.id || idx + 1;
                const label = a.label || AO_DEFAULT_LABELS[devId] || `AO-CH-${devId}`;
                const val = a.value;
                const percentage = a.percentage || (typeof val === 'number' ? (val / 100).toFixed(1) + '%' : String(val));
                const formatted = `${val} (${percentage})`;
                analogOutputs.push({
                    label,
                    value: val,
                    percentage,
                    formatted,
                    confirmationState: a.confirmationState || 'SYNCED',
                    guiId: a.guiId
                });
                labels[label] = percentage;
            });

            (ctrl.analogInputs || []).forEach((a, idx) => {
                const ch = idx + 1;
                const label = a.label || AI_DEFAULT_LABELS[ch] || `AI-CH-${ch}`;
                const val = a.value;
                const formatted = typeof val === 'number' ? val.toFixed(2) : String(val);
                analogInputs.push({
                    label,
                    value: val,
                    formatted,
                    guiId: a.guiId
                });
                labels[label] = formatted;
            });
        });

        return { digitalOutputs, digitalInputs, analogOutputs, analogInputs, controls, labels };
    }

    // 3. Simple dictionary of labels: { labels: { 'MV-1': 'ON', ... } }
    if (data.labels && typeof data.labels === 'object') {
        const digitalOutputs = [];
        const digitalInputs = [];
        const analogOutputs = [];
        const analogInputs = [];
        const controls = [];
        const labels = data.labels;

        Object.entries(labels).forEach(([label, val]) => {
            const isEN = label.includes('EN') || label.includes('ENABLE');
            const isAO = label.includes('AO') || label.includes('THROTTLE') || label.includes('DAC');
            const isAI = label.includes('AI') || label.includes('PRESS') || label.includes('TEMP') || label.includes('BAP') || label.includes('MR');
            const isDI = !isAI && (label.startsWith('I-') || label.includes('DI') || /\[[1-8](?:\.|0)[12]-/.test(label) || label.includes('REV') || label.includes('FOR'));
            const isDO = !isAO && (label.startsWith('O-') || label.includes('DO') || /\[[1-8](?:\.|0)4-/.test(label) || label.includes('MV-') || label.includes('EP-'));

            if (isEN) {
                const state = val === '--' ? '--' : (val === 1 || val === true || val === 'ON' ? 'ON' : 'OFF');
                controls.push({ label, value: val, state });
            } else if (isDI) {
                const state = val === '--' ? '--' : (val === 1 || val === true || val === 'HIGH' || val === 'ON' ? 'HIGH' : 'LOW');
                digitalInputs.push({ label, value: val, state, confirmationState: 'SYNCED' });
            } else if (isDO) {
                const state = val === '--' ? '--' : (val === 1 || val === true || val === 'ON' || val === 'HIGH' ? 'ON' : 'OFF');
                digitalOutputs.push({ label, value: val, state });
            } else if (isAO) {
                analogOutputs.push({ label, value: val, formatted: String(val), confirmationState: 'SYNCED' });
            } else if (isAI) {
                analogInputs.push({ label, value: val, formatted: String(val) });
            }
        });

        return {
            digitalOutputs,
            digitalInputs,
            analogOutputs,
            analogInputs,
            controls,
            labels
        };
    }

    return { digitalOutputs: [], digitalInputs: [], analogOutputs: [], analogInputs: [], controls: [], labels: {} };
}

/**
 * Analyze controller connectivity and overall system health from snapshot data
 */
function analyzeSystemControllers(snapshotData) {
    const { digitalOutputs, digitalInputs, analogOutputs, analogInputs, controls } = normalizeSnapshotData(snapshotData);
    
    const ctrlMap = {};
    for (let i = 1; i <= 8; i++) {
        ctrlMap[i] = { online: false, activeSignals: 0, totalSignals: 0 };
    }

    let hasFault = false;

    function checkSignal(guiId, label, val, confState) {
        if (confState === 'FAULT' || confState === 'MISMATCH') {
            hasFault = true;
        }
        let devId = 1;
        if (guiId) {
            const m = guiId.match(/-(\d+)-/) || guiId.match(/-(\d+)$/);
            if (m) devId = parseInt(m[1], 10);
        } else if (label) {
            const m = label.match(/^([1-8])(?:\.|0)[124]-/) || label.match(/\[([1-8])(?:\.|0)[124]-/) || label.match(/AO-CH-([1-8])/) || label.match(/AO-([1-8])/) || label.match(/^([1-8]) EN/);
            if (m) {
                devId = parseInt(m[1], 10);
            } else {
                const aiM = label.match(/AI-CH-([1-8])/);
                if (aiM) {
                    const ch = parseInt(aiM[1], 10);
                    devId = Math.ceil(ch / 2);
                }
            }
        }
        if (devId >= 1 && devId <= 8) {
            ctrlMap[devId].totalSignals++;
            if (val !== '--' && val !== null && val !== undefined) {
                ctrlMap[devId].online = true;
            }
            if (val === 1 || val === true || val === 'ON' || val === 'HIGH' || (typeof val === 'number' && val > 0)) {
                ctrlMap[devId].activeSignals++;
            }
        }
    }

    controls.forEach(c => checkSignal(c.guiId, c.label, c.value));
    digitalInputs.forEach(d => checkSignal(d.guiId, d.label, d.value, d.confirmationState));
    digitalOutputs.forEach(d => checkSignal(d.guiId, d.label, d.value, d.confirmationState));
    analogOutputs.forEach(a => checkSignal(a.guiId, a.label, a.value, a.confirmationState));
    analogInputs.forEach(a => checkSignal(a.guiId, a.label, a.value));

    const onlineDevs = Object.keys(ctrlMap).map(Number).filter(id => ctrlMap[id].online);
    if (onlineDevs.length === 0 && (digitalOutputs.length || digitalInputs.length || analogOutputs.length || analogInputs.length || controls.length)) {
        ctrlMap[1].online = true;
        onlineDevs.push(1);
    }

    const offlineDevs = Object.keys(ctrlMap).map(Number).filter(id => !ctrlMap[id].online);

    return {
        onlineControllers: onlineDevs.length ? onlineDevs : [1],
        offlineControllers: offlineDevs,
        activeCount: onlineDevs.length ? onlineDevs.length : 1,
        totalControllers: 8,
        hasFault
    };
}

/**
 * Compute chronological deltas and state transitions between consecutive 1 Hz samples
 */
function computeTelemetryDeltas(samples) {
    if (!Array.isArray(samples) || samples.length < 2) {
        return [];
    }

    const deltas = [];

    for (let i = 1; i < samples.length; i++) {
        const prev = normalizeSnapshotData(samples[i - 1]);
        const curr = normalizeSnapshotData(samples[i]);
        const sampleIdx = samples[i].sample_index != null ? samples[i].sample_index : i;
        const time = formatDuration(sampleIdx);

        // 1. Controls (Enables)
        const prevCtrls = new Map((prev.controls || []).map(c => [c.label || c.guiId, c]));
        (curr.controls || []).forEach(currC => {
            const label = currC.label || currC.guiId;
            const prevC = prevCtrls.get(label);
            if (prevC) {
                const prevVal = prevC.value;
                const currVal = currC.value;
                if (prevVal !== currVal || prevC.state !== currC.state) {
                    const prevStr = prevC.state || (prevVal ? 'ON' : 'OFF');
                    const currStr = currC.state || (currVal ? 'ON' : 'OFF');
                    deltas.push({
                        sampleIndex: sampleIdx,
                        time,
                        category: 'CONTROL',
                        signalLabel: label,
                        from: prevStr,
                        to: currStr,
                        transition: `${prevStr} -> ${currStr}`,
                        note: currVal ? 'System Enable Engaged' : 'System Enable Disengaged',
                        isFault: false
                    });
                }
            }
        });

        // 2. Digital Inputs (MPCS I-xx, testbench DO switches)
        const prevDIs = new Map((prev.digitalInputs || []).map(d => [d.label || d.guiId, d]));
        (curr.digitalInputs || []).forEach(currD => {
            const label = currD.label || currD.guiId;
            const prevD = prevDIs.get(label);
            if (prevD) {
                const prevVal = prevD.value;
                const currVal = currD.value;
                const prevConf = prevD.confirmationState || 'SYNCED';
                const currConf = currD.confirmationState || 'SYNCED';

                const valChanged = prevVal !== currVal;
                const confChanged = prevConf !== currConf;

                if (valChanged || confChanged) {
                    const prevStr = prevVal === '--' ? '--' : (prevVal ? '1 (HIGH)' : '0 (LOW)');
                    const currStr = currVal === '--' ? '--' : (currVal ? '1 (HIGH)' : '0 (LOW)');
                    
                    let note = 'DI Command Confirmed';
                    let isFault = false;
                    if (currConf === 'FAULT') {
                        note = 'DI Communication Fault Detected';
                        isFault = true;
                    } else if (currConf === 'MISMATCH') {
                        note = 'DI Feedback Mismatch';
                        isFault = true;
                    } else if (currVal && !prevVal) {
                        note = 'DI Energized (HIGH)';
                    } else if (!currVal && prevVal) {
                        note = 'DI De-energized (LOW)';
                    }

                    deltas.push({
                        sampleIndex: sampleIdx,
                        time,
                        category: 'DI',
                        signalLabel: label,
                        from: prevStr,
                        to: currStr,
                        transition: `${prevStr} -> ${currStr}`,
                        note,
                        isFault
                    });
                }
            }
        });

        // 3. Digital Outputs (MPCS O-xx, testbench DI sensors)
        const prevDOs = new Map((prev.digitalOutputs || []).map(d => [d.label || d.guiId, d]));
        (curr.digitalOutputs || []).forEach(currD => {
            const label = currD.label || currD.guiId;
            const prevD = prevDOs.get(label);
            if (prevD) {
                const prevVal = prevD.value;
                const currVal = currD.value;
                if (prevVal !== currVal) {
                    const prevStr = prevVal === '--' ? '--' : (prevVal ? '1 (HIGH)' : '0 (LOW)');
                    const currStr = currVal === '--' ? '--' : (currVal ? '1 (HIGH)' : '0 (LOW)');
                    const note = currVal ? 'DO Output Active (HIGH)' : 'DO Output Inactive (LOW)';
                    deltas.push({
                        sampleIndex: sampleIdx,
                        time,
                        category: 'DO',
                        signalLabel: label,
                        from: prevStr,
                        to: currStr,
                        transition: `${prevStr} -> ${currStr}`,
                        note,
                        isFault: false
                    });
                }
            }
        });

        // 4. Analog Outputs
        const prevAOs = new Map((prev.analogOutputs || []).map(a => [a.label || a.guiId, a]));
        (curr.analogOutputs || []).forEach(currA => {
            const label = currA.label || currA.guiId;
            const prevA = prevAOs.get(label);
            if (prevA) {
                const prevFmt = prevA.formatted || `${prevA.value} (${prevA.percentage || ''})`;
                const currFmt = currA.formatted || `${currA.value} (${currA.percentage || ''})`;
                if (prevA.value !== currA.value || prevFmt !== currFmt || prevA.confirmationState !== currA.confirmationState) {
                    const isFault = currA.confirmationState === 'FAULT';
                    deltas.push({
                        sampleIndex: sampleIdx,
                        time,
                        category: 'AO',
                        signalLabel: label,
                        from: prevFmt,
                        to: currFmt,
                        transition: `${prevFmt} -> ${currFmt}`,
                        note: isFault ? 'AO Fault Detected' : 'AO Setpoint Adjusted',
                        isFault
                    });
                }
            }
        });

        // 5. Analog Inputs
        const prevAIs = new Map((prev.analogInputs || []).map(a => [a.label || a.guiId, a]));
        (curr.analogInputs || []).forEach(currA => {
            const label = currA.label || currA.guiId;
            const prevA = prevAIs.get(label);
            if (prevA) {
                const prevValNum = typeof prevA.value === 'number' ? prevA.value : parseFloat(prevA.value);
                const currValNum = typeof currA.value === 'number' ? currA.value : parseFloat(currA.value);
                const prevFmt = prevA.formatted || String(prevA.value);
                const currFmt = currA.formatted || String(currA.value);

                const changed = (isNaN(prevValNum) || isNaN(currValNum))
                    ? prevFmt !== currFmt
                    : Math.abs(currValNum - prevValNum) >= 0.01;

                if (changed) {
                    deltas.push({
                        sampleIndex: sampleIdx,
                        time,
                        category: 'AI',
                        signalLabel: label,
                        from: prevFmt,
                        to: currFmt,
                        transition: `${prevFmt} -> ${currFmt}`,
                        note: 'AI Telemetry Reading Delta',
                        isFault: false
                    });
                }
            }
        });

        // 6. Generic labels dictionary fallback
        if (!curr.digitalOutputs.length && !curr.digitalInputs.length && !curr.analogOutputs.length && !curr.analogInputs.length) {
            const prevLabels = prev.labels || {};
            const currLabels = curr.labels || {};
            Object.keys(currLabels).forEach(key => {
                if (prevLabels[key] !== undefined && prevLabels[key] !== currLabels[key]) {
                    deltas.push({
                        sampleIndex: sampleIdx,
                        time,
                        category: 'SIGNAL',
                        signalLabel: key,
                        from: String(prevLabels[key]),
                        to: String(currLabels[key]),
                        transition: `${prevLabels[key]} -> ${currLabels[key]}`,
                        note: 'Signal State Transition',
                        isFault: false
                    });
                }
            });
        }
    }

    return deltas;
}


/**
 * Extract live Manual Dashboard v2 state from DOM document as label-centric data
 */
function extractManualDashboardData(doc, devices = [], testMetadata = {}) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    const timestamp = new Date().toISOString();
    const localTime = formatLocalDate(timestamp);

    const digitalOutputs = [];
    const digitalInputs = [];
    const analogOutputs = [];
    const analogInputs = [];
    const controls = [];
    const labels = {};

    function getLabel(el, fallback) {
        if (el && typeof el.closest === 'function') {
            const widget = el.closest('.v2-widget');
            if (widget) {
                const lblSpan = widget.querySelector('.v2-widget-label');
                if (lblSpan && lblSpan.textContent) {
                    return lblSpan.textContent.trim().replace(/\s+/g, ' ');
                }
            }
        }
        return fallback;
    }

    // Enable switch (Controller 1)
    const enEl = root ? root.getElementById('en_amp-1') : null;
    const enLabel = getLabel(enEl, getDefaultSignalLabel('en_amp-1'));
    const enVal = enEl ? (enEl.value ? 1 : 0) : 0;
    const enState = enVal ? 'ON' : 'OFF';
    controls.push({
        guiId: 'en_amp-1',
        label: enLabel,
        value: enVal,
        state: enState
    });
    labels[enLabel] = enState;

    // 128 MPCS Digital Inputs (I-00 to I-127, 16 per controller across 8 controllers)
    for (let devId = 1; devId <= 8; devId++) {
        for (let i = 0; i < 16; i++) {
            const guiId = `do-${devId}-${i}`;
            const el = root ? root.getElementById(guiId) : null;
            const fbDot = root ? root.getElementById(`do-fb-${devId}-${i}`) : null;
            let confState = 'SYNCED';
            if (fbDot) {
                if (fbDot.classList.contains('fault')) confState = 'FAULT';
                else if (fbDot.classList.contains('mismatch')) confState = 'MISMATCH';
                else if (fbDot.classList.contains('pending')) confState = 'PENDING';
            }

            const label = getLabel(el, getDefaultSignalLabel(guiId));
            const val = el ? (el.value ? 1 : 0) : 0;
            const state = val === '--' ? '--' : (val ? 'ON' : 'OFF');

            digitalInputs.push({
                guiId,
                label,
                value: val,
                state,
                confirmationState: confState
            });
            labels[label] = state;
        }
    }

    // 64 MPCS Digital Outputs (O-00 to O-63, 8 per controller across 8 controllers)
    const diAddresses = [23, 17, 22, 16, 21, 20, 19, 18];
    for (let devId = 1; devId <= 8; devId++) {
        for (const addr of diAddresses) {
            const guiId = `di-${devId}-${addr}`;
            const el = root ? root.getElementById(guiId) : null;
            const label = getLabel(el, getDefaultSignalLabel(guiId));
            const val = el ? (el.value ? 1 : 0) : 0;
            const state = val === '--' ? '--' : (val ? 'HIGH' : 'LOW');

            digitalOutputs.push({
                guiId,
                label,
                value: val,
                state
            });
            labels[label] = state;
        }
    }

    // 4 Analog Outputs (Controllers 1-4)
    for (let devId = 1; devId <= 4; devId++) {
        const guiId = `ao-${devId}-0`;
        const el = root ? root.getElementById(guiId) : null;
        const fbDot = root ? root.getElementById(`ao-fb-${devId}-0`) : null;
        let confState = 'SYNCED';
        if (fbDot) {
            if (fbDot.classList.contains('fault')) confState = 'FAULT';
            else if (fbDot.classList.contains('mismatch')) confState = 'MISMATCH';
            else if (fbDot.classList.contains('pending')) confState = 'PENDING';
        }

        const label = getLabel(el, getDefaultSignalLabel(guiId));
        const rawVal = el ? Math.round(Number(el.value) || 0) : 0;
        const percentage = (rawVal / 100).toFixed(1) + '%';
        const formatted = `${rawVal} (${percentage})`;

        analogOutputs.push({
            guiId,
            label,
            value: rawVal,
            percentage,
            formatted,
            confirmationState: confState
        });
        labels[label] = percentage;
    }

    // 8 Analog Inputs (Controllers 1-4)
    for (let devId = 1; devId <= 4; devId++) {
        const elAi1 = root ? root.getElementById(`ai-${devId}-4`) : null;
        const elAi2 = root ? root.getElementById(`ai-${devId}-6`) : null;

        const labelAi1 = getLabel(elAi1, getDefaultSignalLabel(`ai-${devId}-4`));
        const labelAi2 = getLabel(elAi2, getDefaultSignalLabel(`ai-${devId}-6`));

        const val1 = elAi1 ? (parseFloat(elAi1.value) || 0.0) : 0.0;
        const val2 = elAi2 ? (parseFloat(elAi2.value) || 0.0) : 0.0;

        analogInputs.push({
            guiId: `ai-${devId}-4`,
            label: labelAi1,
            value: val1,
            formatted: val1.toFixed(2)
        });
        labels[labelAi1] = val1.toFixed(2);

        analogInputs.push({
            guiId: `ai-${devId}-6`,
            label: labelAi2,
            value: val2,
            formatted: val2.toFixed(2)
        });
        labels[labelAi2] = val2.toFixed(2);
    }

    return {
        timestamp,
        localTime,
        metadata: {
            mpcs_serial_number: testMetadata.mpcs_serial_number || 'N/A',
            loco_number: testMetadata.loco_number || 'N/A',
            tested_by: testMetadata.tested_by || 'N/A',
            tester_id: testMetadata.tester_id || 'N/A'
        },
        digitalOutputs,
        digitalInputs,
        analogOutputs,
        analogInputs,
        controls,
        labels,
        signals: {
            digitalOutputs,
            digitalInputs,
            analogOutputs,
            analogInputs,
            controls
        }
    };
}

/**
 * Get canonical matrix column definitions from normalized snapshot data
 */
function getMatrixColumns(baseData) {
    const norm = normalizeSnapshotData(baseData);

    const controls = (norm.controls && norm.controls.length > 0)
        ? norm.controls.map((c, i) => ({
            colId: norm.controls.length === 1 ? 'EN' : `EN${i + 1}`,
            key: c.guiId || c.label,
            guiId: c.guiId,
            label: c.label || (norm.controls.length === 1 ? '1 EN (Amp)' : `EN-${i + 1}`),
            type: 'CONTROL',
            index: i + 1
        }))
        : [];

    const digitalInputs = (norm.digitalInputs && norm.digitalInputs.length > 0)
        ? norm.digitalInputs.map((d, i) => {
            const num = i;
            const numStr = String(num).padStart(2, '0');
            return {
                colId: `DI${numStr}`,
                numStr,
                key: d.guiId || d.label,
                guiId: d.guiId,
                label: d.label || `I-${numStr}`,
                type: 'DI',
                index: num
            };
        })
        : [];

    const digitalOutputs = (norm.digitalOutputs && norm.digitalOutputs.length > 0)
        ? norm.digitalOutputs.map((d, i) => {
            const num = i;
            const numStr = String(num).padStart(2, '0');
            return {
                colId: `DO${numStr}`,
                numStr,
                key: d.guiId || d.label,
                guiId: d.guiId,
                label: d.label || `O-${numStr}`,
                type: 'DO',
                index: num
            };
        })
        : [];

    const analogOutputs = (norm.analogOutputs && norm.analogOutputs.length > 0)
        ? norm.analogOutputs.map((a, i) => {
            const num = i + 1;
            return {
                colId: `AO-${num}`,
                key: a.guiId || a.label,
                guiId: a.guiId,
                label: a.label || AO_DEFAULT_LABELS[num] || `AO-CH-${num}`,
                type: 'AO',
                index: num
            };
        })
        : [];

    const analogInputs = (norm.analogInputs && norm.analogInputs.length > 0)
        ? norm.analogInputs.map((a, i) => {
            const num = i + 1;
            return {
                colId: `AI-${num}`,
                key: a.guiId || a.label,
                guiId: a.guiId,
                label: a.label || AI_DEFAULT_LABELS[num] || `AI-CH-${num}`,
                type: 'AI',
                index: num
            };
        })
        : [];

    return { controls, digitalInputs, digitalOutputs, analogOutputs, analogInputs };
}


/**
 * Format dashboard data as an Executive Read-Only Protected Excel (.xlsx) Workbook
 */
async function formatDashboardAsExcel({ metadata = {}, sessionInfo = null, samples = [], snapshot = null, workbook = null }) {
    const ExcelLib = workbook ? null : (ExcelJS || (typeof require !== 'undefined' ? require('exceljs') : null));
    if (!workbook && !ExcelLib) {
        throw new Error("ExcelJS library is not available. Please install 'exceljs'.");
    }

    const wb = workbook || new ExcelLib.Workbook();
    wb.creator = 'www.aics.co.in MPCS Testbench v2';
    wb.lastModifiedBy = metadata.tested_by || 'MPCS Operator';
    wb.created = new Date();
    wb.modified = new Date();

    const isRecording = !!(sessionInfo && samples && samples.length > 1);
    const sampleList = isRecording
        ? samples
        : (samples && samples.length >= 1 ? samples : [snapshot || {}]);

    const baseData = normalizeSnapshotData(sampleList[0]);
    const matrixCols = getMatrixColumns(baseData);
    const ctrlHealth = analyzeSystemControllers(baseData);
    const deltas = isRecording ? computeTelemetryDeltas(samples) : [];
    const faultCount = deltas.filter(d => d.isFault).length + (ctrlHealth.hasFault ? 1 : 0);
    const isHealthy = faultCount === 0;

    const mpcsSn = metadata.mpcs_serial_number || 'N/A';
    const locoNo = metadata.loco_number || 'N/A';
    const testedBy = metadata.tested_by || 'N/A';
    const testerId = metadata.tester_id || 'N/A';
    const generatedLocal = formatLocalDate(new Date());
    const totalSamples = sampleList.length;
    const durationStr = isRecording ? formatDuration(totalSamples) : 'Instantaneous Snapshot';
    const startTimeStr = sessionInfo ? formatLocalDate(sessionInfo.start_time || sessionInfo.startTime) : generatedLocal;

    // Palette Colors (ARGB format for ExcelJS)
    const NAVY_DARK = { argb: 'FF0B2545' };
    const NAVY_LIGHT = { argb: 'FF134074' };
    const WHITE = { argb: 'FFFFFFFF' };
    const GRAY_LIGHT = { argb: 'FFF8FAFC' };
    const GRAY_BORDER = { argb: 'FFE2E8F0' };
    const GREEN_PASS = { argb: 'FF166534' };
    const GREEN_BG = { argb: 'FFDCFCE7' };
    const RED_FAULT = { argb: 'FF991B1B' };
    const RED_BG = { argb: 'FFFEE2E2' };

    const STATE_H_BG = { argb: 'FFECFDF5' };
    const STATE_H_TEXT = { argb: 'FF059669' };
    const STATE_L_BG = { argb: 'FFFAFBFC' };
    const STATE_L_TEXT = { argb: 'FF9CA3AF' };
    const STATE_OFFLINE_TEXT = { argb: 'FFCBD5E1' };

    const thinBorder = {
        top: { style: 'thin', color: GRAY_BORDER },
        left: { style: 'thin', color: GRAY_BORDER },
        bottom: { style: 'thin', color: GRAY_BORDER },
        right: { style: 'thin', color: GRAY_BORDER }
    };

    // ==========================================
    // SINGLE WORKSHEET: 'data'
    // ==========================================
    const ws = wb.addWorksheet('data', {
        properties: { tabColor: { argb: 'FF134074' } },
        views: [{ state: 'frozen', xSplit: 1, ySplit: 11 }]
    });

    // Columns Definition: Time (Elapsed), Local Time, 1 EN (Amp), I-xx [subCard-letter] (DI), O-xx [subCard-pos] (DO), 110VAC (AO-CH-1), 110VAC (AI-CH-1)
    const matrixHeaders = [
        { header: 'Time (Elapsed)', key: 'time_elapsed', width: 22 },
        { header: 'Local Time', key: 'local_time', width: 26 }
    ];

    matrixCols.controls.forEach(c => {
        matrixHeaders.push({ header: c.label || '1 EN (Amp)', key: `ctrl_${c.colId}`, width: 4.5 });
    });

    matrixCols.digitalInputs.forEach(d => {
        matrixHeaders.push({ header: d.label, key: `di_${d.colId}`, width: 4 });
    });

    matrixCols.digitalOutputs.forEach(d => {
        matrixHeaders.push({ header: d.label, key: `do_${d.colId}`, width: 4 });
    });

    matrixCols.analogOutputs.forEach(a => {
        matrixHeaders.push({ header: a.label, key: `ao_${a.colId}`, width: 8 });
    });

    matrixCols.analogInputs.forEach(a => {
        matrixHeaders.push({ header: a.label, key: `ai_${a.colId}`, width: 8 });
    });

    // Apply column widths to worksheet
    matrixHeaders.forEach((colDef, idx) => {
        const col = ws.getColumn(idx + 1);
        col.width = colDef.width;
        col.key = colDef.key;
    });

    // ==========================================
    // TOP SECTION: TEST PROVENANCE & IDENTIFICATION (Rows 1-9)
    // ==========================================
    // Row 1: Title Header (Merged strictly till Column S: A1:S1 / Columns 1 through 19)
    const bannerEndCol = 19;
    ws.mergeCells(1, 1, 1, bannerEndCol);
    for (let c = 1; c <= bannerEndCol; c++) {
        const cell = ws.getRow(1).getCell(c);
        cell.font = { name: 'Arial', size: 11, bold: true, color: WHITE };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: NAVY_DARK };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = thinBorder;
    }
    const titleCell = ws.getCell('A1');
    titleCell.value = 'MPCS TESTBENCH - MANUAL DASHBOARD V2 TELEMETRY REPORT';
    ws.getRow(1).height = 26;

    // Rows 2-9: Key-Value Identification Grid (Strictly Columns A & B)
    const provGrid = [
        ['MPCS Serial Number', mpcsSn],
        ['LOCO Number', locoNo],
        ['Tested By', testedBy],
        ['Tester ID', testerId],
        ['Date & Time', startTimeStr],
        ['Test Duration', durationStr],
        ['Report Type', isRecording ? 'Recording' : 'Snapshot'],
        ['System Status', isHealthy ? 'NORMAL / PASS' : 'FAULT DETECTED']
    ];

    provGrid.forEach((row, idx) => {
        const rowNum = 2 + idx;
        const rowObj = ws.getRow(rowNum);

        // Key (Col A)
        rowObj.getCell(1).value = row[0];
        rowObj.getCell(1).font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF334155' } };
        rowObj.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: GRAY_LIGHT };
        rowObj.getCell(1).border = thinBorder;
        rowObj.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

        // Value (Col B)
        rowObj.getCell(2).value = row[1];
        rowObj.getCell(2).font = { name: 'Arial', size: 9.5, bold: row[0].includes('Serial') };
        rowObj.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: WHITE };
        rowObj.getCell(2).border = thinBorder;
        rowObj.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };

        if (row[0] === 'System Status') {
            rowObj.getCell(2).font = { name: 'Arial', size: 9.5, bold: true, color: isHealthy ? GREEN_PASS : RED_FAULT };
            rowObj.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: isHealthy ? GREEN_BG : RED_BG };
        }

        rowObj.height = 20;
    });

    // Row 10: Blank row separator
    ws.getRow(10).height = 15;

    // ==========================================
    // BOTTOM SECTION: TELEMETRY MATRIX TABLE (Row 11 onwards)
    // ==========================================
    // Row 11: Header Row
    const headRow = ws.getRow(11);
    headRow.height = 100;
    matrixHeaders.forEach((colDef, idx) => {
        const cell = headRow.getCell(idx + 1);
        cell.value = colDef.header;
        cell.font = { name: 'Arial', size: 9, bold: true, color: WHITE };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: NAVY_LIGHT };
        cell.border = thinBorder;

        if (idx === 0 || idx === 1) {
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        } else {
            cell.alignment = { textRotation: 90, vertical: 'top', horizontal: 'center', wrapText: false };
        }
    });

    // Enable AutoFilter on Row 11
    ws.autoFilter = {
        from: { row: 11, column: 1 },
        to: { row: 11, column: matrixHeaders.length }
    };

    // Populate Data Rows starting at Row 12 (1 per second / sample)
    sampleList.forEach((sample, sIdx) => {
        const norm = normalizeSnapshotData(sample);
        const timeElapsed = formatDuration(sample.sample_index != null ? sample.sample_index : sIdx);
        const sampleLocalTime = formatLocalDate(sample.timestamp || new Date(Date.now() + sIdx * 1000));

        const rowData = [timeElapsed, sampleLocalTime];

        // Controls
        const ctrlMap = new Map((norm.controls || []).map(c => [c.guiId || c.label, c]));
        matrixCols.controls.forEach((col, idx) => {
            const c = ctrlMap.get(col.key) || (norm.controls && norm.controls[idx]);
            const st = to3State(c ? c.value : null, c ? c.state : null);
            rowData.push(st);
        });

        // Digital Inputs
        const diMap = new Map((norm.digitalInputs || []).map(d => [d.guiId || d.label, d]));
        matrixCols.digitalInputs.forEach((col, idx) => {
            const d = diMap.get(col.key) || (norm.digitalInputs && norm.digitalInputs[idx]);
            const st = to3State(d ? d.value : null, d ? d.state : null);
            rowData.push(st);
        });

        // Digital Outputs
        const doMap = new Map((norm.digitalOutputs || []).map(d => [d.label || d.guiId, d]));
        matrixCols.digitalOutputs.forEach((col, idx) => {
            const d = doMap.get(col.key) || (norm.digitalOutputs && norm.digitalOutputs[idx]);
            const st = to3State(d ? d.value : null, d ? d.state : null);
            rowData.push(st);
        });

        // Analog Outputs
        const aoMap = new Map((norm.analogOutputs || []).map(a => [a.label || a.guiId, a]));
        matrixCols.analogOutputs.forEach((col, idx) => {
            const a = aoMap.get(col.key) || (norm.analogOutputs && norm.analogOutputs[idx]);
            const val = a ? a.value : null;
            if (val === '--' || val === null || val === undefined) {
                rowData.push('');
            } else {
                const num = typeof val === 'number' ? Math.round(val) : parseFloat(val);
                rowData.push(isNaN(num) ? val : num);
            }
        });

        // Analog Inputs
        const aiMap = new Map((norm.analogInputs || []).map(a => [a.label || a.guiId, a]));
        matrixCols.analogInputs.forEach((col, idx) => {
            const a = aiMap.get(col.key) || (norm.analogInputs && norm.analogInputs[idx]);
            const val = a ? a.value : null;
            if (val === '--' || val === null || val === undefined) {
                rowData.push('');
            } else {
                const num = typeof val === 'number' ? val : parseFloat(val);
                rowData.push(isNaN(num) ? val : Number(num.toFixed(2)));
            }
        });

        const rowNum = 12 + sIdx;
        const newRow = ws.getRow(rowNum);
        rowData.forEach((val, colIdx) => {
            newRow.getCell(colIdx + 1).value = val;
        });
        newRow.height = 19;

        // Apply 3-State Visual Styling to each cell
        newRow.eachCell((cell, colNumber) => {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.font = { name: 'Arial', size: 9 };
            cell.border = thinBorder;

            if (colNumber === 1 || colNumber === 2) {
                cell.font = { name: 'Consolas', size: 9, bold: colNumber === 1 };
                return;
            }

            const val = cell.value;
            if (val === 'H') {
                cell.font = { name: 'Arial', size: 9, bold: true, color: STATE_H_TEXT };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: STATE_H_BG };
            } else if (val === 'L') {
                cell.font = { name: 'Arial', size: 9, color: STATE_L_TEXT };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: STATE_L_BG };
            } else if (val === ' ' || val === '') {
                cell.font = { name: 'Arial', size: 9, color: STATE_OFFLINE_TEXT };
            } else if (typeof val === 'number') {
                cell.font = { name: 'Consolas', size: 9 };
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            }
        });
    });

    // Protect Worksheet (read-only locking with selection permitted)
    await ws.protect('aics_readonly', { selectLockedCells: true, selectUnlockedCells: true });

    return wb;
}

// Module export for Node.js / Jest / Main and window export for Renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        to3State,
        format3State,
        getMatrixColumns,
        getDefaultSignalLabel,
        normalizeSnapshotData,
        analyzeSystemControllers,
        computeTelemetryDeltas,
        formatLocalDate,
        formatDuration,
        extractManualDashboardData,
        formatDashboardAsExcel,
        generateExcelWorkbook: formatDashboardAsExcel,
        FOOTER_BRANDING
    };
}
if (typeof window !== 'undefined') {
    window.DashboardExporter = {
        to3State,
        format3State,
        getMatrixColumns,
        getDefaultSignalLabel,
        normalizeSnapshotData,
        analyzeSystemControllers,
        computeTelemetryDeltas,
        formatLocalDate,
        formatDuration,
        extractManualDashboardData,
        formatDashboardAsExcel,
        generateExcelWorkbook: formatDashboardAsExcel,
        FOOTER_BRANDING
    };
}
