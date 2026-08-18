function transformModbusToSVGState(val) {
    return val === 1 ? { state: 'ON', color: 'green' } : { state: 'OFF', color: 'red' };
}

function formatSVGText(val) {
    return Number(val).toFixed(2);
}

function handleDiscreteFallback(val) {
    return (val === 0 || val === 1) ? 'VALID' : 'ERROR_FALLBACK';
}

const stateManager = {
    state: { ui: 'OFF', hardware: 'OFF' }
};

module.exports = {
    transformModbusToSVGState,
    formatSVGText,
    handleDiscreteFallback,
    stateManager
};
