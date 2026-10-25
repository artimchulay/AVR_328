/* =========================================================
   ЯДРО ЭМУЛЯТОРА AVR ATmega328P + SALEAE LOGIC + ИСПРАВЛЕННЫЙ ВЛОЖЕННЫЙ C
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
    board: false,
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


/* ================= СИ-ТРАНСЛЯТОР (С НАДЕЖНЫМ ВЛОЖЕНИЕМ IF-ELSE) ================= */
/* ================= ГЛАВА 4: ТРАНСЛЯТОР MICRO-C ================= */

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
    // 1. Очистка от комментариев
    let code = cCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // 2. Препроцессинг: разделение склеенных команд и фигурных скобок
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

    // Поиск строки с main
    let mainLineNum = 1;
    for (let i = 0; i < rawLines.length; i++) {
        if (rawLines[i].includes('main(')) { mainLineNum = i + 1; break; }
    }

    // Сбор констант #define
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

        // Обработка прерываний ISR
        const isrMatch = line.match(/ISR\s*\(\s*([a-zA-Z0-9_]+)\s*\)/);
        if (isrMatch) {
            const vName = isrMatch[1];
            let lbl = '__vector_default';
            if (vName.includes('INT0')) lbl = '__vector_int0';
            else if (vName.includes('INT1')) lbl = '__vector_int1';
            else if (vName.includes('PCINT0')) lbl = '__vector_pcint0';
            else if (vName.includes('PCINT2')) lbl = '__vector_pcint2';

            asmList.push({ asm: `${lbl}:`, lineNum });
            controlStack.push({ type: 'isr' });
            continue;
        }

        // Вход в main
        if (line.includes('main(')) {
            insideMain = true;
            asmList.push({ asm: '__main:', lineNum });
            for (let init of globalInits) asmList.push(init);
            continue;
        }

        if (line.includes('sei()')) { asmList.push({ asm: 'sei', lineNum }); continue; }
        if (line.includes('cli()')) { asmList.push({ asm: 'cli', lineNum }); continue; }

        // Закрывающие скобки }
        if (line === '}' || line.startsWith('}')) {
            if (controlStack.length > 0) {
                const top = controlStack[controlStack.length - 1];

                if (top.type === 'if') {
                    if (checkNextLineIsElse(i) || line.includes('else')) {
                        asmList.push({ asm: `rjmp ${top.lblEnd}`, lineNum });
                        asmList.push({ asm: `${top.lblFalse}:`, lineNum });
                        top.type = 'else';
                    } else {
                        controlStack.pop();
                        asmList.push({ asm: `${top.lblFalse}:`, lineNum });
                        asmList.push({ asm: `${top.lblEnd}:`, lineNum });
                    }
                } else if (top.type === 'else') {
                    controlStack.pop();
                    asmList.push({ asm: `${top.lblEnd}:`, lineNum });
                } else if (top.type === 'while') {
                    controlStack.pop();
                    asmList.push({ asm: `rjmp ${top.startLbl}`, lineNum });
                } else if (top.type === 'isr') {
                    controlStack.pop();
                    asmList.push({ asm: 'reti', lineNum });
                }
            }
            continue;
        }

        if (line.startsWith('else')) {
            line = line.substring(4).trim();
            if (!line || line === '{') continue;
        }

        if (line === '{') continue;

        // Объявление переменных (int x; uint32_t x = 0;)
        const declMatch = line.match(/\b(uint8_t|int8_t|uint16_t|int16_t|uint32_t|int)\s+([a-zA-Z0-9_]+)(\s*=\s*([^;]+))?;/);
        if (declMatch) {
            const varName = declMatch[2];
            let initVal = declMatch[4] ? declMatch[4].trim() : "0";
            const reg = 'r' + (regCounter++);
            varMap[varName] = { reg };
            let constVal = evaluateCExpression(applyDefines(initVal), defines);
            if (constVal !== null) {
                constVal = scaleThreshold(constVal);
                const inst = { asm: `ldi ${reg}, ${constVal & 0xFF}`, lineNum };
                if (!insideMain) globalInits.push(inst);
                else asmList.push(inst);
            }
            continue;
        }

        // Регистры |=
        const portOrMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC|PCICR|EICRA|EIMSK)\s*\|\=\s*([^;]+);/);
        if (portOrMatch) {
            const portName = portOrMatch[1];
            const mask = evaluateCExpression(applyDefines(portOrMatch[2]), defines) & 0xFF;
            asmList.push({ asm: `in r16, ${portName}`, lineNum });
            asmList.push({ asm: `ori r16, ${mask}`, lineNum });
            asmList.push({ asm: `out ${portName}, r16`, lineNum });
            continue;
        }

        // Регистры &= ~
        const portAndNotMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC)\s*&\=\s*~\s*\(?\s*([^;]+)\)?;/);
        if (portAndNotMatch) {
            const portName = portAndNotMatch[1];
            const mask = evaluateCExpression(applyDefines(portAndNotMatch[2].replace(/\)+$/, '')), defines) & 0xFF;
            const invMask = (~mask) & 0xFF;
            asmList.push({ asm: `in r16, ${portName}`, lineNum });
            asmList.push({ asm: `andi r16, ${invMask}`, lineNum });
            asmList.push({ asm: `out ${portName}, r16`, lineNum });
            continue;
        }

        // Регистры ^=
        const portXorMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD)\s*\^\=\s*([^;]+);/);
        if (portXorMatch) {
            const portName = portXorMatch[1];
            const mask = evaluateCExpression(applyDefines(portXorMatch[2]), defines) & 0xFF;
            asmList.push({ asm: `in r16, ${portName}`, lineNum });
            asmList.push({ asm: `ldi r17, ${mask}`, lineNum });
            asmList.push({ asm: `eor r16, r17`, lineNum });
            asmList.push({ asm: `out ${portName}, r16`, lineNum });
            continue;
        }

        // ПРИСВАИВАНИЕ ПОРТУ: PORTD = 0xFF; ИЛИ PORTD = x; ИЛИ PORTD = x & 0x0F;
        const portAssignMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC|EICRA|EIMSK|PCICR|PCMSK0|PCMSK2)\s*=\s*([^;]+);/);
        if (portAssignMatch) {
            const portName = portAssignMatch[1];
            let expr = applyDefines(portAssignMatch[2].trim());

            if (expr.includes('&')) {
                // Пример: PORTD = x & 0xC0;
                const parts = expr.split('&');
                const vName = parts[0].trim();
                const mask = evaluateCExpression(applyDefines(parts[1]), defines);
                if (varMap[vName]) {
                    asmList.push({ asm: `mov r16, ${varMap[vName].reg}`, lineNum });
                    asmList.push({ asm: `andi r16, ${(mask !== null ? mask : 0xFF) & 0xFF}`, lineNum });
                    asmList.push({ asm: `out ${portName}, r16`, lineNum });
                }
            } else {
                const constVal = evaluateCExpression(expr, defines);
                if (constVal !== null) {
                    // Пример: DDRD = 0xFF;
                    asmList.push({ asm: `ldi r16, ${constVal & 0xFF}`, lineNum });
                    asmList.push({ asm: `out ${portName}, r16`, lineNum });
                } else if (varMap[expr]) {
                    // Пример: PORTD = x; (ВЫВОД ПЕРЕМЕННОЙ В ПОРТ)
                    asmList.push({ asm: `out ${portName}, ${varMap[expr].reg}`, lineNum });
                }
            }
            continue;
        }

        // Присваивание переменной (flag = 1; x = 0;)
        const varAssignMatch = line.match(/\b([a-zA-Z0-9_]+)\s*=\s*([^;]+);/);
        if (varAssignMatch) {
            const vName = varAssignMatch[1];
            if (varMap[vName]) {
                let constVal = evaluateCExpression(applyDefines(varAssignMatch[2]), defines);
                if (constVal !== null) {
                    constVal = scaleThreshold(constVal);
                    asmList.push({ asm: `ldi ${varMap[vName].reg}, ${constVal & 0xFF}`, lineNum });
                } else if (varMap[varAssignMatch[2].trim()]) {
                    asmList.push({ asm: `mov ${varMap[vName].reg}, ${varMap[varAssignMatch[2].trim()].reg}`, lineNum });
                }
            }
            continue;
        }

        // Инкремент (x++;)
        const incMatch = line.match(/\b([a-zA-Z0-9_]+)\+\+;/);
        if (incMatch && varMap[incMatch[1]]) {
            asmList.push({ asm: `inc ${varMap[incMatch[1]].reg}`, lineNum });
            continue;
        }

        // while (1)
        if (line.startsWith('while') && line.includes('1')) {
            const startLbl = `while_start_${labelCounter++}`;
            asmList.push({ asm: `${startLbl}:`, lineNum });
            controlStack.push({ type: 'while', startLbl });
            continue;
        }

        // if с кнопкой
        let ifBtnMatch = line.match(/if\s*\(\s*!\s*\(\s*(PINB|PIND)\s*&\s*\(\s*1\s*<<\s*([^)]+)\)\s*\)\s*\)/);
        if (ifBtnMatch) {
            const pinPort = ifBtnMatch[1];
            const bit = evaluateCExpression(applyDefines(ifBtnMatch[2]), defines);
            const lblFalse = `lbl_false_${labelCounter++}`;
            const lblEnd = `lbl_end_${labelCounter++}`;
            asmList.push({ asm: `in r16, ${pinPort}`, lineNum });
            asmList.push({ asm: `sbrc r16, ${bit}`, lineNum });
            asmList.push({ asm: `rjmp ${lblFalse}`, lineNum });
            controlStack.push({ type: 'if', lblFalse, lblEnd });
            continue;
        }

        // if со сравнением: if (x==800000) или if (flag==0)
        const ifCmpMatch = line.match(/if\s*\(\s*([a-zA-Z0-9_]+)\s*(==|!=|>=|>|<=|<)\s*([^)]+)\)/);
        if (ifCmpMatch) {
            const vName = ifCmpMatch[1];
            const op = ifCmpMatch[2];
            let rawCmp = applyDefines(ifCmpMatch[3]);
            let cmpVal = evaluateCExpression(rawCmp, defines);

            if (cmpVal !== null && varMap[vName]) {
                cmpVal = scaleThreshold(cmpVal);
                const lblFalse = `lbl_false_${labelCounter++}`;
                const lblEnd = `lbl_end_${labelCounter++}`;

                asmList.push({ asm: `cpi ${varMap[vName].reg}, ${cmpVal & 0xFF}`, lineNum });
                if (op === '==')      asmList.push({ asm: `brne ${lblFalse}`, lineNum });
                else if (op === '!=') asmList.push({ asm: `breq ${lblFalse}`, lineNum });
                else if (op === '>=') asmList.push({ asm: `brlo ${lblFalse}`, lineNum });
                else if (op === '<')  asmList.push({ asm: `brsh ${lblFalse}`, lineNum });
                else if (op === '>')  asmList.push({ asm: `brls ${lblFalse}`, lineNum });
                else if (op === '<=') asmList.push({ asm: `brhi ${lblFalse}`, lineNum });

                controlStack.push({ type: 'if', lblFalse, lblEnd });
                continue;
            }
        }
    }

    while (controlStack.length > 0) {
        const top = controlStack.pop();
        if (top.type === 'while') asmList.push({ asm: `rjmp ${top.startLbl}`, lineNum: rawLines.length });
        else if (top.type === 'if') {
            asmList.push({ asm: `${top.lblFalse}:`, lineNum: rawLines.length });
            asmList.push({ asm: `${top.lblEnd}:`, lineNum: rawLines.length });
        } else if (top.type === 'else') {
            asmList.push({ asm: `${top.lblEnd}:`, lineNum: rawLines.length });
        } else if (top.type === 'isr') {
            asmList.push({ asm: 'reti', lineNum: rawLines.length });
        }
    }

    return asmList;
}

