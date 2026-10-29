/* =========================================================
   ЯДРО ЭМУЛЯТОРА AVR ATmega328P + SALEAE LOGIC (ВЕРСИЯ ДЛЯ ЛАБ 5 И 6)
   ========================================================= */

// Карта адресов ввода-вывода (I/O Memory Map ATmega328P)
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

// Таблица векторов прерываний ATmega328P (Адреса Flash в словах)
const VECTORS = {
    RESET:      0x0000,
    INT0:       0x0002,
    INT1:       0x0004,
    PCINT0:     0x0006,
    PCINT1:     0x0008,
    PCINT2:     0x000A,
    USART_RX:   0x0024,
    USART_UDRE: 0x0026,
    USART_TX:   0x0028
};

// Таблица тактов выполнения команд ATmega328P (БАГ 13)
const CYCLES = {
    nop: 1, ldi: 1, mov: 1, add: 1, adc: 1, sub: 1, subi: 1, sbc: 1, sbci: 1,
    and: 1, andi: 1, or: 1, ori: 1, eor: 1, com: 1, neg: 1, inc: 1, dec: 1,
    tst: 1, clr: 1, ser: 1, in: 1, out: 1, sec: 1, clc: 1, sez: 1, clz: 1,
    sen: 1, cln: 1, sev: 1, clv: 1, ses: 1, cls: 1, seh: 1, clh: 1, set: 1, clt: 1,
    sei: 1, cli: 1, sbi: 2, cbi: 2, sbis: 1, sbic: 1, bst: 1, bld: 1, lpm: 3,
    lsl: 1, lsr: 1, asr: 1, rol: 1, ror: 1, cp: 1, cpc: 1, cpi: 1, cpse: 1,
    adiw: 2, sbiw: 2, sbrs: 1, sbrc: 1, rjmp: 2, jmp: 3, call: 4, ret: 4, reti: 4,
    lds: 2, sts: 2, ld: 1, st: 1, push: 2, pop: 2,
    breq: 1, brne: 1, brcs: 1, brcc: 1, brlo: 1, brsh: 1,
    brmi: 1, brpl: 1, brge: 1, brlt: 1, brhs: 1, brhc: 1, brts: 1, brtc: 1,
    brvs: 1, brvc: 1
};

let currentLang = 'asm';
let currentFontSize = 14;
const PANEL_LIST = ['editor', 'board', 'analyzer', 'cpu'];
let activePanelIndex = 0;

// Состояние ядра процессора
const cpu = {
    r: new Uint8Array(32),
    prevR: new Uint8Array(32),
    ram: new Uint8Array(0x0900),
    flashBytes: new Uint8Array(32768), // Побайтовая Flash-память для LPM и строк .db
    pc: 0,
    sp: 0x08FF,
    sreg: { C:0, Z:0, N:0, V:0, S:0, H:0, T:0, I:0 },
    cycles: 0,
    running: false,
    timer: null,
    speed: 40,
    program: [],
    labels: {},
    equConstants: {}, // Символьные константы (.equ)
    breakpoints: new Set(),
    rxBuffer: [], // Очередь принятых байт UART (RX)
    uartLog: "",
    error: null,
    selectedPort: 'D',
    memView: 'ram',
    memFormat: 'hex',
    prevPinB: 0xFF,
    prevPinC: 0xFF,
    prevPinD: 0xFF
};

// Виртуальные кнопки макета (K1..K8)
const vButtons = [
    { id: 'K1', port: 'D', pin: 2, pressed: false }, // INT0
    { id: 'K2', port: 'D', pin: 3, pressed: false }, // INT1
    { id: 'K3', port: 'D', pin: 4, pressed: false },
    { id: 'K4', port: 'B', pin: 0, pressed: false }, // PCINT0
    { id: 'K5', port: 'B', pin: 1, pressed: false }, // PCINT1
    { id: 'K6', port: 'B', pin: 2, pressed: false },
    { id: 'K7', port: 'B', pin: 3, pressed: false },
    { id: 'K8', port: 'B', pin: 4, pressed: false }
];

/* =========================================================
   1. НАВИГАЦИЯ, ТАБЫ И МОБИЛЬНЫЙ СВАЙП
   ========================================================= */

/* =========================================================
   1. МУЛЬТИКОЛОНКИ ДЛЯ ПК (ФОТО 2) И ТАБЫ ДЛЯ ТЕЛЕФОНОВ
   ========================================================= */

// Состояние открытых панелей (на ПК по умолчанию открыты все, как на Фото 2)
const activePanels = {
    editor: true,
    board: true,
    analyzer: true,
    cpu: true
};

function togglePanel(panelName) {
    const isMobile = window.innerWidth <= 900;

    if (isMobile) {
        // На смартфонах переключаем как одиночную вкладку
        PANEL_LIST.forEach(name => {
            activePanels[name] = (name === panelName);
            const pElem = document.getElementById(`panel_${name}`);
            const tBtn = document.getElementById(`tabBtn_${name}`);
            if (pElem) pElem.classList.toggle('panel-hidden', name !== panelName);
            if (tBtn) tBtn.classList.toggle('active', name === panelName);
        });
    } else {
        // На ПК включаем / выключаем колонку рядом (как на Фото 2)
        const activeCount = Object.values(activePanels).filter(Boolean).length;
        if (activePanels[panelName] && activeCount <= 1) return; // Не закрывать последнюю

        activePanels[panelName] = !activePanels[panelName];

        const pElem = document.getElementById(`panel_${panelName}`);
        const tBtn = document.getElementById(`tabBtn_${panelName}`);

        if (pElem) pElem.classList.toggle('panel-hidden', !activePanels[panelName]);
        if (tBtn) tBtn.classList.toggle('active', activePanels[panelName]);
    }

    if (panelName === 'analyzer' && activePanels.analyzer) {
        setTimeout(resizeAnalyzerCanvas, 40);
    }
}
// Сенсорный свайп влево/вправо для мобильных устройств
(function initTouchSwipe() {
    let touchStartX = 0;
    let touchStartY = 0;

    window.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
        const diffX = e.changedTouches[0].screenX - touchStartX;
        const diffY = e.changedTouches[0].screenY - touchStartY;

        if (Math.abs(diffX) > 60 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
            if (diffX < 0 && activePanelIndex < PANEL_LIST.length - 1) {
                switchPanel(PANEL_LIST[activePanelIndex + 1]);
            } else if (diffX > 0 && activePanelIndex > 0) {
                switchPanel(PANEL_LIST[activePanelIndex - 1]);
            }
        }
    }, { passive: true });
})();

function changeFontSize(delta) {
    currentFontSize = Math.min(24, Math.max(10, currentFontSize + delta));
    const newLineHeight = Math.round(currentFontSize * 1.55);
    document.documentElement.style.setProperty('--code-font-size', currentFontSize + 'px');
    document.documentElement.style.setProperty('--line-height', newLineHeight + 'px');
    document.getElementById('fontSizeVal').textContent = currentFontSize + 'px';
    renderGutter();
}

/* =========================================================
   2. ЛОГИЧЕСКИЙ АНАЛИЗАТОР (SALEAE LOGIC)
   ========================================================= */

const ALL_CHANNELS = [
    { id: 'PD0', port: 'D', pin: 0, label: 'PD0 (RX)', color: '#38bdf8' },
    { id: 'PD1', port: 'D', pin: 1, label: 'PD1 (TX)', color: '#06b6d4' },
    { id: 'PD2', port: 'D', pin: 2, label: 'PD2 (INT0)', color: '#3b82f6' },
    { id: 'PD3', port: 'D', pin: 3, label: 'PD3 (INT1)', color: '#6366f1' },
    { id: 'PD4', port: 'D', pin: 4, label: 'PD4 (K3)',  color: '#8b5cf6' },
    { id: 'PD5', port: 'D', pin: 5, label: 'PD5',       color: '#a855f7' },
    { id: 'PD6', port: 'D', pin: 6, label: 'PD6',       color: '#d946ef' },
    { id: 'PD7', port: 'D', pin: 7, label: 'PD7',       color: '#ec4899' },
    { id: 'PB0', port: 'B', pin: 0, label: 'PB0 (K4)',  color: '#f43f5e' },
    { id: 'PB1', port: 'B', pin: 1, label: 'PB1 (K5)',  color: '#fb7185' },
    { id: 'PB2', port: 'B', pin: 2, label: 'PB2 (K6)',  color: '#f97316' },
    { id: 'PB3', port: 'B', pin: 3, label: 'PB3 (K7)',  color: '#fb923c' },
    { id: 'PB4', port: 'B', pin: 4, label: 'PB4 (K8)',  color: '#facc15' },
    { id: 'PB5', port: 'B', pin: 5, label: 'PB5 (LED L)', color: '#eab308' },
    { id: 'PC0', port: 'C', pin: 0, label: 'PC0',       color: '#84cc16' },
    { id: 'PC1', port: 'C', pin: 1, label: 'PC1',       color: '#22c55e' },
    { id: 'PC2', port: 'C', pin: 2, label: 'PC2',       color: '#10b981' },
    { id: 'PC3', port: 'C', pin: 3, label: 'PC3',       color: '#14b8a6' },
    { id: 'PC4', port: 'C', pin: 4, label: 'PC4',       color: '#2dd4bf' },
    { id: 'PC5', port: 'C', pin: 5, label: 'PC5',       color: '#38bdf8' }
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
    if (!analyzer.capturing) return;

    const pind = readRAM(IO.PIND), ddrd = readRAM(IO.DDRD), portd = readRAM(IO.PORTD);
    const pinb = readRAM(IO.PINB), ddrb = readRAM(IO.DDRB), portb = readRAM(IO.PORTB);
    const pinc = readRAM(IO.PINC), ddrc = readRAM(IO.DDRC), portc = readRAM(IO.PORTC);

    function getPinVal(portLetter, pin) {
        if (portLetter === 'D') return (ddrd & (1 << pin)) ? ((portd >> pin) & 1) : ((pind >> pin) & 1);
        if (portLetter === 'B') return (ddrb & (1 << pin)) ? ((portb >> pin) & 1) : ((pinb >> pin) & 1);
        if (portLetter === 'C') return (ddrc & (1 << pin)) ? ((portc >> pin) & 1) : ((pinc >> pin) & 1);
        return 0;
    }

    const sample = { cycle: cpu.cycles, vals: {} };
    ALL_CHANNELS.forEach(ch => {
        sample.vals[ch.id] = getPinVal(ch.port, ch.pin);
    });

    analyzer.samples.push(sample);
    if (analyzer.samples.length > analyzer.maxSamples) analyzer.samples.shift();
}

