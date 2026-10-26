/* =========================================================
   ЯДРО ЭМУЛЯТОРА AVR ATmega328P + SALEAE LOGIC + ИСПРАВЛЕННЫЕ СВЕТОДИОДЫ
   ========================================================= */

const IO = {
    PINB:   0x23, DDRB:   0x24, PORTB:  0x25,
    PINC:   0x26, DDRC:   0x27, PORTC:  0x28,
    PIND:   0x29, DDRD:   0x2A, PORTD:  0x2B,
    PCIFR:  0x3B, EIFR:   0x3C, EIMSK:  0x3D,
    SPL:    0x5D, SPH:    0x5E, SREG:   0x5F,
    PCICR:  0x68, EICRA:  0x69,
    PCMSK0: 0x6B, PCMSK1: 0x6C, PCMSK2: 0x6D,
    UCSR0A: 0xC0, UCSR0B: 0xC1, UCSR0C: 0xC2,
    UBRR0L: 0xC4, UBRR0H: 0xC5, UDR0:   0xC6
};

const IO_OFFSET = 0x20;

let currentLang = 'asm';
let currentFontSize = 14;

const cpu = {
    r: new Uint8Array(32),
    prevR: new Uint8Array(32),
    ram: new Uint8Array(0x0900),
    pc: 0,
    sp: 0x08FF,
    sreg: { C:0, Z:0, N:0, V:0, S:0, H:0, T:0, I:0 },
    cycles: 0,
    running: false,
    timer: null,
    speed: 40,
    program: [],
    labels: {},
    breakpoints: new Set(),
    uartLog: "",
    error: null,
    selectedPort: 'D',
    memView: 'ram',
    memFormat: 'hex',
    prevPinB: 0xFF,
    prevPinC: 0xFF,
    prevPinD: 0xFF
};

const CYCLES = {
    jmp: 3, call: 4, ret: 4, reti: 4, lds: 2, sts: 2, 
    lpm: 3, adiw: 2, sbiw: 2, icall: 4, ijmp: 2
};

const vButtons = [
    { id: 'K1', port: 'D', pin: 2, pressed: false },
    { id: 'K2', port: 'D', pin: 3, pressed: false },
    { id: 'K3', port: 'D', pin: 4, pressed: false },
    { id: 'K4', port: 'B', pin: 0, pressed: false },
    { id: 'K5', port: 'B', pin: 1, pressed: false },
    { id: 'K6', port: 'B', pin: 2, pressed: false },
    { id: 'K7', port: 'B', pin: 3, pressed: false },
    { id: 'K8', port: 'B', pin: 4, pressed: false }
];

/* ================= ВКЛАДКИ И ШРИФТ ================= */

const activePanels = {
    editor: true,
    board: true,
    analyzer: true,
    prog: true,
    cpu: false
};

function togglePanel(panelName) {
    const activeCount = Object.values(activePanels).filter(Boolean).length;
    if (activePanels[panelName] && activeCount <= 1) return;

    activePanels[panelName] = !activePanels[panelName];

    const panelElem = document.getElementById(`panel_${panelName}`);
    const tabBtn = document.getElementById(`tabBtn_${panelName}`);

    if (panelElem && tabBtn) {
        panelElem.classList.toggle('panel-hidden', !activePanels[panelName]);
        tabBtn.classList.toggle('active', activePanels[panelName]);
    }

    if (panelName === 'analyzer' && activePanels.analyzer) {
        setTimeout(resizeAnalyzerCanvas, 50);
    }
}

function changeFontSize(delta) {
    currentFontSize = Math.min(24, Math.max(10, currentFontSize + delta));
    const newLineHeight = Math.round(currentFontSize * 1.55);
    document.documentElement.style.setProperty('--code-font-size', currentFontSize + 'px');
    document.documentElement.style.setProperty('--line-height', newLineHeight + 'px');
    document.getElementById('fontSizeVal').textContent = currentFontSize + 'px';
    renderGutter();
}

/* ================= ОСЦИЛЛОГРАФ ================= */