/* ================= ПАРСЕР АССЕМБЛЕРА ================= */

function parseProgram(text) {
    cpu.program = [];
    cpu.labels = {};
    cpu.error = null;
    if (!text) return;
    text = text.replace(/\r/g, '');

    if (currentLang === 'c') {
        const compiled = compileCToAsm(text);
        let instIndex = 0;
        for (let item of compiled) {
            let line = item.asm.trim();
            if (line.includes(':')) {
                const parts = line.split(':');
                cpu.labels[parts[0].trim().toLowerCase()] = instIndex;
                line = parts.slice(1).join(':').trim();
                if (!line) continue;
            }
            const tokens = line.split(/\s+/);
            const op = tokens[0].toLowerCase();
            const argsStr = line.substring(tokens[0].length).trim();
            const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];
            cpu.program.push({ op, args, lineNum: item.lineNum, raw: line });
            instIndex++;
        }
        return;
    }

    const lines = text.split('\n');
    let instIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const semi = line.indexOf(';');
        const slash = line.indexOf('//');
        let idx = -1;
        if (semi !== -1 && slash !== -1) idx = Math.min(semi, slash);
        else if (semi !== -1) idx = semi;
        else if (slash !== -1) idx = slash;
        if (idx !== -1) line = line.substring(0, idx);
        line = line.trim();
        if (!line) continue;

        if (line.toLowerCase().startsWith('.org')) {
            const orgVal = parseVal(line.substring(4).trim());
            while (instIndex < orgVal) {
                cpu.program.push({ op: 'nop', args: [], lineNum: i + 1, raw: 'nop' });
                instIndex++;
            }
            continue;
        }

        if (line.includes(':')) {
            const parts = line.split(':');
            cpu.labels[parts[0].trim().toLowerCase()] = instIndex;
            line = parts.slice(1).join(':').trim();
            if (!line) continue;
        }

        if (line.startsWith('.')) continue;

        const tokens = line.split(/\s+/);
        const op = tokens[0].toLowerCase();
        const argsStr = line.substring(tokens[0].length).trim();
        const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];

        if (op === 'ldi' && args.length >= 1) {
            const regNum = parseReg(args[0]);
            if (regNum < 16) {
                cpu.error = `Строка ${i + 1}: LDI работает только с R16..R31 (R${regNum} недопустим)`;
            }
        }

        cpu.program.push({ op, args, lineNum: i + 1, raw: line });
        instIndex++;
    }
}