function resizeAnalyzerCanvas() {
    const canvas = document.getElementById('logicCanvas');
    const wrapper = document.getElementById('canvasWrapper');
    if (!canvas || !wrapper) return;

    const activeChannels = ALL_CHANNELS.filter(c => selectedChannelIds.has(c.id));
    const trackHeight = 32;
    const requiredH = Math.max(wrapper.clientHeight - 4, activeChannels.length * trackHeight + 20);
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

    ctx.fillStyle = '#040508';
    ctx.fillRect(0, 0, w, h);

    const activeList = ALL_CHANNELS.filter(c => selectedChannelIds.has(c.id));
    if (activeList.length === 0) return;

    const trackHeight = 32;
    const stepX = 5 * analyzer.zoom;
    const totalVisible = Math.floor((w - 95) / stepX);
    const startIdx = Math.max(0, analyzer.samples.length - totalVisible);

    activeList.forEach((ch, idx) => {
        const baseY = 20 + idx * trackHeight;
        const highY = baseY;
        const lowY  = baseY + trackHeight - 12;

        ctx.strokeStyle = '#151c28';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(90, lowY);
        ctx.lineTo(w, lowY);
        ctx.stroke();

        ctx.fillStyle = ch.color;
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillText(ch.label, 8, lowY - 3);

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

/* =========================================================
   3. ТРАНСЛЯТОР MICRO-C -> AVR ASM (ДЛЯ ТЕМЫ 5 И ТЕМЫ 6)
   ========================================================= */

const AVR_CONSTS = {
    ISC00: 0, ISC01: 1, ISC10: 2, ISC11: 3,
    INT0: 0, INT1: 1, PCIE0: 0, PCIE1: 1, PCIE2: 2,
    TXEN0: 3, RXEN0: 4, UDRIE0: 5, TXCIE0: 6, RXCIE0: 7,
    UCSZ00: 1, UCSZ01: 2, UCSZ02: 2,
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
        for (const [k, v] of Object.entries(defines)) {
            expr = expr.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
        }
    }
    for (const [k, v] of Object.entries(AVR_CONSTS)) {
        expr = expr.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
    }
    // Символьные литералы (например 'A' -> 65)
    expr = expr.replace(/'(.)'/g, (m, c) => c.charCodeAt(0));
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
    code = code.replace(/\{/g, '\n{\n').replace(/\}/g, '\n}\n').replace(/;/g, ';\n');

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
        for (const [k, v] of Object.entries(defines)) {
            str = str.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
        }
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

        // Обработка прерываний ISR (Включая USART из Темы 6)
        const isrMatch = line.match(/ISR\s*\(\s*([a-zA-Z0-9_]+)\s*\)/);
        if (isrMatch) {
            const vName = isrMatch[1];
            let lbl = '__vector_default';
            if (vName.includes('INT0')) lbl = '__vector_int0';
            else if (vName.includes('INT1')) lbl = '__vector_int1';
            else if (vName.includes('PCINT0')) lbl = '__vector_pcint0';
            else if (vName.includes('PCINT1')) lbl = '__vector_pcint1';
            else if (vName.includes('PCINT2')) lbl = '__vector_pcint2';
            else if (vName.includes('USART_RX')) lbl = '__vector_usart_rx';
            else if (vName.includes('USART_UDRE')) lbl = '__vector_usart_udre';
            else if (vName.includes('USART_TX')) lbl = '__vector_usart_tx';

            asmList.push({ asm: `${lbl}:`, lineNum });
            asmList.push({ asm: `push r16`, lineNum });
            asmList.push({ asm: `in r16, SREG`, lineNum });
            asmList.push({ asm: `push r16`, lineNum });
            controlStack.push({ type: 'isr' });
            continue;
        }

        if (line.includes('main(')) {
            insideMain = true;
            asmList.push({ asm: '__main:', lineNum });
            for (let init of globalInits) asmList.push(init);
            continue;
        }

        if (line.includes('sei()')) { asmList.push({ asm: 'sei', lineNum }); continue; }
        if (line.includes('cli()')) { asmList.push({ asm: 'cli', lineNum }); continue; }

        // Задержка _delay_ms
        const delayMatch = line.match(/_delay_ms\s*\(\s*([0-9]+)\s*\);/);
        if (delayMatch) {
            const ms = parseInt(delayMatch[1], 10);
            const count = Math.min(255, Math.max(1, Math.round(ms * 2.5)));
            const lblDelay = `__delay_loop_${labelCounter++}`;
            asmList.push({ asm: `ldi r24, ${count}`, lineNum });
            asmList.push({ asm: `${lblDelay}:`, lineNum });
            asmList.push({ asm: `dec r24`, lineNum });
            asmList.push({ asm: `brne ${lblDelay}`, lineNum });
            continue;
        }

        // Закрытие скобок
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
                    asmList.push({ asm: `pop r16`, lineNum });
                    asmList.push({ asm: `out SREG, r16`, lineNum });
                    asmList.push({ asm: `pop r16`, lineNum });
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

        // Объявление переменных (включая char x, y, temp, count;)
        const multiDeclMatch = line.match(/\b(uint8_t|int8_t|uint16_t|int16_t|uint32_t|int|char)\s+([^;]+);/);
        if (multiDeclMatch) {
            const rawVars = multiDeclMatch[2].split(',');
            for (let vItem of rawVars) {
                const vParts = vItem.trim().split('=');
                const vName = vParts[0].trim();
                const initVal = vParts[1] ? vParts[1].trim() : "0";
                const reg = 'r' + (regCounter++);
                varMap[vName] = { reg };
                let constVal = evaluateCExpression(applyDefines(initVal), defines);
                if (constVal !== null) {
                    constVal = scaleThreshold(constVal);
                    const inst = { asm: `ldi ${reg}, ${constVal & 0xFF}`, lineNum };
                    if (!insideMain) globalInits.push(inst);
                    else asmList.push(inst);
                }
            }
            continue;
        }

        // Побитовые операции |=
        const portOrMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC|PCICR|EICRA|EIMSK|UCSR0B|UCSR0C)\s*\|\=\s*([^;]+);/);
        if (portOrMatch) {
            const portName = portOrMatch[1];
            const mask = evaluateCExpression(applyDefines(portOrMatch[2]), defines) & 0xFF;
            asmList.push({ asm: `lds r16, ${portName}`, lineNum });
            asmList.push({ asm: `ori r16, ${mask}`, lineNum });
            asmList.push({ asm: `sts ${portName}, r16`, lineNum });
            continue;
        }

        // Побитовые операции &= ~
        const portAndNotMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC|UCSR0B|UCSR0C)\s*&\=\s*~\s*\(?\s*([^;]+)\)?;/);
        if (portAndNotMatch) {
            const portName = portAndNotMatch[1];
            const mask = evaluateCExpression(applyDefines(portAndNotMatch[2].replace(/\)+$/, '')), defines) & 0xFF;
            const invMask = (~mask) & 0xFF;
            asmList.push({ asm: `lds r16, ${portName}`, lineNum });
            asmList.push({ asm: `andi r16, ${invMask}`, lineNum });
            asmList.push({ asm: `sts ${portName}, r16`, lineNum });
            continue;
        }

        // Побитовые операции ^= (Инверсия)
        const portXorMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD)\s*\^\=\s*([^;]+);/);
        if (portXorMatch) {
            const portName = portXorMatch[1];
            const mask = evaluateCExpression(applyDefines(portXorMatch[2]), defines) & 0xFF;
            asmList.push({ asm: `lds r16, ${portName}`, lineNum });
            asmList.push({ asm: `ldi r17, ${mask}`, lineNum });
            asmList.push({ asm: `eor r16, r17`, lineNum });
            asmList.push({ asm: `sts ${portName}, r16`, lineNum });
            continue;
        }

        // XOR переменных: y = x ^ temp; (Пример 2 Темы 5)
        const varXorMatch = line.match(/\b([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\s*\^\s*([a-zA-Z0-9_]+);/);
        if (varXorMatch) {
            const dst = varXorMatch[1], src1 = varXorMatch[2], src2 = varXorMatch[3];
            if (varMap[dst] && varMap[src1] && varMap[src2]) {
                asmList.push({ asm: `mov ${varMap[dst].reg}, ${varMap[src1].reg}`, lineNum });
                asmList.push({ asm: `eor ${varMap[dst].reg}, ${varMap[src2].reg}`, lineNum });
                continue;
            }
        }

        // Присваивание регистрам: UDR0 = 0x3E; или PORTC = count; или x = PINB;
        const assignAnyMatch = line.match(/\b([a-zA-Z0-9_]+)\s*=\s*([^;]+);/);
        if (assignAnyMatch) {
            const dst = assignAnyMatch[1].trim();
            const src = assignAnyMatch[2].trim();

            // Чтение порта в переменную: x = PINB; x = UDR0;
            if (varMap[dst] && (src === 'PINB' || src === 'PIND' || src === 'PINC' || src === 'UDR0')) {
                asmList.push({ asm: `lds ${varMap[dst].reg}, ${src}`, lineNum });
                continue;
            }

            // Запись в порт: PORTC = count; UDR0 = 0x3E;
            if (['PORTB','PORTC','PORTD','DDRB','DDRC','DDRD','EICRA','EIMSK','PCICR','PCICR0','PCMSK0','PCMSK2','UBRR0','UDR0'].includes(dst)) {
                let pName = (dst === 'PCICR0') ? 'PCICR' : dst;
                let cVal = evaluateCExpression(applyDefines(src), defines);
                if (cVal !== null) {
                    asmList.push({ asm: `ldi r16, ${cVal & 0xFF}`, lineNum });
                    asmList.push({ asm: `sts ${pName}, r16`, lineNum });
                } else if (varMap[src]) {
                    asmList.push({ asm: `sts ${pName}, ${varMap[src].reg}`, lineNum });
                }
                continue;
            }

            // Присваивание переменной: temp = x; или count = 0;
            if (varMap[dst]) {
                let cVal = evaluateCExpression(applyDefines(src), defines);
                if (cVal !== null) {
                    asmList.push({ asm: `ldi ${varMap[dst].reg}, ${cVal & 0xFF}`, lineNum });
                } else if (varMap[src]) {
                    asmList.push({ asm: `mov ${varMap[dst].reg}, ${varMap[src].reg}`, lineNum });
                }
                continue;
            }
        }

        // Инкремент: count++;
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

        // if со сравнением (например if (UDR0 == 'A'))
        const ifCmpMatch = line.match(/if\s*\(\s*([a-zA-Z0-9_]+)\s*(==|!=|>=|>|<=|<)\s*([^)]+)\)/);
        if (ifCmpMatch) {
            const vName = ifCmpMatch[1];
            const op = ifCmpMatch[2];
            let rawCmp = applyDefines(ifCmpMatch[3]);
            let cmpVal = evaluateCExpression(rawCmp, defines);

            if (cmpVal !== null) {
                let compReg = 'r16';
                if (varMap[vName]) compReg = varMap[vName].reg;
                else if (vName === 'UDR0') {
                    asmList.push({ asm: `lds r16, UDR0`, lineNum });
                    compReg = 'r16';
                }

                cmpVal = scaleThreshold(cmpVal);
                const lblFalse = `lbl_false_${labelCounter++}`;
                const lblEnd = `lbl_end_${labelCounter++}`;

                asmList.push({ asm: `cpi ${compReg}, ${cmpVal & 0xFF}`, lineNum });
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
            asmList.push({ asm: `pop r16`, lineNum: rawLines.length });
            asmList.push({ asm: `out SREG, r16`, lineNum: rawLines.length });
            asmList.push({ asm: `pop r16`, lineNum: rawLines.length });
            asmList.push({ asm: 'reti', lineNum: rawLines.length });
        }
    }

    return asmList;
}