const ALL_CHANNELS = [
    { id: 'PD0', port: 'D', pin: 0, label: 'PD0 (RX)', color: '#38bdf8' },
    { id: 'PD1', port: 'D', pin: 1, label: 'PD1 (TX)', color: '#06b6d4' },
    { id: 'PD2', port: 'D', pin: 2, label: 'PD2 (INT0)', color: '#3b82f6' },
    { id: 'PD3', port: 'D', pin: 3, label: 'PD3 (INT1)', color: '#6366f1' },
    { id: 'PD4', port: 'D', pin: 4, label: 'PD4', color: '#8b5cf6' },
    { id: 'PD5', port: 'D', pin: 5, label: 'PD5', color: '#a855f7' },
    { id: 'PD6', port: 'D', pin: 6, label: 'PD6', color: '#d946ef' },
    { id: 'PD7', port: 'D', pin: 7, label: 'PD7', color: '#ec4899' },
    { id: 'PB0', port: 'B', pin: 0, label: 'PB0 (K4)', color: '#f43f5e' },
    { id: 'PB1', port: 'B', pin: 1, label: 'PB1 (K5)', color: '#fb7185' },
    { id: 'PB2', port: 'B', pin: 2, label: 'PB2 (K6)', color: '#f97316' },
    { id: 'PB3', port: 'B', pin: 3, label: 'PB3 (K7)', color: '#fb923c' },
    { id: 'PB4', port: 'B', pin: 4, label: 'PB4 (K8)', color: '#facc15' },
    { id: 'PB5', port: 'B', pin: 5, label: 'PB5 (LED L)', color: '#eab308' },
    { id: 'PC0', port: 'C', pin: 0, label: 'PC0', color: '#84cc16' },
    { id: 'PC1', port: 'C', pin: 1, label: 'PC1', color: '#22c55e' },
    { id: 'PC2', port: 'C', pin: 2, label: 'PC2', color: '#10b981' },
    { id: 'PC3', port: 'C', pin: 3, label: 'PC3', color: '#14b8a6' },
    { id: 'PC4', port: 'C', pin: 4, label: 'PC4', color: '#2dd4bf' },
    { id: 'PC5', port: 'C', pin: 5, label: 'PC5', color: '#38bdf8' }
];

let selectedChannelIds = new Set(['PD2', 'PD3', 'PD0', 'PD1', 'PB5', 'PB0']);

const analyzer = {
    capturing: true,
    zoom: 1.0,
    maxSamples: 1500,
    samples: []
};

function renderChannelSelector() {
    const container = document.getElementById('analyzerChannelSelector');
    if (!container) return;
    container.innerHTML = ALL_CHANNELS.map(ch => {
        const active = selectedChannelIds.has(ch.id);
        const style = active ? `border-color:${ch.color}; color:${ch.color};` : '';
        return `<span class="ch-badge ${active ? 'active' : ''}" style="${style}" onclick="toggleChannel('${ch.id}')">${ch.label}</span>`;
    }).join('');
}

function toggleChannel(chId) {
    if (selectedChannelIds.has(chId)) {
        if (selectedChannelIds.size > 1) selectedChannelIds.delete(chId);
    } else {
        selectedChannelIds.add(chId);
    }
    renderChannelSelector();
    resizeAnalyzerCanvas();
}

function selectChannelPreset(type) {
    if (type === 'd') selectedChannelIds = new Set(['PD0','PD1','PD2','PD3','PD4','PD5','PD6','PD7']);
    else if (type === 'b') selectedChannelIds = new Set(['PB0','PB1','PB2','PB3','PB4','PB5']);
    else if (type === 'c') selectedChannelIds = new Set(['PC0','PC1','PC2','PC3','PC4','PC5']);
    else if (type === 'all') selectedChannelIds = new Set(ALL_CHANNELS.map(c => c.id));
    renderChannelSelector();
    resizeAnalyzerCanvas();
}

function toggleAnalyzerCapture() {
    analyzer.capturing = !analyzer.capturing;
    const btn = document.getElementById('btnAnalyzerCapture');
    if (btn) {
        btn.classList.toggle('active', analyzer.capturing);
        btn.textContent = analyzer.capturing ? '🔴 Запись' : '⏸ Пауза';
    }
}