function parseReg(arg) {
    if (!arg) return 0;
    arg = arg.trim().toLowerCase();
    const aliases = { 'xl': 26, 'xh': 27, 'yl': 28, 'yh': 29, 'zl': 30, 'zh': 31 };
    if (aliases[arg] !== undefined) return aliases[arg];
    const clean = arg.replace(/[^0-9]/g, '');
    return Math.min(31, Math.max(0, parseInt(clean, 10) || 0));
}

function parseVal(arg) {
    if (!arg) return 0;
    arg = arg.trim().toLowerCase();
    if (arg === 'ramend') return 0x08FF;
    if (arg.includes('low(ramend)')) return 0xFF;
    if (arg.includes('high(ramend)')) return 0x08;

    const upper = arg.toUpperCase();
    if (IO[upper] !== undefined) {
        return IO[upper] < 0x60 ? IO[upper] - IO_OFFSET : IO[upper];
    }

    if (arg.startsWith('$')) return parseInt(arg.substring(1), 16) || 0;
    if (arg.startsWith('0x')) return parseInt(arg.substring(2), 16) || 0;
    if (arg.startsWith('0b')) return parseInt(arg.substring(2), 2) || 0;
    const dec = parseInt(arg, 10);
    return isNaN(dec) ? 0 : dec;
}

function resolveIoRamAddr(token) {
    if (!token) return 0;
    const upper = token.trim().toUpperCase();
    if (IO[upper] !== undefined) return IO[upper];
    const num = parseVal(token);
    return (num >= 0 && num <= 0x3F) ? num + IO_OFFSET : num;
}

function resolveDataRamAddr(token) {
    if (!token) return 0;
    const upper = token.trim().toUpperCase();
    return IO[upper] !== undefined ? IO[upper] : parseVal(token);
}

function writeRAM(addr, val) {
    val &= 0xFF;
    if (addr >= 0 && addr < cpu.ram.length) {
        cpu.ram[addr] = val;
        if (addr >= 0 && addr < 32) cpu.r[addr] = val;
        if (addr === IO.SPL) cpu.sp = (cpu.sp & 0xFF00) | val;
        else if (addr === IO.SPH) cpu.sp = (cpu.sp & 0x00FF) | (val << 8);
        else if (addr === IO.UDR0) cpu.uartLog += String.fromCharCode(val);
    }
}

function readRAM(addr) {
    if (addr >= 0 && addr < 32) return cpu.r[addr];
    if (addr >= 0 && addr < cpu.ram.length) return cpu.ram[addr];
    return 0;
}

function pushStack(val) {
    writeRAM(cpu.sp, val & 0xFF);
    cpu.sp = (cpu.sp - 1) & 0xFFFF;
}

function popStack() {
    cpu.sp = (cpu.sp + 1) & 0xFFFF;
    return readRAM(cpu.sp);
}

function getPointerAddr(name) {
    name = name.toLowerCase();
    if (name.includes('x')) return (cpu.r[27] << 8) | cpu.r[26];
    if (name.includes('y')) return (cpu.r[29] << 8) | cpu.r[28];
    if (name.includes('z')) return (cpu.r[31] << 8) | cpu.r[30];
    return 0;
}

function setPointerAddr(name, val) {
    name = name.toLowerCase();
    val &= 0xFFFF;
    if (name.includes('x')) { cpu.r[26] = val & 0xFF; cpu.r[27] = (val >> 8) & 0xFF; }
    else if (name.includes('y')) { cpu.r[28] = val & 0xFF; cpu.r[29] = (val >> 8) & 0xFF; }
    else if (name.includes('z')) { cpu.r[30] = val & 0xFF; cpu.r[31] = (val >> 8) & 0xFF; }
}

/* ================= ДИСПЕТЧЕР ПРЕРЫВАНИЙ ================= */