/* =========================================================
   4. ПАРСЕР АССЕМБЛЕРА (ПОДДЕРЖКА .ORG, .EQU, .DB, LPM, BST)
   ========================================================= */

function evaluateAsmExpression(expr) {
    if (!expr) return 0;
    expr = expr.trim();

    // Замена констант .equ
    for (const [k, v] of Object.entries(cpu.equConstants)) {
        expr = expr.replace(new RegExp('\\b' + k + '\\b', 'gi'), v);
    }
    for (const [k, v] of Object.entries(AVR_CONSTS)) {
        expr = expr.replace(new RegExp('\\b' + k + '\\b', 'gi'), v);
    }

    // Поддержка меток со сдвигами: Msg<<1 или Msg
    for (const [lbl, addr] of Object.entries(cpu.labels)) {
        expr = expr.replace(new RegExp('\\b' + lbl + '\\b', 'gi'), addr);
    }

    if (expr.toLowerCase().includes('ramend')) return 0x08FF;
    if (expr.toLowerCase().includes('high(ramend)')) return 0x08;
    if (expr.toLowerCase().includes('low(ramend)')) return 0xFF;

    // Выделение функций low(...) и high(...)
    expr = expr.replace(/high\s*\(([^)]+)\)/gi, (m, inner) => `((${inner}) >> 8) & 0xFF`);
    expr = expr.replace(/low\s*\(([^)]+)\)/gi, (m, inner) => `(${inner}) & 0xFF`);

    // Шестнадцатеричные и двоичные литералы
    expr = expr.replace(/\$([0-9a-fA-F]+)/g, '0x$1');

    try {
        return Function(`'use strict'; return (${expr});`)();
    } catch (e) {
        return parseInt(expr, 10) || 0;
    }
}

function parseVal(arg) {
    if (!arg) return 0;
    arg = arg.trim();

    const upper = arg.toUpperCase();
    if (IO[upper] !== undefined) {
        return IO[upper] < 0x60 ? IO[upper] - IO_OFFSET : IO[upper];
    }
    return evaluateAsmExpression(arg);
}