function clearAnalyzer() {
    analyzer.samples = [];
    recordAnalyzerSample();
    drawLogicAnalyzer();
}

function zoomAnalyzer(delta) {
    if (delta > 0 && analyzer.zoom < 8) analyzer.zoom *= 1.5;
    if (delta < 0 && analyzer.zoom > 0.4) analyzer.zoom /= 1.5;
    document.getElementById('analyzerZoomVal').textContent = analyzer.zoom.toFixed(1) + 'x';
    drawLogicAnalyzer();
}

function recordAnalyzerSample() {
    const pind = readRAM(IO.PIND), ddrd = readRAM(IO.DDRD), portd = readRAM(IO.PORTD);
    const pinb = readRAM(IO.PINB), ddrb = readRAM(IO.DDRB), portb = readRAM(IO.PORTB);
    const pinc = readRAM(IO.PINC), ddrc = readRAM(IO.DDRC), portc = readRAM(IO.PORTC);

    function getPinVal(portLetter, pin) {
        if (portLetter === 'D') return (ddrd & (1 << pin)) ? (portd & (1 << pin)) : (pind & (1 << pin));
        if (portLetter === 'B') return (ddrb & (1 << pin)) ? (portb & (1 << pin)) : (pinb & (1 << pin));
        if (portLetter === 'C') return (ddrc & (1 << pin)) ? (portc & (1 << pin)) : (pinc & (1 << pin));
        return 0;
    }

    const sample = { cycle: cpu.cycles, vals: {} };
    ALL_CHANNELS.forEach(ch => {
        sample.vals[ch.id] = getPinVal(ch.port, ch.pin) ? 1 : 0;
    });

    analyzer.samples.push(sample);
    if (analyzer.samples.length > analyzer.maxSamples) analyzer.samples.shift();
}

function resizeAnalyzerCanvas() {
    const canvas = document.getElementById('logicCanvas');
    const wrapper = document.getElementById('canvasWrapper');
    if (!canvas || !wrapper) return;

    const activeChannels = ALL_CHANNELS.filter(c => selectedChannelIds.has(c.id));
    const trackHeight = 34;
    const requiredH = Math.max(wrapper.clientHeight - 4, activeChannels.length * trackHeight + 25);
    const requiredW = Math.max(wrapper.clientWidth - 4, 600);

    canvas.width = requiredW;
    canvas.height = requiredH;
    canvas.style.width = requiredW + 'px';
    canvas.style.height = requiredH + 'px';

    drawLogicAnalyzer();
}