function checkInterrupts() {
    const curPind = readRAM(IO.PIND);
    const curPinb = readRAM(IO.PINB);
    const eicra = readRAM(IO.EICRA);
    let eifr = readRAM(IO.EIFR);
    let pcifr = readRAM(IO.PCIFR);

    // INT0 (PD2)
    const isc0 = eicra & 0x03;
    const pd2Now = (curPind >> 2) & 1;
    const pd2Prev = (cpu.prevPinD >> 2) & 1;

    if (isc0 === 0 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 1 && pd2Now !== pd2Prev) eifr |= (1 << 0);
    else if (isc0 === 2 && pd2Prev === 1 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 3 && pd2Prev === 0 && pd2Now === 1) eifr |= (1 << 0);

    // INT1 (PD3)
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
            writeRAM(IO.EIFR, eifr & ~0x01);
            dispatchInterrupt('__vector_int0', 0x0002);
            return;
        }
        if ((eimsk & 0x02) && (eifr & 0x02)) {
            writeRAM(IO.EIFR, eifr & ~0x02);
            dispatchInterrupt('__vector_int1', 0x0004);
            return;
        }
        if ((pcicr & 0x01) && (pcifr & 0x01)) {
            writeRAM(IO.PCIFR, pcifr & ~0x01);
            dispatchInterrupt('__vector_pcint0', 0x0006);
            return;
        }
        if ((pcicr & 0x04) && (pcifr & 0x04)) {
            writeRAM(IO.PCIFR, pcifr & ~0x04);
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

/* ================= АЛУ И ЦИКЛ ВЫПОЛНЕНИЯ ================= */

function setFlagsAdd(a, b, res) {
    cpu.sreg.H = (((a & 0x0F) + (b & 0x0F)) > 0x0F) ? 1 : 0;
    cpu.sreg.C = (res > 0xFF) ? 1 : 0;
    cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (res & 0x80) ? 1 : 0;
    cpu.sreg.V = (!((a ^ b) & 0x80) && ((a ^ res) & 0x80)) ? 1 : 0;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
}

function setFlagsSub(a, b, res) {
    b &= 0xFF;
    cpu.sreg.H = (((a & 0x0F) - (b & 0x0F)) < 0) ? 1 : 0;
    cpu.sreg.C = (a < b) ? 1 : 0;
    cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (res & 0x80) ? 1 : 0;
    cpu.sreg.V = (((a ^ b) & 0x80) && ((a ^ res) & 0x80)) ? 1 : 0;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
}

function setFlagsLogic(val) {
    cpu.sreg.Z = ((val & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (val & 0x80) ? 1 : 0;
    cpu.sreg.V = 0;
    cpu.sreg.S = cpu.sreg.N;
}

function cpuStep() {
    if (cpu.error) { haltExecution(); updateUI(); return; }

    if (cpu.program.length === 0) parseProgram(document.getElementById('asmCode').value);
    if (cpu.program.length === 0 || cpu.error || cpu.pc >= cpu.program.length) {
        haltExecution(); updateUI(); return;
    }

    cpu.prevR.set(cpu.r);
    const inst = cpu.program[cpu.pc];
    const op = inst.op;
    const a = inst.args;
    let nextPC = cpu.pc + 1;

    if (op === 'break') { haltExecution(); updateUI(); return; }

    switch (op) {
        case 'ldi': { cpu.r[parseReg(a[0])] = parseVal(a[1]) & 0xFF; break; }
        case 'mov': { cpu.r[parseReg(a[0])] = cpu.r[parseReg(a[1])]; break; }
        case 'in': {
            const addr = resolveIoRamAddr(a[1]);
            cpu.r[parseReg(a[0])] = readRAM(addr); break;
        }
        case 'out': {
            const addr = resolveIoRamAddr(a[0]);
            writeRAM(addr, cpu.r[parseReg(a[1])]); break;
        }
        case 'lds': {
            const addr = resolveDataRamAddr(a[1]);
            cpu.r[parseReg(a[0])] = readRAM(addr); break;
        }
        case 'sts': {
            const addr = resolveDataRamAddr(a[0]);
            writeRAM(addr, cpu.r[parseReg(a[1])]); break;
        }
        case 'ld': {
            let addr = getPointerAddr(a[1].replace('+', '').replace('-', ''));
            if (a[1].includes('-')) { addr--; setPointerAddr(a[1].replace('-', ''), addr); }
            cpu.r[parseReg(a[0])] = readRAM(addr);
            if (a[1].includes('+')) setPointerAddr(a[1].replace('+', ''), addr + 1); break;
        }
        case 'st': {
            let addr = getPointerAddr(a[0].replace('+', '').replace('-', ''));
            if (a[0].includes('-')) { addr--; setPointerAddr(a[0].replace('-', ''), addr); }
            writeRAM(addr, cpu.r[parseReg(a[1])]);
            if (a[0].includes('+')) setPointerAddr(a[0].replace('+', ''), addr + 1); break;
        }
        case 'push': { pushStack(cpu.r[parseReg(a[0])]); break; }
        case 'pop':  { cpu.r[parseReg(a[0])] = popStack(); break; }
        case 'call': {
            pushStack(nextPC & 0xFF);
            pushStack((nextPC >> 8) & 0xFF);
            if (cpu.labels[a[0].toLowerCase()] !== undefined) nextPC = cpu.labels[a[0].toLowerCase()];
            break;
        }
        case 'ret': {
            const high = popStack();
            const low = popStack();
            nextPC = (high << 8) | low;
            break;
        }
        case 'reti': {
            const high = popStack();
            const low = popStack();
            nextPC = (high << 8) | low;
            cpu.sreg.I = 1;
            break;
        }
        case 'sei': { cpu.sreg.I = 1; break; }
        case 'cli': { cpu.sreg.I = 0; break; }
        case 'add': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const res = cpu.r[r1] + cpu.r[r2];
            setFlagsAdd(cpu.r[r1], cpu.r[r2], res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'sub': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const res = cpu.r[r1] - cpu.r[r2];
            setFlagsSub(cpu.r[r1], cpu.r[r2], res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'subi': {
            const r1 = parseReg(a[0]);
            const k = parseVal(a[1]) & 0xFF;
            const res = cpu.r[r1] - k;
            setFlagsSub(cpu.r[r1], k, res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'inc': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = (prev + 1) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (prev === 0x7F) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'dec': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = (prev - 1) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (prev === 0x80) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'lsl': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = (prev << 1) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x80) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'neg': {
            const reg = parseReg(a[0]);
            const val = cpu.r[reg];
            const res = (0 - val) & 0xFF;
            cpu.sreg.C = (res !== 0) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.r[reg] = res; break;
        }
        case 'and': {
            const reg = parseReg(a[0]);
            cpu.r[reg] &= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[reg]); break;
        }
        case 'andi': {
            const reg = parseReg(a[0]);
            cpu.r[reg] &= (parseVal(a[1]) & 0xFF);
            setFlagsLogic(cpu.r[reg]); break;
        }
        case 'or': {
            const reg = parseReg(a[0]);
            cpu.r[reg] |= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[reg]); break;
        }
        case 'ori': {
            const reg = parseReg(a[0]);
            cpu.r[reg] |= (parseVal(a[1]) & 0xFF);
            setFlagsLogic(cpu.r[reg]); break;
        }
        case 'eor': {
            const reg = parseReg(a[0]);
            cpu.r[reg] ^= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[reg]); break;
        }
        case 'clr': {
            const reg = parseReg(a[0]);
            cpu.r[reg] = 0; setFlagsLogic(0); break;
        }
        case 'ser': { cpu.r[parseReg(a[0])] = 0xFF; break; }
        case 'cpi': {
            const k = parseVal(a[1]) & 0xFF;
            setFlagsSub(cpu.r[parseReg(a[0])], k, cpu.r[parseReg(a[0])] - k); break;
        }
        case 'cp': {
            setFlagsSub(cpu.r[parseReg(a[0])], cpu.r[parseReg(a[1])], cpu.r[parseReg(a[0])] - cpu.r[parseReg(a[1])]); break;
        }
        case 'sbrs': {
            if ((cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) !== 0) nextPC++; break;
        }
        case 'sbrc': {
            if ((cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) === 0) nextPC++; break;
        }
        case 'jmp':
        case 'rjmp': { if (cpu.labels[a[0].toLowerCase()] !== undefined) nextPC = cpu.labels[a[0].toLowerCase()]; break; }
        case 'breq': { if (cpu.sreg.Z === 1) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brne': { if (cpu.sreg.Z === 0) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brcs':
        case 'brlo': { if (cpu.sreg.C === 1) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brcc':
        case 'brsh': { if (cpu.sreg.C === 0) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'sec': { cpu.sreg.C = 1; break; }
        case 'clc': { cpu.sreg.C = 0; break; }
        case 'sez': { cpu.sreg.Z = 1; break; }
        case 'clz': { cpu.sreg.Z = 0; break; }
        case 'nop': { break; }
    }

    cpu.pc = nextPC;
    cpu.cycles++;

    syncHardwareState();
    checkInterrupts();
    recordAnalyzerSample();
    updateUI();

    if (cpu.running && cpu.pc < cpu.program.length) {
        if (cpu.breakpoints.has(cpu.program[cpu.pc].lineNum)) {
            haltExecution();
            updateUI();
        }
    }
}

/* ================= АППАРАТУРА ================= */

function toggleVButton(id) {
    const btn = vButtons.find(b => b.id === id);
    if (!btn) return;
    btn.pressed = !btn.pressed;
    document.getElementById('vbtn_' + id)?.classList.toggle('latched', btn.pressed);

    syncHardwareState();
    checkInterrupts();
    recordAnalyzerSample();
    updateUI();
}

function syncHardwareState() {
    cpu.prevPinB = readRAM(IO.PINB);
    cpu.prevPinC = readRAM(IO.PINC);
    cpu.prevPinD = readRAM(IO.PIND);

    let pinb = 0xFF; let pind = 0xFF; let pinc = 0xFF;
    vButtons.forEach(btn => {
        if (btn.pressed) {
            if (btn.port === 'B') pinb &= ~(1 << btn.pin);
            if (btn.port === 'D') pind &= ~(1 << btn.pin);
            if (btn.port === 'C') pinc &= ~(1 << btn.pin);
        }
    });

    const ddrb = readRAM(IO.DDRB); const portb = readRAM(IO.PORTB);
    const ddrd = readRAM(IO.DDRD); const portd = readRAM(IO.PORTD);
    const ddrc = readRAM(IO.DDRC); const portc = readRAM(IO.PORTC);

    pinb = (pinb & ~ddrb) | (portb & ddrb);
    pind = (pind & ~ddrd) | (portd & ddrd);
    pinc = (pinc & ~ddrc) | (portc & ddrc);

    writeRAM(IO.PINB, pinb);
    writeRAM(IO.PIND, pind);
    writeRAM(IO.PINC, pinc);

    writeRAM(IO.SPL, cpu.sp & 0xFF);
    writeRAM(IO.SPH, (cpu.sp >> 8) & 0xFF);

    let sregByte = 0;
    const flags = ['C','Z','N','V','S','H','T','I'];
    flags.forEach((f, idx) => { if (cpu.sreg[f]) sregByte |= (1 << idx); });
    cpu.ram[IO.SREG] = sregByte;

    for (let i = 0; i < 32; i++) cpu.ram[i] = cpu.r[i];
}

function selectLedPort(portLetter) {
    cpu.selectedPort = portLetter;
    document.querySelectorAll('.port-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btnPort' + portLetter)?.classList.add('active');
    document.getElementById('ledPortTitle').textContent = `Линейка светодиодов (Порт ${portLetter})`;
    renderHardware();
}

function renderHardware() {
    const isPB5On = (readRAM(IO.PORTB) & (1 << 5)) !== 0;
    const ledPB5 = document.getElementById('ledPB5');
    if (ledPB5) ledPB5.className = 'led-light ' + (isPB5On ? 'active-led-yellow' : '');

    const isTXOn = (readRAM(IO.PORTD) & (1 << 1)) !== 0;
    const ledTX = document.getElementById('ledTX');
    if (ledTX) ledTX.className = 'led-light ' + (isTXOn ? 'active-led-green' : '');

    const isRXOn = (readRAM(IO.PORTD) & (1 << 0)) !== 0;
    const ledRX = document.getElementById('ledRX');
    if (ledRX) ledRX.className = 'led-light ' + (isRXOn ? 'active-led-green' : '');

    let currentVal = 0;
    if (cpu.selectedPort === 'D') currentVal = readRAM(IO.PORTD);
    if (cpu.selectedPort === 'B') currentVal = readRAM(IO.PORTB);
    if (cpu.selectedPort === 'C') currentVal = readRAM(IO.PORTC);

    for (let i = 7; i >= 0; i--) {
        const led = document.getElementById(`ledPin${i}`);
        const bitLbl = document.getElementById(`lblPin${i}`);
        if (led && bitLbl) {
            bitLbl.textContent = `${cpu.selectedPort}${i}`;
            led.className = 'led-light ' + ((currentVal & (1 << i)) !== 0 ? 'active-led-green' : '');
        }
    }

    const term = document.getElementById('uartTerminal');
    if (term && term.textContent !== cpu.uartLog) {
        term.textContent = cpu.uartLog || "UART готов к приёму данных...";
        term.scrollTop = term.scrollHeight;
    }
}

function clearUart() { cpu.uartLog = ""; renderHardware(); }

/* ================= ИГРОВОЙ ЦИКЛ ================= */

function haltExecution() {
    cpu.running = false; clearTimeout(cpu.timer);
    document.getElementById('btnRun')?.classList.remove('running');
    document.getElementById('runIcon').textContent = '▶';
    document.getElementById('runText').textContent = 'Пуск';
}

function toggleRun() {
    if (cpu.error) return;
    
    if (cpu.pc >= cpu.program.length) {
        cpu.pc = 0;
    }

    cpu.running = !cpu.running;
    const btn = document.getElementById('btnRun');
    if (cpu.running) {
        btn.classList.add('running');
        document.getElementById('runIcon').textContent = '⏸';
        document.getElementById('runText').textContent = 'Пауза';
        runLoop();
    } else haltExecution();
}

function runLoop() {
    if (!cpu.running) return;
    let delay = 16;
    let batchSize = 1;
    if (cpu.speed <= 50) {
        delay = Math.max(16, Math.floor(1000 / cpu.speed));
        batchSize = 1;
    } else {
        delay = 16;
        batchSize = Math.max(1, Math.round(cpu.speed / 25));
    }

    for (let i = 0; i < batchSize; i++) {
        cpuStep();
        if (!cpu.running || cpu.error) { haltExecution(); break; }
    }
    if (cpu.running) cpu.timer = setTimeout(runLoop, delay);
}

function cpuReset() {
    haltExecution();
    cpu.r.fill(0); cpu.prevR.fill(0); cpu.ram.fill(0);
    cpu.pc = 0; cpu.sp = 0x08FF; cpu.cycles = 0;
    cpu.sreg = { C:0, Z:0, N:0, V:0, S:0, H:0, T:0, I:0 };
    cpu.uartLog = "";

    vButtons.forEach(btn => {
        btn.pressed = false;
        document.getElementById('vbtn_' + btn.id)?.classList.remove('latched');
    });

    parseProgram(document.getElementById('asmCode').value);
    syncHardwareState();
    clearAnalyzer();
    updateUI();
}

function updateSpeed(val) {
    cpu.speed = parseInt(val, 10);
    document.getElementById('speedVal').textContent = cpu.speed + ' оп/с';
}

/* ================= ДАМП И UI ================= */

function setMemView(view) {
    cpu.memView = view;
    document.getElementById('btnMemRAM')?.classList.toggle('active', view === 'ram');
    document.getElementById('btnMemStack')?.classList.toggle('active', view === 'stack');
    renderMemoryDumps();
}

function setMemFormat(format) {
    cpu.memFormat = format;
    document.getElementById('btnFmtHex')?.classList.toggle('active', format === 'hex');
    document.getElementById('btnFmtDec')?.classList.toggle('active', format === 'dec');
    renderMemoryDumps();
}

function renderMemoryDumps() {
    const memBox = document.getElementById('memDumpView');
    if (!memBox) return;

    let output = '';
    if (cpu.memView === 'ram') {
        for (let addr = 0x0100; addr <= 0x0178; addr += 8) {
            let bytes = [];
            for (let b = 0; b < 8; b++) {
                let val = readRAM(addr + b);
                bytes.push(cpu.memFormat === 'dec' ? val.toString(10).padStart(3, '0') : val.toString(16).padStart(2, '0').toUpperCase());
            }
            output += `0x${addr.toString(16).toUpperCase()}:  ${bytes.join('  ')}\n`;
        }
    } else {
        for (let addr = 0x08C0; addr <= 0x08F8; addr += 8) {
            let bytes = [];
            for (let b = 0; b < 8; b++) {
                const isSP = ((addr + b) === cpu.sp);
                let val = readRAM(addr + b);
                let valStr = cpu.memFormat === 'dec' ? val.toString(10).padStart(3, '0') : val.toString(16).padStart(2, '0').toUpperCase();
                bytes.push(isSP ? `[${valStr}]` : ` ${valStr} `);
            }
            output += `0x${addr.toString(16).toUpperCase()}: ${bytes.join(' ')}\n`;
        }
    }
    memBox.textContent = output;
}

function updateTelemetry() {
    let usedFlash = cpu.program.length * 2;
    const flashElem = document.getElementById('telemFlash');
    if (flashElem) flashElem.textContent = `${usedFlash} / 32256 B`;

    let freeSram = 0x08FF - cpu.sp;
    const sramElem = document.getElementById('telemSram');
    if (sramElem) sramElem.textContent = `${2048 - freeSram} B`;
}

function updateUI() {
    document.getElementById('cycleCounter').textContent = `Такты: ${cpu.cycles}`;
    const statusElem = document.getElementById('compilerStatus');
    if (cpu.error) {
        statusElem.textContent = '❌ ' + cpu.error; statusElem.style.color = '#ff3d00';
    } else {
        statusElem.textContent = `Строка: ${cpu.program[cpu.pc]?.lineNum || 'END'}`; statusElem.style.color = '#8b9bb4';
    }

    document.getElementById('valPC').textContent = '0x' + cpu.pc.toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valSP').textContent = '0x' + cpu.sp.toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valX').textContent = '0x' + getPointerAddr('x').toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valY').textContent = '0x' + getPointerAddr('y').toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valZ').textContent = '0x' + getPointerAddr('z').toString(16).padStart(4, '0').toUpperCase();

    const fGrid = document.getElementById('flagsGrid');
    fGrid.innerHTML = ['I','T','H','S','V','N','Z','C'].map(f => `<div class="flag-cell ${cpu.sreg[f] ? 'flag-on' : ''}"><span>${f}</span><b>${cpu.sreg[f]}</b></div>`).join('');

    const rGrid = document.getElementById('registersGrid');
    let rHtml = '';
    for (let i = 0; i < 32; i++) {
        rHtml += `<div class="reg-cell ${cpu.r[i] !== cpu.prevR[i] ? 'changed' : ''}"><span class="reg-name">R${i}</span><span class="reg-val-hex">0x${cpu.r[i].toString(16).padStart(2, '0').toUpperCase()}</span><span class="reg-val-dec">(${cpu.r[i]})</span></div>`;
    }
    rGrid.innerHTML = rHtml;

    updateTelemetry();
    renderMemoryDumps();
    renderHardware();
    drawLogicAnalyzer();
    renderGutter();
}

/* ================= ПОДСВЕТКА И GUTTER ================= */

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightCode(rawText) {
    if (!rawText) return '';
    rawText = rawText.replace(/\r/g, '');
    const lines = rawText.split('\n');

    if (currentLang === 'c') {
        return lines.map(line => {
            let codePart = line;
            let comment = '';
            const cIdx = line.indexOf('//');
            if (cIdx !== -1) {
                codePart = line.substring(0, cIdx);
                comment = line.substring(cIdx);
            }

            let p = escapeHtml(codePart)
                .replace(/\b(uint8_t|int8_t|uint16_t|int16_t|uint32_t|int|void)\b/g, '<span class="syn-type">$1</span>')
                .replace(/\b(while|for|if|else|return|break|ISR)\b/g, '<span class="syn-kw">$1</span>')
                .replace(/(#define|#include)/g, '<span class="syn-dir">$1</span>')
                .replace(/\b(DDR[BCD]|PORT[BCD]|PIN[BCD]|UDR0|EICRA|EIMSK|PCICR|PCMSK[0-2])\b/g, '<span class="syn-op">$1</span>')
                .replace(/\b(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|0b[01]+|-?\d+)\b/g, '<span class="syn-num">$1</span>');

            return p + (comment ? `<span class="syn-com">${escapeHtml(comment)}</span>` : '');
        }).join('\n');
    }

    const KNOWN_OPS = new Set(['ldi','mov','add','adc','sub','subi','sbc','inc','dec','lsl','neg','and','andi','or','ori','eor','clr','ser','cpi','cp','sbrs','sbrc','sec','clc','sez','clz','st','ld','sts','lds','push','pop','jmp','rjmp','breq','brne','brcs','brcc','brlo','brsh','call','ret','reti','sei','cli','in','out','break','nop']);

    return lines.map(line => {
        let codePart = line;
        let comment = '';
        const semi = line.indexOf(';');
        const slash = line.indexOf('//');
        let idx = -1;
        if (semi !== -1 && slash !== -1) idx = Math.min(semi, slash);
        else if (semi !== -1) idx = semi;
        else if (slash !== -1) idx = slash;

        if (idx !== -1) {
            codePart = line.substring(0, idx);
            comment = line.substring(idx);
        }

        let p = escapeHtml(codePart)
            .replace(/^(\s*)([a-zA-Z0-9_]+:)/g, '$1<span class="syn-lbl">$2</span>')
            .replace(/(\.[a-zA-Z0-9_]+)/g, '<span class="syn-dir">$1</span>')
            .replace(/\b(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|0b[01]+|-?\d+)\b/g, '<span class="syn-num">$1</span>');

        p = p.replace(/\b([a-zA-Z]+)\b/g, (m) => KNOWN_OPS.has(m.toLowerCase()) ? `<span class="syn-op">${m}</span>` : m);
        return p + (comment ? `<span class="syn-com">${escapeHtml(comment)}</span>` : '');
    }).join('\n');
}

function updateSyntax() {
    const code = document.getElementById('asmCode').value;
    document.getElementById('highlightingContent').innerHTML = highlightCode(code) + '\n';
    renderGutter();
}

function setEditorLang(lang) {
    currentLang = lang;
    document.getElementById('btnLangAsm').classList.toggle('active', lang === 'asm');
    document.getElementById('btnLangC').classList.toggle('active', lang === 'c');
    document.getElementById('editorTitle').textContent = lang === 'c' ? '⚡ Редактор (C)' : '📝 Редактор (.asm)';
    updateSyntax();
    cpuReset();
}

function toggleBreakpoint(lineNum) {
    if (cpu.breakpoints.has(lineNum)) cpu.breakpoints.delete(lineNum);
    else cpu.breakpoints.add(lineNum);
    renderGutter();
}

function setPcToLine(targetLine) {
    if (cpu.program.length === 0) parseProgram(document.getElementById('asmCode').value);
    if (cpu.program.length === 0) return;

    haltExecution();
    let targetIdx = -1;
    for (let i = 0; i < cpu.program.length; i++) {
        if (cpu.program[i].lineNum >= targetLine) {
            targetIdx = i;
            break;
        }
    }
    if (targetIdx === -1) targetIdx = cpu.program.length;
    cpu.pc = targetIdx;
    updateUI();
}

function renderGutter() {
    const code = document.getElementById('asmCode').value;
    const curLineNum = cpu.program[cpu.pc]?.lineNum || -1;
    const gutter = document.getElementById('lineGutter');
    if (!gutter) return;

    const lines = code.split('\n');
    let html = '';
    for (let i = 1; i <= lines.length; i++) {
        const isCurrentPC = (i === curLineNum);
        const hasBp = cpu.breakpoints.has(i);
        html += `<div class="gutter-row ${hasBp ? 'has-bp' : ''} ${isCurrentPC ? 'is-pc' : ''}"
                      onclick="toggleBreakpoint(${i})"
                      ondblclick="setPcToLine(${i})"
                      title="Клик: точка останова | Двойной клик: переместить PC сюда">
                    <span class="bp-marker"></span>
                    <span class="pc-arrow">▶</span>
                    <span class="gutter-num">${i}</span>
                 </div>`;
    }
    gutter.innerHTML = html;
}

function clearEditor() {
    document.getElementById('asmCode').value = '';
    document.getElementById('hintBanner').style.display = 'none';
    cpu.breakpoints.clear();
    updateSyntax();
    cpuReset();
}

/* ================= ПРОГРАММАТОР ================= */

function flashFirmware() {
    const btn = document.getElementById('btnFlashMcu');
    const bar = document.getElementById('flashProgress');
    btn.disabled = true;

    let progress = 0;
    bar.style.width = '0%';

    const timer = setInterval(() => {
        progress += 20;
        bar.style.width = progress + '%';

        if (progress >= 100) {
            clearInterval(timer);
            btn.disabled = false;
            cpuReset();
            setTimeout(() => { bar.style.width = '0%'; }, 1500);
        }
    }, 150);
}

function sendSerialData() {
    const inp = document.getElementById('serialInput');
    if (!inp || !inp.value) return;
    const msg = inp.value;
    inp.value = '';

    const term = document.getElementById('serialTerminalWindow');
    if (term) {
        const line = document.createElement('div');
        line.className = 'serial-line tx';
        line.textContent = `[${new Date().toLocaleTimeString()}] ПК ➔ МК: "${msg}"`;
        term.appendChild(line);
        term.scrollTop = term.scrollHeight;
    }

    writeRAM(IO.UDR0, msg.charCodeAt(0));
}

function clearSerialLog() {
    const term = document.getElementById('serialTerminalWindow');
    if (term) term.innerHTML = '<div class="serial-line system">[Терминал очищен]</div>';
}

async function connectRealWebSerial() {
    if (!('serial' in navigator)) {
        alert('Web Serial API не поддерживается вашим браузером. Откройте симулятор в Chrome, Edge или Opera.');
        return;
    }
    try {
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        const badge = document.getElementById('usbStatusBadge');
        if (badge) {
            badge.textContent = '🟢 USB-C: Подключено (COM)';
            badge.style.background = 'rgba(34, 197, 94, 0.12)';
            badge.style.color = '#22c55e';
            badge.style.borderColor = 'rgba(34, 197, 94, 0.3)';
        }
    } catch (err) {}
}

/* ================= БАЗА ПРОГРАММ ================= */

const PROGRAMS = {
    c_interrupt_int0: {
        hint: "Нажатие кнопки K1 (PD2, INT0) вызывает прерывание по спаду, инвертируя светодиоды RX и TX.",
        lang: "c",
        code: `// Внешнее прерывание INT0 по спаду (нажатие K1 на PD2)
#include <avr/io.h>
#include <avr/interrupt.h>

ISR(INT0_vect)
{
    // Инвертируем состояние линий PD0 (RX) и PD1 (TX) при прерывании
    PORTD ^= (1 << PORTD0) | (1 << PORTD1);
}

int main(void)
{
    EICRA = (1 << ISC01);
    EIMSK = (1 << INT0);

    DDRD |= (1 << DDD0) | (1 << DDD1);
    DDRD &= ~(1 << DDD2);
    PORTD |= (1 << PORTD2); 

    sei();

    while (1) { }
}`
    },

    c_blink_counter: {
        hint: "Мигание светодиодом PB5 через счетчик до 800 000 с вложенными ветками if-else.",
        lang: "c",
        code: `// Мигание встроенным светодиодом на плате (PB5) через счетчик
#define F_CPU 16000000UL
#include <avr/io.h>

int main(void)
{
    DDRB |= (1 << DDB5);

    uint32_t x = 0;
    int flag = 0;

    while (1)
    {
        if (x >= 800000)
        {
            if (flag == 0)
            {
                PORTB |= (1 << PORTB5);
                flag = 1;
            }
            else
            {
                PORTB &= ~(1 << PORTB5);
                flag = 0;
            }
            x = 0;
        }
        x++;
    }
}`
    },

    c_zadanie5: {
        hint: "Кнопки K1 (PD2), K2 (PD3), K3 (PD4) переключают светодиоды PD0 (RX), PD1 (TX) и PB5 (L).",
        lang: "c",
        code: `// Управление светодиодами кнопками-триггерами
#define F_CPU 16000000UL
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    DDRD |= (1 << DDD0) | (1 << DDD1);
    DDRB |= (1 << DDB5);

    PORTD &= ~((1 << PORTD0) | (1 << PORTD1));
    PORTB &= ~(1 << PORTB5);

    DDRD &= ~((1 << DDD2) | (1 << DDD3) | (1 << DDD4));
    PORTD |= (1 << PORTD2) | (1 << PORTD3) | (1 << PORTD4);

    while (1)
    {
        if (!(PIND & (1 << PIND2)))
        {
            _delay_ms(40);
            if (!(PIND & (1 << PIND2)))
            {
                PORTD ^= (1 << PORTD0);
                while (!(PIND & (1 << PIND2)));
                _delay_ms(40);
            }
        }

        if (!(PIND & (1 << PIND3)))
        {
            _delay_ms(40);
            if (!(PIND & (1 << PIND3)))
            {
                PORTD ^= (1 << PORTD1);
                while (!(PIND & (1 << PIND3)));
                _delay_ms(40);
            }
        }

        if (!(PIND & (1 << PIND4)))
        {
            _delay_ms(40);
            if (!(PIND & (1 << PIND4)))
            {
                PORTB ^= (1 << PORTB5);
                while (!(PIND & (1 << PIND4)));
                _delay_ms(40);
            }
        }
    }
}`
    },

    c_example3: {
        hint: "Опрос кнопки K4 (PB0) и включение светодиода L (PB5) при нажатии.",
        lang: "c",
        code: `// Опрос кнопки PB0 (с подтяжкой) и включение светодиода L (PB5)
#include <avr/io.h>

int main(void)
{
    DDRB = 0x20;
    PORTB |= 0x01;

    while (1)
    {
        if ((PINB & 0x01) == 0)
            PORTB |= 0x20;
        else
            PORTB &= ~0x20;
    }
}`
    },

    test_all: {
        hint: "Проверка команд, флагов SREG (I, T, H, S, V, N, Z, C) и арифметики.",
        lang: "asm",
        code: `; Комплексный тест: проверка команд, регистров и всех флагов SREG
.include "m328pdef.inc"
start:
    ldi r16, 0x08
    out sph, r16
    ldi r16, 0xff
    out spl, r16
    sec
    clc
    sez
    clz
    sen
    cln
    sev
    clv
    set
    clt
    seh
    clh
    sei
    cli
    nop
    ldi r16, 0x0F
    ldi r17, 0x01
    add r16, r17
    ldi r17, 10
    subi r17, -3
    ldi r18, 0x80
    neg r18
    break
finish:
    rjmp finish`
    },

    led_running: {
        hint: "Бегущий огонёк по светодиодам Порта D.",
        lang: "asm",
        code: `; Бегущий огонёк по выводам PD0..PD7
.include "m328pdef.inc"

start:
    ser r16
    out DDRD, r16
    ldi r17, 1

loop:
    out PORTD, r17
    lsl r17
    brne loop
    ldi r17, 1
    rjmp loop`
    },

    uart_tx: {
        hint: "Вывод символов текста в виртуальный порт UDR0 (монитор UART).",
        lang: "asm",
        code: `; Отправка текстовых символов в терминал UART
.include "m328pdef.inc"
start:
    ldi r16, 0x48    ; 'H'
    out UDR0, r16
    ldi r16, 0x69    ; 'i'
    out UDR0, r16
    ldi r16, 0x21    ; '!'
    out UDR0, r16
    ldi r16, 0x0A    ; '\\n'
    out UDR0, r16
stop:
    break`
    },

    sort_ram: {
        hint: "Программа записывает 5 чисел в ОЗУ (0x0100..0x0104) и сортирует их по возрастанию.",
        lang: "asm",
        code: `; Сортировка массива из 5 чисел в ОЗУ (0x0100..0x0104) по возрастанию
.include "m328pdef.inc"

ldi r16, 0x16
sts 0x0100, r16
ldi r16, 0x03
sts 0x0101, r16
ldi r16, 0x25
sts 0x0102, r16
ldi r16, 0x45
sts 0x0103, r16
ldi r16, 0x01
sts 0x0104, r16

ldi r20, 5
out_1:
    ldi xh, 0x01
    ldi xl, 0x00
    ldi r21, 4

in_1:
    ld r16, x+
    ld r17, x
    cp r16, r17
    brlo no_s

    st x, r16
    st -x, r17
    adiw xl, 1

no_s:
    dec r21
    brne in_1
    dec r20
    brne out_1

finish:
    break
    rjmp finish`
    }
};

function loadSelectedExample() {
    const key = document.getElementById('exampleSelector').value;
    const banner = document.getElementById('hintBanner');
    if (PROGRAMS[key]) {
        document.getElementById('asmCode').value = PROGRAMS[key].code;
        if (!PROGRAMS[key].hint) banner.style.display = 'none';
        else {
            banner.style.display = 'flex';
            document.getElementById('hintText').innerHTML = PROGRAMS[key].hint;
        }
        setEditorLang(PROGRAMS[key].lang || 'asm');
    }
}

/* ================= ИНИЦИАЛИЗАЦИЯ ================= */

document.addEventListener('DOMContentLoaded', () => {
    const txtArea = document.getElementById('asmCode');
    const highlighting = document.getElementById('highlighting');
    const gutter = document.getElementById('lineGutter');

    txtArea.addEventListener('input', () => { updateSyntax(); cpuReset(); });
    txtArea.addEventListener('scroll', () => {
        highlighting.scrollTop = txtArea.scrollTop;
        highlighting.scrollLeft = txtArea.scrollLeft;
        gutter.scrollTop = txtArea.scrollTop;
    });

    window.addEventListener('resize', () => {
        resizeAnalyzerCanvas();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'F11') { e.preventDefault(); cpuStep(); }
        if (e.key === 'F9') {
            e.preventDefault();
            toggleBreakpoint(txtArea.value.substring(0, txtArea.selectionStart).split('\n').length);
        }
    });

    ['editor', 'analyzer', 'prog'].forEach(p => {
        const elem = document.getElementById(`panel_${p}`);
        const btn = document.getElementById(`tabBtn_${p}`);
        if (elem && btn) {
            elem.classList.remove('panel-hidden');
            btn.classList.add('active');
        }
    });

    renderChannelSelector();
    loadSelectedExample();
    setTimeout(resizeAnalyzerCanvas, 100);
});