function parseProgram(text) {
    cpu.program = [];
    cpu.labels = {};
    cpu.equConstants = {};
    cpu.flashBytes.fill(0);
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

    // ПЕРВЫЙ ПРОХОД: Сбор директив .equ
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const sIdx = line.indexOf(';');
        if (sIdx !== -1) line = line.substring(0, sIdx);
        line = line.trim();
        if (line.toLowerCase().startsWith('.equ')) {
            const eqMatch = line.match(/\.equ\s+([a-zA-Z0-9_]+)\s*=\s*(.+)/i);
            if (eqMatch) {
                cpu.equConstants[eqMatch[1].trim()] = evaluateAsmExpression(eqMatch[2].trim());
            }
        }
    }

    // ВТОРОЙ ПРОХОД: Размещение векторов по .org, меток и строк .db
    let wordIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const sIdx = line.indexOf(';');
        if (sIdx !== -1) line = line.substring(0, sIdx);
        line = line.trim();
        if (!line) continue;

        // Директива .org (Адресация таблицы векторов)
        if (line.toLowerCase().startsWith('.org')) {
            const orgTarget = evaluateAsmExpression(line.substring(4).trim());
            while (wordIndex < orgTarget) {
                cpu.program[wordIndex] = { op: 'nop', args: [], lineNum: i + 1, raw: 'nop' };
                wordIndex++;
            }
            continue;
        }

        // Метки
        if (line.includes(':')) {
            const parts = line.split(':');
            const lblName = parts[0].trim().toLowerCase();
            cpu.labels[lblName] = wordIndex;
            line = parts.slice(1).join(':').trim();
            if (!line) continue;
        }

        // Директива строк .db в памяти программ (Тема 6, стр. 12)
        if (line.toLowerCase().startsWith('.db')) {
            const dataStr = line.substring(3).trim();
            let bytePtr = wordIndex * 2; // Байт-адрес во Flash

            // Разбор строк "Текст", 0x0A
            const items = dataStr.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            for (let itm of items) {
                itm = itm.trim();
                if (itm.startsWith('"') && itm.endsWith('"')) {
                    const strVal = itm.slice(1, -1);
                    for (let c = 0; c < strVal.length; c++) {
                        cpu.flashBytes[bytePtr++] = strVal.charCodeAt(c);
                    }
                } else if (itm === "'\\n'" || itm === "'\\r'") {
                    cpu.flashBytes[bytePtr++] = 10;
                } else {
                    cpu.flashBytes[bytePtr++] = evaluateAsmExpression(itm) & 0xFF;
                }
            }
            // Выравнивание wordIndex по заполненным байтам
            const wordsUsed = Math.ceil((bytePtr - (wordIndex * 2)) / 2);
            for (let w = 0; w < wordsUsed; w++) {
                cpu.program[wordIndex + w] = { op: 'nop', args: [], lineNum: i + 1, raw: '.db' };
            }
            wordIndex += wordsUsed;
            continue;
        }

        if (line.startsWith('.')) continue;

        const tokens = line.split(/\s+/);
        const op = tokens[0].toLowerCase();
        const argsStr = line.substring(tokens[0].length).trim();
        const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];

        cpu.program[wordIndex] = { op, args, lineNum: i + 1, raw: line };
        wordIndex++;
    }

    // Заполнение возможных дыр между org
    for (let j = 0; j < cpu.program.length; j++) {
        if (!cpu.program[j]) {
            cpu.program[j] = { op: 'nop', args: [], lineNum: 1, raw: 'nop' };
        }
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

function resolveLabel(target, lineNum) {
    if (!target) return null;
    const key = target.trim().toLowerCase();
    if (cpu.labels[key] === undefined) {
        cpu.error = `Строка ${lineNum}: метка '${target}' не найдена`;
        return null;
    }
    return cpu.labels[key];
}

/* =========================================================
   5. ПАМЯТЬ ОЗУ, СТЕК И ОЧЕРЕДЬ UART (БАГИ 9, 11, 12)
   ========================================================= */

function writeRAM(addr, val) {
    val &= 0xFF;
    if (addr < 0 || addr >= cpu.ram.length) return;

    // Запись в PINx инвертирует биты PORTx
    if (addr === IO.PINB) { writeRAM(IO.PORTB, readRAM(IO.PORTB) ^ val); return; }
    if (addr === IO.PINC) { writeRAM(IO.PORTC, readRAM(IO.PORTC) ^ val); return; }
    if (addr === IO.PIND) { writeRAM(IO.PORTD, readRAM(IO.PORTD) ^ val); return; }

    // Сброс EIFR и PCIFR записью единицы (write 1 to clear)
    if (addr === IO.EIFR || addr === IO.PCIFR) {
        cpu.ram[addr] &= ~val;
        return;
    }

    cpu.ram[addr] = val;
    if (addr >= 0 && addr < 32) cpu.r[addr] = val;

    if (addr === IO.SPL) cpu.sp = (cpu.sp & 0xFF00) | val;
    else if (addr === IO.SPH) cpu.sp = (cpu.sp & 0x00FF) | (val << 8);

    // Передача по UART: вывод в терминал и установка флагов UDRE0 и TXC0
    else if (addr === IO.UDR0) {
        cpu.uartLog += String.fromCharCode(val);
        cpu.ram[IO.UCSR0A] |= (1 << 5) | (1 << 6); // UDRE0=1, TXC0=1
        appendUartTerminal(String.fromCharCode(val));
    }
}

function readRAM(addr) {
    if (addr >= 0 && addr < 32) return cpu.r[addr];

    // Чтение регистра данных UART (UDR0): считывание из очереди RX
    if (addr === IO.UDR0) {
        if (cpu.rxBuffer.length > 0) {
            const b = cpu.rxBuffer.shift();
            if (cpu.rxBuffer.length === 0) {
                cpu.ram[IO.UCSR0A] &= ~(1 << 7); // Сброс флага RXC0 (буфер опустошен)
            }
            return b;
        }
        cpu.ram[IO.UCSR0A] &= ~(1 << 7);
        return 0;
    }

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

function isTwoWordInstruction(inst) {
    if (!inst) return false;
    return ['jmp', 'call', 'lds', 'sts'].includes(inst.op.toLowerCase());
}

/* =========================================================
   6. ФЛАГИ АЛУ ПО СПЕЦИФИКАЦИИ ATMEL
   ========================================================= */

function setFlagsAdd(a, b, res) {
    const Rd3 = (a >> 3) & 1, Rr3 = (b >> 3) & 1, R3 = (res >> 3) & 1;
    const Rd7 = (a >> 7) & 1, Rr7 = (b >> 7) & 1, R7 = (res >> 7) & 1;

    cpu.sreg.H = ((Rd3 & Rr3) | (Rr3 & !R3) | (!R3 & Rd3)) ? 1 : 0;
    cpu.sreg.C = (res > 0xFF) ? 1 : 0;
    cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (res & 0x80) ? 1 : 0;
    cpu.sreg.V = ((Rd7 & Rr7 & !R7) | (!Rd7 & !Rr7 & R7)) ? 1 : 0;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
}

function setFlagsSub(a, b, res, isSbc = false) {
    const Rd3 = (a >> 3) & 1, Rr3 = (b >> 3) & 1, R3 = (res >> 3) & 1;
    const Rd7 = (a >> 7) & 1, Rr7 = (b >> 7) & 1, R7 = (res >> 7) & 1;

    cpu.sreg.H = ((!Rd3 & Rr3) | (Rr3 & R3) | (R3 & !Rd3)) ? 1 : 0;
    cpu.sreg.C = ((!Rd7 & Rr7) | (Rr7 & R7) | (R7 & !Rd7)) ? 1 : 0;
    
    if (isSbc) {
        cpu.sreg.Z = (((res & 0xFF) === 0) && cpu.sreg.Z) ? 1 : 0;
    } else {
        cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;
    }
    
    cpu.sreg.N = (res & 0x80) ? 1 : 0;
    cpu.sreg.V = ((Rd7 & !Rr7 & !R7) | (!Rd7 & Rr7 & R7)) ? 1 : 0;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
}

function setFlagsLogic(val) {
    cpu.sreg.Z = ((val & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (val & 0x80) ? 1 : 0;
    cpu.sreg.V = 0;
    cpu.sreg.S = cpu.sreg.N;
}

/* =========================================================
   7. ДИСПЕТЧЕР ПРЕРЫВАНИЙ (ТЕМА 5 И ТЕМА 6)
   ========================================================= */

function applyHardwarePins() {
    let pinb = 0xFF, pind = 0xFF, pinc = 0xFF;

    vButtons.forEach(btn => {
        if (btn.pressed) {
            if (btn.port === 'B') pinb &= ~(1 << btn.pin);
            if (btn.port === 'D') pind &= ~(1 << btn.pin);
            if (btn.port === 'C') pinc &= ~(1 << btn.pin);
        }
    });

    const ddrb = readRAM(IO.DDRB), portb = readRAM(IO.PORTB);
    const ddrd = readRAM(IO.DDRD), portd = readRAM(IO.PORTD);
    const ddrc = readRAM(IO.DDRC), portc = readRAM(IO.PORTC);

    pinb = (pinb & ~ddrb) | (portb & ddrb);
    pind = (pind & ~ddrd) | (portd & ddrd);
    pinc = (pinc & ~ddrc) | (portc & ddrc);

    cpu.ram[IO.PINB] = pinb;
    cpu.ram[IO.PIND] = pind;
    cpu.ram[IO.PINC] = pinc;
}

function checkInterrupts() {
    const curPind = readRAM(IO.PIND);
    const curPinb = readRAM(IO.PINB);
    const eicra = readRAM(IO.EICRA);
    let eifr = readRAM(IO.EIFR);
    let pcifr = readRAM(IO.PCIFR);

    // --- 1. ВНЕШНЕЕ ПРЕРЫВАНИЕ INT0 (PD2) ---
    const isc0 = eicra & 0x03;
    const pd2Now = (curPind >> 2) & 1;
    const pd2Prev = (cpu.prevPinD >> 2) & 1;

    // ISC0 = 00: Низкий уровень (Тема 5, Пример 1)
    if (isc0 === 0 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 1 && pd2Now !== pd2Prev) eifr |= (1 << 0);
    else if (isc0 === 2 && pd2Prev === 1 && pd2Now === 0) eifr |= (1 << 0);
    else if (isc0 === 3 && pd2Prev === 0 && pd2Now === 1) eifr |= (1 << 0);

    // --- 2. ВНЕШНЕЕ ПРЕРЫВАНИЕ INT1 (PD3) ---
    const isc1 = (eicra >> 2) & 0x03;
    const pd3Now = (curPind >> 3) & 1;
    const pd3Prev = (cpu.prevPinD >> 3) & 1;

    if (isc1 === 0 && pd3Now === 0) eifr |= (1 << 1);
    else if (isc1 === 1 && pd3Now !== pd3Prev) eifr |= (1 << 1);
    else if (isc1 === 2 && pd3Prev === 1 && pd3Now === 0) eifr |= (1 << 1);
    else if (isc1 === 3 && pd3Prev === 0 && pd3Now === 1) eifr |= (1 << 1);

    cpu.ram[IO.EIFR] = eifr;

    // --- 3. ПРЕРЫВАНИЯ PIN CHANGE (PCINT0, PCINT1, PCINT2) ---
    const pcmsk0 = readRAM(IO.PCMSK0);
    const pcmsk1 = readRAM(IO.PCMSK1);
    const pcmsk2 = readRAM(IO.PCMSK2);
    if ((curPinb ^ cpu.prevPinB) & pcmsk0) pcifr |= (1 << 0);
    if ((readRAM(IO.PINC) ^ cpu.prevPinC) & pcmsk1) pcifr |= (1 << 1);
    if ((curPind ^ cpu.prevPinD) & pcmsk2) pcifr |= (1 << 2);
    cpu.ram[IO.PCIFR] = pcifr;

    cpu.prevPinB = curPinb;
    cpu.prevPinC = readRAM(IO.PINC);
    cpu.prevPinD = curPind;

    // --- 4. ПРОВЕРКА И ПРИОРИТЕТНЫЙ ВЫЗОВ (ПРИ SREG.I == 1) ---
    if (cpu.sreg.I === 1) {
        const eimsk = readRAM(IO.EIMSK);
        const pcicr = readRAM(IO.PCICR);
        const ucsrb = readRAM(IO.UCSR0B);
        const ucsra = readRAM(IO.UCSR0A);

        // Приоритет 1: INT0
        if ((eimsk & 0x01) && (eifr & 0x01)) {
            if (isc0 !== 0) cpu.ram[IO.EIFR] &= ~0x01;
            dispatchInterrupt(VECTORS.INT0, '__vector_int0');
            return;
        }
        // Приоритет 2: INT1
        if ((eimsk & 0x02) && (eifr & 0x02)) {
            if (isc1 !== 0) cpu.ram[IO.EIFR] &= ~0x02;
            dispatchInterrupt(VECTORS.INT1, '__vector_int1');
            return;
        }
        // Приоритет 3: PCINT0
        if ((pcicr & 0x01) && (pcifr & 0x01)) {
            cpu.ram[IO.PCIFR] &= ~0x01;
            dispatchInterrupt(VECTORS.PCINT0, '__vector_pcint0');
            return;
        }
        // Приоритет 4: PCINT1
        if ((pcicr & 0x02) && (pcifr & 0x02)) {
            cpu.ram[IO.PCIFR] &= ~0x02;
            dispatchInterrupt(VECTORS.PCINT1, '__vector_pcint1');
            return;
        }
        // Приоритет 5: PCINT2
        if ((pcicr & 0x04) && (pcifr & 0x04)) {
            cpu.ram[IO.PCIFR] &= ~0x04;
            dispatchInterrupt(VECTORS.PCINT2, '__vector_pcint2');
            return;
        }
        // Приоритет 6: UART RX Complete (Тема 6, стр. 13)
        if ((ucsrb & (1 << 7)) && (ucsra & (1 << 7))) {
            dispatchInterrupt(VECTORS.USART_RX, '__vector_usart_rx');
            return;
        }
        // Приоритет 7: UART Data Register Empty
        if ((ucsrb & (1 << 5)) && (ucsra & (1 << 5))) {
            dispatchInterrupt(VECTORS.USART_UDRE, '__vector_usart_udre');
            return;
        }
        // Приоритет 8: UART TX Complete
        if ((ucsrb & (1 << 6)) && (ucsra & (1 << 6))) {
            cpu.ram[IO.UCSR0A] &= ~(1 << 6);
            dispatchInterrupt(VECTORS.USART_TX, '__vector_usart_tx');
            return;
        }
    }
}

// Переход к обработчику прерывания: поддержка адресов векторов (.org) и меток C
function dispatchInterrupt(vectorWordAddr, vectorLabel) {
    pushStack(cpu.pc & 0xFF);
    pushStack((cpu.pc >> 8) & 0xFF);
    cpu.sreg.I = 0; // Аппаратный запрет дальнейших прерываний

    if (currentLang === 'c' && cpu.labels[vectorLabel] !== undefined) {
        cpu.pc = cpu.labels[vectorLabel];
    } else if (cpu.program[vectorWordAddr]) {
        cpu.pc = vectorWordAddr;
    } else if (cpu.labels[vectorLabel] !== undefined) {
        cpu.pc = cpu.labels[vectorLabel];
    }
}

/* =========================================================
   8. ВЫПОЛНЕНИЕ ИНСТРУКЦИЙ (ПОЛНЫЙ НАБОР: BST, BLD, LPM, SBI, CBI)
   ========================================================= */

function cpuStep(silent = false) {
    if (cpu.pc < 0) cpu.pc = 0;
    if (cpu.error) { haltExecution(); if (!silent) updateUI(); return; }

    if (cpu.program.length === 0) parseProgram(document.getElementById('asmCode').value);
    if (cpu.program.length === 0 || cpu.error || cpu.pc >= cpu.program.length) {
        haltExecution(); if (!silent) updateUI(); return;
    }

    const inst = cpu.program[cpu.pc];
    if (!inst) { haltExecution(); if (!silent) updateUI(); return; }

    cpu.prevR.set(cpu.r);
    const op = inst.op;
    const a = inst.args;
    let nextPC = cpu.pc + 1;

    if (op === 'break') { haltExecution(); if (!silent) updateUI(); return; }

    switch (op) {
        // --- ПЕРЕСЫЛКА ДАННЫХ И LPM ---
        case 'ldi': { cpu.r[parseReg(a[0])] = parseVal(a[1]) & 0xFF; break; }
        case 'mov': { cpu.r[parseReg(a[0])] = cpu.r[parseReg(a[1])]; break; }
        case 'in':  { cpu.r[parseReg(a[0])] = readRAM(resolveIoRamAddr(a[1])); break; }
        case 'out': { writeRAM(resolveIoRamAddr(a[0]), cpu.r[parseReg(a[1])]); break; }
        case 'lds': { cpu.r[parseReg(a[0])] = readRAM(resolveDataRamAddr(a[1])); break; }
        case 'sts': { writeRAM(resolveDataRamAddr(a[0]), cpu.r[parseReg(a[1])]); break; }
        case 'ld': {
            let addr = getPointerAddr(a[1].replace('+', '').replace('-', ''));
            if (a[1].includes('-')) { addr--; setPointerAddr(a[1].replace('-', ''), addr); }
            cpu.r[parseReg(a[0])] = readRAM(addr);
            if (a[1].includes('+')) setPointerAddr(a[1].replace('+', ''), addr + 1);
            break;
        }
        case 'st': {
            let addr = getPointerAddr(a[0].replace('+', '').replace('-', ''));
            if (a[0].includes('-')) { addr--; setPointerAddr(a[0].replace('-', ''), addr); }
            writeRAM(addr, cpu.r[parseReg(a[1])]);
            if (a[0].includes('+')) setPointerAddr(a[0].replace('+', ''), addr + 1);
            break;
        }
        case 'push': { pushStack(cpu.r[parseReg(a[0])]); break; }
        case 'pop':  { cpu.r[parseReg(a[0])] = popStack(); break; }
        case 'clr':  { cpu.r[parseReg(a[0])] = 0; setFlagsLogic(0); break; }
        case 'ser':  { cpu.r[parseReg(a[0])] = 0xFF; break; }

        // Чтение Flash-памяти программ LPM (Тема 6, стр. 12)
        case 'lpm': {
            let destReg = 0;
            let isPostInc = false;
            if (a.length >= 1) destReg = parseReg(a[0]);
            if (a.length >= 2 && a[1].includes('+')) isPostInc = true;

            const zAddr = getPointerAddr('z');
            cpu.r[destReg] = cpu.flashBytes[zAddr] || 0;
            if (isPostInc) setPointerAddr('z', zAddr + 1);
            break;
        }

        // --- БИТОВЫЕ ОПЕРАЦИИ С ПОРТАМИ И РЕГИСТРОМ SREG ---
        // bst Rd, b: сохранить b-й бит регистра Rd во флаг T (Тема 6, стр. 12)
        case 'bst': {
            const reg = parseReg(a[0]);
            const bit = parseVal(a[1]);
            cpu.sreg.T = (cpu.r[reg] >> bit) & 1;
            break;
        }
        // bld Rd, b: загрузить флаг T в b-й бит регистра Rd
        case 'bld': {
            const reg = parseReg(a[0]);
            const bit = parseVal(a[1]);
            if (cpu.sreg.T) cpu.r[reg] |= (1 << bit);
            else cpu.r[reg] &= ~(1 << bit);
            break;
        }
        // sbi: установить бит в порту ввода-вывода (Тема 5, Пример 1: sbi portd, 3)
        case 'sbi': {
            const addr = resolveIoRamAddr(a[0]);
            const bit = parseVal(a[1]);
            writeRAM(addr, readRAM(addr) | (1 << bit));
            break;
        }
        // cbi: сбросить бит в порту ввода-вывода (Тема 5, Пример 1: cbi ddrd, 3)
        case 'cbi': {
            const addr = resolveIoRamAddr(a[0]);
            const bit = parseVal(a[1]);
            writeRAM(addr, readRAM(addr) & ~(1 << bit));
            break;
        }
        case 'sbis': {
            const addr = resolveIoRamAddr(a[0]);
            const bit = parseVal(a[1]);
            if ((readRAM(addr) & (1 << bit)) !== 0) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }
        case 'sbic': {
            const addr = resolveIoRamAddr(a[0]);
            const bit = parseVal(a[1]);
            if ((readRAM(addr) & (1 << bit)) === 0) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }

        // --- АРИФМЕТИКА И ЛОГИКА ---
        case 'add': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const res = cpu.r[r1] + cpu.r[r2];
            setFlagsAdd(cpu.r[r1], cpu.r[r2], res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'adc': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const res = cpu.r[r1] + cpu.r[r2] + cpu.sreg.C;
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
            const r1 = parseReg(a[0]), k = parseVal(a[1]) & 0xFF;
            const res = cpu.r[r1] - k;
            setFlagsSub(cpu.r[r1], k, res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'sbc': {
            const r1 = parseReg(a[0]), r2 = parseReg(a[1]);
            const res = cpu.r[r1] - cpu.r[r2] - cpu.sreg.C;
            setFlagsSub(cpu.r[r1], cpu.r[r2], res, true);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'sbci': {
            const r1 = parseReg(a[0]), k = parseVal(a[1]) & 0xFF;
            const res = cpu.r[r1] - k - cpu.sreg.C;
            setFlagsSub(cpu.r[r1], k, res, true);
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
        case 'neg': {
            const reg = parseReg(a[0]);
            const val = cpu.r[reg];
            const res = (0 - val) & 0xFF;
            cpu.sreg.H = ((res & 0x0F) > 0) ? 1 : 0;
            cpu.sreg.C = (res !== 0) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (val === 0x80) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
            cpu.r[reg] = res; break;
        }
        case 'com': {
            const reg = parseReg(a[0]);
            const res = (~cpu.r[reg]) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.C = 1;
            setFlagsLogic(res); break;
        }
        case 'and': {
            const r1 = parseReg(a[0]);
            cpu.r[r1] &= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[r1]); break;
        }
        case 'andi': {
            const r1 = parseReg(a[0]);
            cpu.r[r1] &= (parseVal(a[1]) & 0xFF);
            setFlagsLogic(cpu.r[r1]); break;
        }
        case 'or': {
            const r1 = parseReg(a[0]);
            cpu.r[r1] |= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[r1]); break;
        }
        case 'ori': {
            const r1 = parseReg(a[0]);
            cpu.r[r1] |= (parseVal(a[1]) & 0xFF);
            setFlagsLogic(cpu.r[r1]); break;
        }
        case 'eor': {
            const r1 = parseReg(a[0]);
            cpu.r[r1] ^= cpu.r[parseReg(a[1])];
            setFlagsLogic(cpu.r[r1]); break;
        }
        case 'tst': { setFlagsLogic(cpu.r[parseReg(a[0])]); break; }
        case 'lsl': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = (prev << 1) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x80) ? 1 : 0;
            cpu.sreg.H = (prev & 0x08) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'lsr': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = prev >> 1;
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x01) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = 0;
            cpu.sreg.V = cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.V; break;
        }
        case 'asr': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const res = (prev >> 1) | (prev & 0x80);
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x01) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'rol': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const oldC = cpu.sreg.C;
            const res = ((prev << 1) | oldC) & 0xFF;
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x80) ? 1 : 0;
            cpu.sreg.H = (prev & 0x08) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'ror': {
            const reg = parseReg(a[0]);
            const prev = cpu.r[reg];
            const oldC = cpu.sreg.C;
            const res = (prev >> 1) | (oldC << 7);
            cpu.r[reg] = res;
            cpu.sreg.C = (prev & 0x01) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }

        // 16-битные операции adiw / sbiw (r24, X, Y, Z)
        case 'adiw': {
            const rLow = parseReg(a[0]);
            const k = parseVal(a[1]) & 0x3F;
            const curVal = cpu.r[rLow] | (cpu.r[rLow + 1] << 8);
            const res = curVal + k;
            cpu.r[rLow] = res & 0xFF;
            cpu.r[rLow + 1] = (res >> 8) & 0xFF;
            cpu.sreg.Z = ((res & 0xFFFF) === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x8000) ? 1 : 0;
            cpu.sreg.V = (!((curVal >> 15) & 1) && ((res >> 15) & 1)) ? 1 : 0;
            cpu.sreg.C = (!((res >> 15) & 1) && ((curVal >> 15) & 1)) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }
        case 'sbiw': {
            const rLow = parseReg(a[0]);
            const k = parseVal(a[1]) & 0x3F;
            const curVal = cpu.r[rLow] | (cpu.r[rLow + 1] << 8);
            const res = curVal - k;
            cpu.r[rLow] = res & 0xFF;
            cpu.r[rLow + 1] = (res >> 8) & 0xFF;
            cpu.sreg.Z = ((res & 0xFFFF) === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x8000) ? 1 : 0;
            cpu.sreg.V = (((curVal >> 15) & 1) && !((res >> 15) & 1)) ? 1 : 0;
            cpu.sreg.C = (((res >> 15) & 1) && !((curVal >> 15) & 1)) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
        }

        // --- СРАВНЕНИЯ И ПРОПУСКИ ---
        case 'cp': {
            setFlagsSub(cpu.r[parseReg(a[0])], cpu.r[parseReg(a[1])], cpu.r[parseReg(a[0])] - cpu.r[parseReg(a[1])]);
            break;
        }
        case 'cpi': {
            const k = parseVal(a[1]) & 0xFF;
            setFlagsSub(cpu.r[parseReg(a[0])], k, cpu.r[parseReg(a[0])] - k);
            break;
        }
        case 'cpse': {
            if (cpu.r[parseReg(a[0])] === cpu.r[parseReg(a[1])]) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }
        case 'sbrs': {
            if ((cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) !== 0) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }
        case 'sbrc': {
            if ((cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) === 0) {
                nextPC += isTwoWordInstruction(cpu.program[nextPC]) ? 2 : 1;
            }
            break;
        }

        // --- ПЕРЕХОДЫ И ПОДПРОГРАММЫ ---
        case 'jmp':
        case 'rjmp': {
            const target = resolveLabel(a[0], inst.lineNum);
            if (target !== null) nextPC = target;
            break;
        }
        case 'call': {
            const target = resolveLabel(a[0], inst.lineNum);
            if (target !== null) {
                pushStack(nextPC & 0xFF);
                pushStack((nextPC >> 8) & 0xFF);
                nextPC = target;
            }
            break;
        }
        case 'ret': {
            const high = popStack();
            const low = popStack();
            nextPC = (high << 8) | low; break;
        }
        case 'reti': {
            const high = popStack();
            const low = popStack();
            nextPC = (high << 8) | low;
            cpu.sreg.I = 1; break;
        }

        // Ветвления по флагам (включая brts и brtc по флагу T)
        case 'breq': { if (cpu.sreg.Z === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brne': { if (cpu.sreg.Z === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brcs':
        case 'brlo': { if (cpu.sreg.C === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brcc':
        case 'brsh': { if (cpu.sreg.C === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brmi': { if (cpu.sreg.N === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brpl': { if (cpu.sreg.N === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brge': { if (cpu.sreg.S === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brlt': { if (cpu.sreg.S === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brhs': { if (cpu.sreg.H === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brhc': { if (cpu.sreg.H === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brts': { if (cpu.sreg.T === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brtc': { if (cpu.sreg.T === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brvs': { if (cpu.sreg.V === 1) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }
        case 'brvc': { if (cpu.sreg.V === 0) nextPC = resolveLabel(a[0], inst.lineNum) ?? nextPC; break; }

        // Прямое управление битами SREG
        case 'sec': { cpu.sreg.C = 1; break; }
        case 'clc': { cpu.sreg.C = 0; break; }
        case 'sez': { cpu.sreg.Z = 1; break; }
        case 'clz': { cpu.sreg.Z = 0; break; }
        case 'sen': { cpu.sreg.N = 1; break; }
        case 'cln': { cpu.sreg.N = 0; break; }
        case 'sev': { cpu.sreg.V = 1; break; }
        case 'clv': { cpu.sreg.V = 0; break; }
        case 'ses': { cpu.sreg.S = 1; break; }
        case 'cls': { cpu.sreg.S = 0; break; }
        case 'seh': { cpu.sreg.H = 1; break; }
        case 'clh': { cpu.sreg.H = 0; break; }
        case 'set': { cpu.sreg.T = 1; break; }
        case 'clt': { cpu.sreg.T = 0; break; }
        case 'sei': { cpu.sreg.I = 1; break; }
        case 'cli': { cpu.sreg.I = 0; break; }

        case 'nop': { break; }
    }

    cpu.pc = nextPC;
    cpu.cycles += CYCLES[op] || 1;

    syncHardwareState();
    checkInterrupts();
    recordAnalyzerSample();

    if (!silent) updateUI();

    if (cpu.running && cpu.pc < cpu.program.length) {
        if (cpu.breakpoints.has(cpu.program[cpu.pc].lineNum)) {
            haltExecution();
            updateUI();
        }
    }
}

/* =========================================================
   9. АППАРАТНАЯ СИНХРОНИЗАЦИЯ, СВЕТОДИОДЫ И UART
   ========================================================= */

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
    applyHardwarePins();

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
    const portb = readRAM(IO.PORTB);
    const ledPB5 = document.getElementById('ledPB5');
    if (ledPB5) ledPB5.className = 'led-light ' + ((portb & (1 << 5)) ? 'active-led-yellow' : '');

    const portd = readRAM(IO.PORTD);
    const ledTX = document.getElementById('ledTX');
    if (ledTX) ledTX.className = 'led-light ' + ((portd & (1 << 1)) ? 'active-led-green' : '');

    const ledRX = document.getElementById('ledRX');
    if (ledRX) ledRX.className = 'led-light ' + ((portd & (1 << 0)) ? 'active-led-green' : '');

    let currentVal = 0;
    if (cpu.selectedPort === 'D') currentVal = readRAM(IO.PORTD);
    if (cpu.selectedPort === 'B') currentVal = readRAM(IO.PORTB);
    if (cpu.selectedPort === 'C') currentVal = readRAM(IO.PORTC);

    for (let i = 7; i >= 0; i--) {
        const led = document.getElementById(`ledPin${i}`);
        const bitLbl = document.getElementById(`lblPin${i}`);
        if (led && bitLbl) {
            bitLbl.textContent = `${cpu.selectedPort}${i}`;
            led.className = 'led-light ' + ((currentVal & (1 << i)) ? 'active-led-green' : '');
        }
    }
}

function appendUartTerminal(char) {
    const term = document.getElementById('uartTerminal');
    if (term) {
        term.textContent = cpu.uartLog || "UART готов к работе...";
        term.scrollTop = term.scrollHeight;
    }
}

function clearUart() {
    cpu.uartLog = "";
    const term = document.getElementById('uartTerminal');
    if (term) term.textContent = "UART очищен.";
}

// Прием символов в виртуальный UDR0 (Тема 6, стр. 13-14)
function sendUartInput() {
    const inp = document.getElementById('serialInput');
    if (!inp || !inp.value) return;
    const text = inp.value;
    inp.value = '';

    for (let i = 0; i < text.length; i++) {
        cpu.rxBuffer.push(text.charCodeAt(i));
    }

    // Установка бита RXC0 (есть непрочитанные данные в UDR0)
    cpu.ram[IO.UCSR0A] |= (1 << 7);

    checkInterrupts();
    updateUI();
}

/* =========================================================
   10. РЕАЛЬНЫЙ WEB SERIAL API (С ИМПУЛЬСОМ DTR)
   ========================================================= */

window._serialPort = null;

async function connectRealWebSerial() {
    const btn = document.getElementById('btnWebSerial');
    if (!('serial' in navigator)) {
        alert('Web Serial API не поддерживается данным браузером. Используйте Chrome, Edge или Opera.');
        return;
    }

    try {
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        window._serialPort = port;

        // DTR-сброс для перезагрузки Arduino
        await port.setSignals({ dataTerminalReady: false });
        await new Promise(r => setTimeout(r, 50));
        await port.setSignals({ dataTerminalReady: true });
        await new Promise(r => setTimeout(r, 50));
        await port.setSignals({ dataTerminalReady: false });

        if (btn) {
            btn.classList.add('connected');
            btn.textContent = '🟢 COM Подключен';
        }

        const reader = port.readable.getReader();
        (async () => {
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) {
                        for (let byte of value) {
                            cpu.rxBuffer.push(byte);
                        }
                        cpu.ram[IO.UCSR0A] |= (1 << 7);
                        checkInterrupts();
                        updateUI();
                    }
                }
            } catch (e) {
                console.warn('Web Serial закрыт:', e);
            } finally {
                reader.releaseLock();
            }
        })();

    } catch (err) {
        alert('Ошибка подключения COM-порта: ' + err.message);
        if (btn) {
            btn.classList.remove('connected');
            btn.textContent = '🌐 Подключить COM';
        }
    }
}

/* =========================================================
   11. ИСПОЛНЯЕМЫЙ ЦИКЛ RUNLOOP (60 FPS)
   ========================================================= */

function haltExecution() {
    cpu.running = false;
    clearTimeout(cpu.timer);
    document.getElementById('btnRun')?.classList.remove('running');
    document.getElementById('runIcon').textContent = '▶';
    document.getElementById('runText').textContent = 'Пуск';
}

function toggleRun() {
    if (cpu.error) return;
    if (cpu.pc >= cpu.program.length) cpu.pc = 0;

    cpu.running = !cpu.running;
    const btn = document.getElementById('btnRun');
    if (cpu.running) {
        btn.classList.add('running');
        document.getElementById('runIcon').textContent = '⏸';
        document.getElementById('runText').textContent = 'Пауза';
        runLoop();
    } else {
        haltExecution();
    }
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
        cpuStep(true);
        if (!cpu.running || cpu.error) {
            haltExecution();
            break;
        }
    }

    updateUI();

    if (cpu.running) {
        cpu.timer = setTimeout(runLoop, delay);
    }
}

function cpuReset() {
    haltExecution();
    cpu.r.fill(0);
    cpu.prevR.fill(0);
    cpu.ram.fill(0);
    cpu.pc = 0;
    cpu.sp = 0x08FF;
    cpu.cycles = 0;
    cpu.sreg = { C:0, Z:0, N:0, V:0, S:0, H:0, T:0, I:0 };
    cpu.rxBuffer = [];
    cpu.uartLog = "";

    cpu.prevPinB = 0xFF;
    cpu.prevPinC = 0xFF;
    cpu.prevPinD = 0xFF;

    // Начальное состояние UART (UDRE0 = 1, буфер пуст)
    cpu.ram[IO.UCSR0A] = (1 << 5);

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

/* =========================================================
   12. РЕНДЕР ДАМПОВ, РЕГИСТРОВ И ИНТЕРФЕЙСА
   ========================================================= */

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

function updateUI() {
    document.getElementById('cycleCounter').textContent = `Такты: ${cpu.cycles}`;
    const statusElem = document.getElementById('compilerStatus');
    if (cpu.error) {
        statusElem.textContent = '❌ ' + cpu.error;
        statusElem.style.color = '#ff3d00';
    } else {
        statusElem.textContent = `Строка: ${cpu.program[cpu.pc]?.lineNum || 'END'}`;
        statusElem.style.color = '#8493a8';
    }

    document.getElementById('valPC').textContent = '0x' + cpu.pc.toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valSP').textContent = '0x' + cpu.sp.toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valX').textContent = '0x' + getPointerAddr('x').toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valY').textContent = '0x' + getPointerAddr('y').toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valZ').textContent = '0x' + getPointerAddr('z').toString(16).padStart(4, '0').toUpperCase();

    const fGrid = document.getElementById('flagsGrid');
    if (fGrid) {
        fGrid.innerHTML = ['I','T','H','S','V','N','Z','C'].map(f => 
            `<div class="flag-cell ${cpu.sreg[f] ? 'flag-on' : ''}"><span>${f}</span><b>${cpu.sreg[f]}</b></div>`
        ).join('');
    }

    const rGrid = document.getElementById('registersGrid');
    if (rGrid) {
        let rHtml = '';
        for (let i = 0; i < 32; i++) {
            rHtml += `<div class="reg-cell ${cpu.r[i] !== cpu.prevR[i] ? 'changed' : ''}">` +
                     `<span class="reg-name">R${i}</span>` +
                     `<span class="reg-val-hex">0x${cpu.r[i].toString(16).padStart(2, '0').toUpperCase()}</span>` +
                     `<span class="reg-val-dec">(${cpu.r[i]})</span></div>`;
        }
        rGrid.innerHTML = rHtml;
    }

    renderMemoryDumps();
    renderHardware();
    drawLogicAnalyzer();
    renderGutter();
}

/* =========================================================
   13. ПОДСВЕТКА СИНТАКСИСА И РЕДАКТОР (С KNOWN_OPS)
   ========================================================= */

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
                .replace(/\b(uint8_t|int8_t|uint16_t|int16_t|uint32_t|int|char|void)\b/g, '<span class="syn-type">$1</span>')
                .replace(/\b(while|for|if|else|return|break|ISR)\b/g, '<span class="syn-kw">$1</span>')
                .replace(/(#define|#include)/g, '<span class="syn-dir">$1</span>')
                .replace(/\b(DDR[BCD]|PORT[BCD]|PIN[BCD]|UDR0|EICRA|EIMSK|PCICR|PCMSK[0-2]|UCSR0[ABC]|UBRR0[LH]|_delay_ms)\b/g, '<span class="syn-op">$1</span>')
                .replace(/\b(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|0b[01]+|-?\d+)\b/g, '<span class="syn-num">$1</span>');

            return p + (comment ? `<span class="syn-com">${escapeHtml(comment)}</span>` : '');
        }).join('\n');
    }

    const KNOWN_OPS = new Set([
        'ldi','mov','add','adc','sub','subi','sbc','sbci','inc','dec','lsl','lsr','asr','rol','ror',
        'neg','com','and','andi','or','ori','eor','tst','clr','ser','cpi','cp','cpse','sbrs','sbrc',
        'sec','clc','sez','clz','sen','cln','sev','clv','ses','cls','seh','clh','set','clt',
        'bst','bld','sbi','cbi','sbis','sbic','lpm',
        'adiw','sbiw','st','ld','sts','lds','push','pop','jmp','rjmp','breq','brne','brcs','brcc',
        'brlo','brsh','brmi','brpl','brge','brlt','brhs','brhc','brts','brtc','brvs','brvc',
        'call','ret','reti','sei','cli','in','out','break','nop'
    ]);

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
        if (cpu.program[i]?.lineNum >= targetLine) {
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

/* =========================================================
   14. ПРИМЕРЫ ИЗ МЕТОДИЧЕК (ТЕМА 5 И ТЕМА 6)
   ========================================================= */

const PROGRAMS = {
    // ТЕМА 5: ПРИМЕР 1 НА ASM (Стр. 11: Прерывание INT1 по низкому уровню, сброс r17)
    lab5_asm_int1: {
        hint: "Тема 5, Пример 1 (ASM): Прерывание INT1 по низкому уровню сигнала на PD3 (K2). Сбрасывает счетчик в 0.",
        lang: "asm",
        code: `; Тема 5. Пример 1: Прерывание INT1 по низкому уровню
.include "m328pdef.inc"
.org 0
jmp Reset
.org 0x004
jmp Int_1

Reset:
ldi r16, High(RAMEND)
out sph, r16
ldi r16, Low(RAMEND)
out spl, r16
ldi r16, 0x00
sts EICRA, r16       ; Прерывание INT1 по низкому уровню
ldi r16, 0x02
out EIMSK, r16       ; Разрешение INT1
cbi ddrd, 3          ; PD3 на ввод
sbi portd, 3         ; Подтяжка PULL-UP на PD3
ldi r16, 0xff
out ddrc, r16        ; Порт C на вывод
sei

main:
inc r17
out portc, r17
jmp main

Int_1:
ldi r17, 0x00        ; Сброс кода при прерывании
out portc, r17
reti`
    },

    // ТЕМА 5: ПРИМЕР 1 НА C (Стр. 14)
    c_interrupt_int0: {
        hint: "Тема 5, Пример 1 (C): Обработка внешнего прерывания INT1_vect. При зажатии кнопки K2 (PD3) счетчик сбрасывается.",
        lang: "c",
        code: `#include <avr/io.h>
#include <avr/interrupt.h>

int x;

ISR(INT1_vect)
{
    PORTC = 0x00;
}

int main(void)
{
    x = 0;
    EICRA = 0x00;   // Низкий уровень INT1
    EIMSK = 0x02;   // Разрешение INT1
    DDRD = 0x00;
    PORTD = 0x08;   // Подтяжка на PD3
    DDRC = 0xFF;
    sei();

    while (1)
    {
        PORTC = x;
        x++;
    }
}`
    },

    // ТЕМА 5: ПРИМЕР 2 НА ASM (Стр. 15: Прерывания PCINT0 и PCINT2, побитовое определение кнопки)
    lab5_asm_pcint: {
        hint: "Тема 5, Пример 2 (ASM): Прерывания PCINT0 и PCINT2 с анализом бита через EOR.",
        lang: "asm",
        code: `; Тема 5. Пример 2: Прерывания PCINT0 и PCINT2
.include "m328pdef.inc"
.org 0
jmp Reset
.org 0x006
jmp mPCINT0
.org 0x00A
jmp mPCINT2

Reset:
ldi r16, low(RAMEND)
out spl, r16
ldi r16, high(RAMEND)
out sph, r16
ldi r16, 0x07
sts PCICR, r16       ; Разрешение PCI0, PCI1, PCI2
ldi r16, 0xFF
sts PCMSK0, r16      ; Все биты Порта B
sts PCMSK2, r16      ; Все биты Порта D
sei

m:
inc r17
jmp m

mPCINT0:
in r20, PINB
mov r22, r18
eor r22, r20         ; Выявление изменившегося бита
mov r18, r20
reti

mPCINT2:
in r21, PIND
mov r23, r19
eor r23, r21         ; Выявление изменившегося бита
mov r19, r21
reti`
    },

    // ТЕМА 6: ПРИМЕР 1 НА ASM (Стр. 10: Отправка символа '>' в UART по кнопке K1 на PD2)
    lab6_asm_uart_btn: {
        hint: "Тема 6, Пример 1 (ASM): Нажатие K1 (PD2, INT0) отправляет символ '>' (0x3E) в терминал UART.",
        lang: "asm",
        code: `; Тема 6. Пример 1: Отправка символа по нажатию кнопки
.include "m328pdef.inc"
.org 0
jmp Reset
.org 0x002
jmp knopka

Reset:
ldi r16, 0x03
sts EICRA, r16       ; INT0 по фронту
ldi r16, 0x01
out EIMSK, r16       ; Разрешение INT0
cbi ddrd, 2
sbi portd, 2         ; Подтяжка PD2

.equ CLK = 16000000
.equ BAUD = 9600
.equ UBRR0_value = (CLK/(BAUD*16)) - 1

ldi r16, high(UBRR0_value)
sts UBRR0H, r16
ldi r16, low(UBRR0_value)
sts UBRR0L, r16
ldi r16, (1<<TXEN0)
sts UCSR0B, r16
ldi r16, (1<<UCSZ00)|(1<<UCSZ01)
sts UCSR0C, r16
sei

main:
jmp main

knopka:
ldi r16, 0x3E        ; Символ '>'
sts UDR0, r16
reti`
    },

    // ТЕМА 6: ПРИМЕР 2 НА ASM (Стр. 12: LPM, BST, чтение строки ReadyToWork из .db Flash)
    lab6_asm_lpm_msg: {
        hint: "Тема 6, Пример 2 (ASM): Посимвольная отправка строки из Flash (LPM, Z+, BST r17, 5).",
        lang: "asm",
        code: `; Тема 6. Пример 2: Передача сообщения из ПЗУ (.db) через LPM и BST
.include "m328pdef.inc"
.org 0
jmp Reset

Reset:
ldi r16, 103
sts UBRR0L, r16      ; 9600 бод при 16 МГц
ldi r16, (1<<TXEN0)
sts UCSR0B, r16
ldi r16, (1<<UCSZ00)|(1<<UCSZ01)
sts UCSR0C, r16
sei

main:
ldi zl, low(Msg<<1)
ldi zh, high(Msg<<1)
ldi r18, 22          ; Длина строки

send:
lpm r16, Z+          ; Загрузка символа из памяти программ с постинкрементом Z
sts UDR0, r16
subi r18, 1

repeat:
lds r17, UCSR0A
bst r17, 5           ; Копирование бита UDRE0 во флаг T
brtc repeat          ; Ожидание готовности буфера
cpi r18, 0
breq main            ; Повтор передачи строки
jmp send

.cseg
Msg: .db "Atmega328P:ReadyToWork", '\n'`
    },

    // ТЕМА 6: ЗАДАНИЕ 3 НА C (Стр. 13: Прием символа 'A' по прерыванию USART_RX зажигает LED L)
    lab6_c_rx_led: {
        hint: "Тема 6, Задание 3 (C): Введите в поле терминала букву 'A' и нажмите Enter — светодиод L (PB5) зажжется!",
        lang: "c",
        code: `#include <avr/io.h>
#include <avr/interrupt.h>

// Прерывание по завершению приема байта UART
ISR(USART_RX_vect)
{
    if (UDR0 == 'A')
    {
        PORTB |= (1 << PORTB5);  // Включить LED L при получении 'A'
    }
    else
    {
        PORTB &= ~(1 << PORTB5); // Погасить для любого другого символа
    }
}

int main(void)
{
    DDRB |= (1 << DDB5);        // PB5 (LED L) на вывод
    UBRR0 = 103;                // 9600 бод
    UCSR0B |= (1 << RXEN0) | (1 << RXCIE0); // Включение приемника и прерывания RX
    UCSR0C |= (1 << UCSZ01) | (1 << UCSZ00);

    sei();

    while (1)
    {
    }
}`
    },

    // Комплексный тест всех флагов SREG
    test_all: {
        hint: "Комплексный тест: проверка всех флагов SREG (I, T, H, S, V, N, Z, C), adiw, sbiw и математики АЛУ.",
        lang: "asm",
        code: `; Тест флагов SREG, T, ADIW и АЛУ
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
    ldi r26, 0xFE
    ldi r27, 0x00
    adiw xl, 2          ; Проверка 16-битного adiw
    break
finish:
    rjmp finish`
    },

    // Сортировка массива в ОЗУ
    sort_ram: {
        hint: "Сортировка массива в ОЗУ с использованием команды adiw и указателя X (пара r26:r27).",
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
    const selector = document.getElementById('exampleSelector');
    if (!selector) return;

    // Автоматическое наполнение выпадающего списка примерами из обеих методичек
    if (!selector.dataset.initialized) {
        selector.innerHTML = `
            <option value="lab5_asm_int1">📝 ASM Тема 5: Прерывание INT1 по низкому уровню (стр. 11)</option>
            <option value="c_interrupt_int0">⚡ C Тема 5: Прерывание INT1_vect (стр. 14)</option>
            <option value="lab5_asm_pcint">📝 ASM Тема 5: PCINT0 и PCINT2 с анализом бита (стр. 15)</option>
            <option value="lab6_asm_uart_btn">📝 ASM Тема 6: Отправка символа '>' по кнопке K1 (стр. 10)</option>
            <option value="lab6_asm_lpm_msg">📝 ASM Тема 6: LPM + BST чтение строки ReadyToWork (стр. 12)</option>
            <option value="lab6_c_rx_led">⚡ C Тема 6: Прием 'A' по USART_RX зажигает LED L (стр. 13)</option>
            <option value="test_all" selected>📝 ASM: Тест всех флагов SREG, T, ADIW и АЛУ</option>
            <option value="sort_ram">📝 ASM: Сортировка массива в ОЗУ (adiw / пара X)</option>
        `;
        selector.dataset.initialized = "true";
    }

    const key = selector.value;
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

/* =========================================================
   15. ИНИЦИАЛИЗАЦИЯ СИМУЛЯТОРА
   ========================================================= */

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

    // Горячие клавиши F11 (Шаг) и F9 (Точка останова)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F11') { e.preventDefault(); cpuStep(); }
        if (e.key === 'F9') {
            e.preventDefault();
            toggleBreakpoint(txtArea.value.substring(0, txtArea.selectionStart).split('\n').length);
        }
    });

    renderChannelSelector();
    loadSelectedExample();
    // Открываем панели при старте
    if (window.innerWidth <= 900) {
        togglePanel('editor');
    } else {
        PANEL_LIST.forEach(p => {
            const el = document.getElementById(`panel_${p}`);
            const btn = document.getElementById(`tabBtn_${p}`);
            if (el) el.classList.remove('panel-hidden');
            if (btn) btn.classList.add('active');
        });
    }
    setTimeout(resizeAnalyzerCanvas, 100);
});