function drawLogicAnalyzer() {
    const canvas = document.getElementById('logicCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, w, h);

    const activeList = ALL_CHANNELS.filter(c => selectedChannelIds.has(c.id));
    if (activeList.length === 0) return;

    const trackHeight = 34;
    const stepX = 5 * analyzer.zoom;
    const totalVisible = Math.floor((w - 95) / stepX);
    const startIdx = Math.max(0, analyzer.samples.length - totalVisible);

    activeList.forEach((ch, idx) => {
        const baseY = 24 + idx * trackHeight;
        const highY = baseY;
        const lowY  = baseY + trackHeight - 12;

        ctx.strokeStyle = '#151c28';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(90, lowY);
        ctx.lineTo(w, lowY);
        ctx.stroke();

        ctx.fillStyle = ch.color;
        ctx.font = 'bold 12px "Consolas", "Courier New", monospace';
        ctx.fillText(ch.label, 8, lowY - 4);

        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        if (analyzer.samples.length === 0) {
            ctx.moveTo(95, lowY);
            ctx.lineTo(w, lowY);
            ctx.stroke();
            return;
        }

        let prevVal = analyzer.samples[startIdx]?.vals[ch.id] || 0;
        let prevX = 95;
        let prevY = prevVal ? highY : lowY;
        ctx.moveTo(prevX, prevY);

        for (let i = startIdx + 1; i < analyzer.samples.length; i++) {
            const curVal = analyzer.samples[i].vals[ch.id];
            const curX = 95 + (i - startIdx) * stepX;
            const curY = curVal ? highY : lowY;

            if (curVal !== prevVal) {
                ctx.lineTo(curX, prevY);
                ctx.lineTo(curX, curY);
            } else {
                ctx.lineTo(curX, curY);
            }
            prevVal = curVal;
            prevX = curX;
            prevY = curY;
        }
        ctx.stroke();
    });
}

/* ================= КОНСТРУКТОР КАСТОМНЫХ ПИНОВ ================= */

let userComponents = [];

function createUserComponent() {
    const pinVal = document.getElementById('builderPinSelect').value;
    const typeVal = document.getElementById('builderTypeSelect').value;
    const port = pinVal[0];
    const pin = parseInt(pinVal.substring(1), 10);

    userComponents.push({
        id: 'usr_' + Math.random().toString(36).substring(2, 7),
        port, pin, type: typeVal, pressed: false
    });
    renderUserComponents();
    syncHardwareState();
    updateUI();
}

function removeUserComponent(id) {
    userComponents = userComponents.filter(c => c.id !== id);
    renderUserComponents();
    syncHardwareState();
    updateUI();
}

function toggleUserButton(id) {
    const comp = userComponents.find(c => c.id === id);
    if (!comp) return;
    comp.pressed = !comp.pressed;
    const btnElem = document.getElementById('usru_btn_' + id);
    if (btnElem) btnElem.classList.toggle('latched', comp.pressed);

    syncHardwareState();
    checkInterrupts();
    recordAnalyzerSample();
    updateUI();
}

function renderUserComponents() {
    const container = document.getElementById('userComponentsContainer');
    if (!container) return;

    if (userComponents.length === 0) {
        container.innerHTML = `<i style="font-size:0.75em; color:var(--text-muted);">Здесь появятся ваши элементы...</i>`;
        return;
    }

    container.innerHTML = userComponents.map(comp => {
        const pinName = `${comp.port}${comp.pin}`;
        if (comp.type === 'button') {
            return `
                <div class="user-comp-badge">
                    <span>Кнопка [${pinName}]</span>
                    <button type="button" class="v-btn-custom ${comp.pressed ? 'latched' : ''}" id="usru_btn_${comp.id}" onclick="toggleUserButton('${comp.id}')">
                        ${comp.pressed ? 'Зажата (0)' : 'Отжата (1)'}
                    </button>
                    <button type="button" class="btn-del-comp" onclick="removeUserComponent('${comp.id}')">×</button>
                </div>
            `;
        } else {
            return `
                <div class="user-comp-badge">
                    <span>Светодиод [${pinName}]</span>
                    <div class="led-light" id="usr_led_${comp.id}"></div>
                    <button type="button" class="btn-del-comp" onclick="removeUserComponent('${comp.id}')">×</button>
                </div>
            `;
        }
    }).join('');
}

/* ================= ПРЕРЫВАНИЯ ================= */

function checkInterrupts() {
    const curPind = readRAM(IO.PIND);
    const curPinb = readRAM(IO.PINB);
    const eicra = readRAM(IO.EICRA);
    let eifr = readRAM(IO.EIFR);
    let pcifr = readRAM(IO.PCIFR);

    const isc0 = eicra & 0x03;
    const pd2Now = (curPind >> 2) & 1;
    const pd2Prev = (cpu.prevPinD >> 2) & 1;

    if (isc0 === 0 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 1 && pd2Now !== pd2Prev) eifr |= (1 << 0);
    else if (isc0 === 2 && pd2Prev === 1 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 3 && pd2Prev === 0 && pd2Now === 1) eifr |= (1 << 0);

    const isc1 = (eicra >> 2) & 0x03;
    const pd3Now = (curPind >> 3) & 1;
    const pd3Prev = (cpu.prevPinD >> 3) & 1;

    if (isc1 === 0 && pd3Now === 0) eifr |= (1 << 1);
    else if (isc1 === 1 && pd3Now !== pd3Prev) eifr |= (1 << 1);
    else if (isc1 === 2 && pd3Prev === 1 && pd3Now === 0) eifr |= (1 << 1);
    else if (isc1 === 3 && pd3Prev === 0 && pd3Now === 1) eifr |= (1 << 1);

    writeRAM(IO.EIFR, eifr);

    const pcmsk0 = readRAM(IO.PCMSK0);
    const pcmsk2 = readRAM(IO.PCMSK2);
    if ((curPinb ^ cpu.prevPinB) & pcmsk0) pcifr |= (1 << 0);
    if ((curPind ^ cpu.prevPinD) & pcmsk2) pcifr |= (1 << 2);
    writeRAM(IO.PCIFR, pcifr);

    if (cpu.sreg.I === 1) {
        const eimsk = readRAM(IO.EIMSK);
        const pcicr = readRAM(IO.PCICR);

        if ((eimsk & 0x01) && (eifr & 0x01)) {
            writeRAM(IO.EIFR, 1 << 0);
            dispatchInterrupt('__vector_int0', 0x0002);
            return;
        }
        if ((eimsk & 0x02) && (eifr & 0x02)) {
            writeRAM(IO.EIFR, 1 << 1);
            dispatchInterrupt('__vector_int1', 0x0004);
            return;
        }
        if ((pcicr & 0x01) && (pcifr & 0x01)) {
            writeRAM(IO.PCIFR, 1 << 0);
            dispatchInterrupt('__vector_pcint0', 0x0006);
            return;
        }
        if ((pcicr & 0x04) && (pcifr & 0x04)) {
            writeRAM(IO.PCIFR, 1 << 2);
            dispatchInterrupt('__vector_pcint2', 0x000A);
            return;
        }
    }
}

function dispatchInterrupt(vectorLabel, vectorAddr) {
    pushStack(cpu.pc & 0xFF);
    pushStack((cpu.pc >> 8) & 0xFF);
    cpu.sreg.I = 0;

    if (cpu.labels[vectorLabel] !== undefined) {
        cpu.pc = cpu.labels[vectorLabel];
    } else if (cpu.program[vectorAddr]) {
        cpu.pc = vectorAddr;
    }
}

/* ================= СИ-ТРАНСЛЯТОР ================= */

const AVR_CONSTS = {
    ISC00: 0, ISC01: 1, ISC10: 2, ISC11: 3,
    INT0: 0, INT1: 1, PCIE0: 0, PCIE1: 1, PCIE2: 2,
    PORTD0: 0, PORTD1: 1, PORTD2: 2, PORTD3: 3, PORTD4: 4, PORTD5: 5, PORTD6: 6, PORTD7: 7,
    PORTB0: 0, PORTB1: 1, PORTB2: 2, PORTB3: 3, PORTB4: 4, PORTB5: 5, PORTB6: 6, PORTB7: 7,
    PORTC0: 0, PORTC1: 1, PORTC2: 2, PORTC3: 3, PORTC4: 4, PORTC5: 5, PORTC6: 6, PORTC7: 7,
    PIND0: 0, PIND1: 1, PIND2: 2, PIND3: 3, PIND4: 4, PIND5: 5, PIND6: 6, PIND7: 7,
    PINB0: 0, PINB1: 1, PINB2: 2, PINB3: 3, PINB4: 4, PINB5: 5, PINB6: 6, PINB7: 7,
    PINC0: 0, PINC1: 1, PINC2: 2, PINC3: 3, PINC4: 4, PINC5: 5, PINC6: 6, PINC7: 7,
    DDD0: 0, DDD1: 1, DDD2: 2, DDD3: 3, DDD4: 4, DDD5: 5, DDD6: 6, DDD7: 7,
    DDB0: 0, DDB1: 1, DDB2: 2, DDB3: 3, DDB4: 4, DDB5: 5, DDB6: 6, DDB7: 7,
    DDC0: 0, DDC1: 1, DDC2: 2, DDC3: 3, DDC4: 4, DDC5: 5, DDC6: 6, DDC7: 7,
    PD0: 0, PD1: 1, PD2: 2, PD3: 3, PD4: 4, PD5: 5, PD6: 6, PD7: 7,
    PB0: 0, PB1: 1, PB2: 2, PB3: 3, PB4: 4, PB5: 5, PB6: 6, PB7: 7,
    PC0: 0, PC1: 1, PC2: 2, PC3: 3, PC4: 4, PC5: 5, PC6: 6, PC7: 7
};

function evaluateCExpression(expr, defines) {
    if (!expr) return null;
    expr = expr.trim();
    if (defines) {
        for (const [k, v] of Object.entries(defines)) expr = expr.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
    }
    for (const [k, v] of Object.entries(AVR_CONSTS)) {
        expr = expr.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
    }
    expr = expr.replace(/UL|U|L/gi, '');
    try {
        return Function(`'use strict'; return (${expr});`)();
    } catch (e) {
        return null;
    }
}

function scaleThreshold(val) {
    if (val >= 10000) return Math.max(5, Math.round(val / 20000));
    return Math.min(255, Math.max(0, val));
}

function compileCToAsm(cCode) {
    let code = cCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    code = code.replace(/_delay_ms\s*\(\s*([0-9]+)\s*\)\s*;/g, (match, ms) => {
        let loops = Math.max(1, Math.round(parseInt(ms, 10) * 5));
        return `for(int __d=0; __d<${loops}; __d++);`;
    });

    code = code.replace(/\{/g, '\n{\n')
               .replace(/\}/g, '\n}\n')
               .replace(/;/g, ';\n');

    const rawLines = code.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const asmList = [];
    let regCounter = 17;
    const varMap = {};
    let labelCounter = 1;
    const controlStack = [];
    const defines = {};
    const globalInits = [];
    let insideMain = false;

    let mainLineNum = 1;
    for (let i = 0; i < rawLines.length; i++) {
        if (rawLines[i].includes('main(')) { mainLineNum = i + 1; break; }
    }

    for (let i = 0; i < rawLines.length; i++) {
        const defMatch = rawLines[i].match(/^#define\s+([a-zA-Z0-9_]+)\s+(.+)$/);
        if (defMatch) defines[defMatch[1]] = defMatch[2].replace(/UL|U|L/gi, '').trim();
    }

    function applyDefines(str) {
        for (const [k, v] of Object.entries(defines)) str = str.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
        return str;
    }

    function checkNextLineIsElse(startIdx) {
        for (let j = startIdx + 1; j < rawLines.length; j++) {
            let l = rawLines[j];
            if (!l) continue;
            return l.startsWith('else');
        }
        return false;
    }

    asmList.push({ asm: '.include "m328pdef.inc"', lineNum: mainLineNum });
    asmList.push({ asm: 'rjmp __main', lineNum: mainLineNum });

    for (let i = 0; i < rawLines.length; i++) {
        let line = rawLines[i];
        const lineNum = i + 1;

        if (!line || line.startsWith('#')) continue;

        const isrMatch = line.match(/ISR\s*\(\s*([a-zA-Z0-9_]+)\s*\)/);
        if (isrMatch) {
            const vName = isrMatch[1];
            let lbl = '__vector_default';
            if (vName.includes('INT0')) lbl = '__vector_int0';
            else if (vName.includes('INT1')) lbl = '__vector_int1';
            else if (vName.includes('PCINT0')) lbl = '__vector_pcint0';
            else if (vName.includes('PCINT2')) lbl = '__vector_pcint2';

            asmList.push({ asm: `${lbl}:`, lineNum });
            asmList.push({ asm: 'in r16, SREG', lineNum });
            asmList.push({ asm: 'push r16', lineNum });
            controlStack.push({ type: 'isr' });
            continue;
        }

        if (line.includes('int main(void)') || line.includes('void main()') || line === 'main()') {
            insideMain = true;
            asmList.push({ asm: '__main:', lineNum });
            for (let init of globalInits) asmList.push(init);
            continue;
        }

        if (line.includes('sei()')) { asmList.push({ asm: 'sei', lineNum }); continue; }
        if (line.includes('cli()')) { asmList.push({ asm: 'cli', lineNum }); continue; }

        if (line === '}' || line.startsWith('}')) {
            if (controlStack.length > 0) {
                const top = controlStack[controlStack.length - 1];

                if (top.type === 'if') {
                    if (checkNextLineIsElse(i) || line.includes('else')) {
                        asmList.push({ asm: `rjmp ${top.lblEnd}`, lineNum });
                        asmList.push({ asm: `${top.lblFalse}:`, lineNum });
                        top.type = 'else';
                    } else {
