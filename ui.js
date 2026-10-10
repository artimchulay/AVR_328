/* =========================================================
   ИНТЕРФЕЙС И РЕНДЕР (ui.js)
   ========================================================= */

import { cpu, IO, vButtons, parseProgram, cpuStep, readRAM, getPointerAddr } from './cpu.js';

export function updateUI() {
    document.getElementById('cycleCounter').textContent = `Такты: ${cpu.cycles}`;
    
    const statusElem = document.getElementById('compilerStatus');
    if (cpu.error) {
        statusElem.textContent = '❌ ' + cpu.error;
        statusElem.style.color = '#ff3d00';
    } else {
        const curLine = cpu.program[cpu.pc]?.lineNum || 'END';
        statusElem.textContent = `Строка: ${curLine}`;
        statusElem.style.color = '#8b9bb4';
    }

    document.getElementById('valPC').textContent = '0x' + cpu.pc.toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valSP').textContent = '0x' + cpu.sp.toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valX').textContent = '0x' + getPointerAddr('x').toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valY').textContent = '0x' + getPointerAddr('y').toString(16).padStart(4, '0').toUpperCase();
    document.getElementById('valZ').textContent = '0x' + getPointerAddr('z').toString(16).padStart(4, '0').toUpperCase();

    renderFlags();
    renderRegisters();
    renderMemoryDumps();
    renderHardware();
    renderGutter();
}

function renderFlags() {
    const grid = document.getElementById('flagsGrid');
    const order = ['I', 'T', 'H', 'S', 'V', 'N', 'Z', 'C'];
    grid.innerHTML = order.map(f => `
        <div class="flag-cell ${cpu.sreg[f] ? 'flag-on' : ''}">
            <span>${f}</span>
            <b>${cpu.sreg[f]}</b>
        </div>
    `).join('');
}

function renderRegisters() {
    const grid = document.getElementById('registersGrid');
    let html = '';
    for (let i = 0; i < 32; i++) {
        const changed = cpu.r[i] !== cpu.prevR[i];
        const hex = cpu.r[i].toString(16).padStart(2, '0').toUpperCase();
        html += `
            <div class="reg-cell ${changed ? 'changed' : ''}">
                <span class="reg-name">R${i}</span>
                <span class="reg-val-hex">0x${hex}</span>
                <span class="reg-val-dec">(${cpu.r[i]})</span>
            </div>
        `;
    }
    grid.innerHTML = html;
}

export function renderMemoryDumps() {
    const memBox = document.getElementById('memDumpView');
    let output = '';

    if (cpu.memView === 'ram') {
        for (let addr = 0x0100; addr <= 0x0138; addr += 8) {
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
                const curAddr = addr + b;
                const isSP = (curAddr === cpu.sp);
                let val = readRAM(curAddr);
                let valStr = cpu.memFormat === 'dec' ? val.toString(10).padStart(3, '0') : val.toString(16).padStart(2, '0').toUpperCase();
                bytes.push(isSP ? `[${valStr}]` : ` ${valStr} `);
            }
            output += `0x${addr.toString(16).toUpperCase()}: ${bytes.join(' ')}\n`;
        }
    }
    memBox.textContent = output;
}

export function renderHardware() {
    const portB = readRAM(IO.PORTB);
    const isPB5On = (portB & (1 << 5)) !== 0;
    const ledPB5 = document.getElementById('ledPB5');
    if (ledPB5) ledPB5.className = 'led-light ' + (isPB5On ? 'active-led-yellow' : '');

    let currentVal = 0;
    if (cpu.selectedPort === 'D') currentVal = readRAM(IO.PORTD);
    if (cpu.selectedPort === 'B') currentVal = readRAM(IO.PORTB);
    if (cpu.selectedPort === 'C') currentVal = readRAM(IO.PORTC);

    for (let i = 7; i >= 0; i--) {
        const led = document.getElementById(`ledPin${i}`);
        const bitLbl = document.getElementById(`lblPin${i}`);
        if (led && bitLbl) {
            bitLbl.textContent = `${cpu.selectedPort}${i}`;
            const isOn = (currentVal & (1 << i)) !== 0;
            led.className = 'led-light ' + (isOn ? 'active-led-green' : '');
        }
    }

    const term = document.getElementById('uartTerminal');
    if (term && term.textContent !== cpu.uartLog) {
        term.textContent = cpu.uartLog || "UART готов к приёму данных...";
        term.scrollTop = term.scrollHeight;
    }
}

export function renderGutter() {
    const code = document.getElementById('asmCode').value;
    const linesCount = code.split('\n').length;
    const gutter = document.getElementById('lineGutter');
    const currentLineNum = cpu.program[cpu.pc]?.lineNum || -1;

    let html = '';
    for (let i = 1; i <= linesCount; i++) {
        const hasBP = cpu.breakpoints.has(i);
        const isPC = (i === currentLineNum);
        html += `
            <div class="gutter-row ${hasBP ? 'has-bp' : ''} ${isPC ? 'is-pc' : ''}" onclick="window.toggleBreakpoint(${i})">
                <span class="bp-marker"></span>
                <span class="pc-arrow">▶</span>
                <span class="gutter-num">${i}</span>
            </div>
        `;
    }
    gutter.innerHTML = html;
}

const KNOWN_OPS = new Set([
    'ldi', 'mov', 'add', 'adc', 'sub', 'subi', 'sbc', 'sbci', 'mul', 'muls', 'adiw', 'sbiw',
    'inc', 'dec', 'neg', 'com', 'and', 'andi', 'or', 'ori', 'eor', 'clr', 'ser',
    'cpi', 'cp', 'cpc', 'tst', 'swap', 'ror', 'rol', 'lsl', 'lsr', 'asr',
    'sbi', 'cbi', 'bst', 'bld', 'sbrs', 'sbrc', 'sec', 'clc', 'sez', 'clz',
    'st', 'std', 'ld', 'ldd', 'lpm', 'sts', 'lds', 'push', 'pop',
    'jmp', 'rjmp', 'breq', 'brne', 'brcs', 'brcc', 'brlo', 'brsh', 'brlt', 'brge',
    'brmi', 'brpl', 'call', 'ret', 'in', 'out', 'break', 'nop'
]);

export function highlightCode(rawText) {
    const lines = rawText.split('\n');
    return lines.map(line => {
        let comment = '';
        let codePart = line;

        const commentIdx = line.indexOf(';');
        if (commentIdx !== -1) {
            codePart = line.substring(0, commentIdx);
            comment = line.substring(commentIdx);
        }

        let processed = codePart
            .replace(/^(\s*)([a-zA-Z0-9_]+:)/g, '$1<span class="syn-lbl">$2</span>')
            .replace(/(\.[a-zA-Z0-9_]+)/g, '<span class="syn-dir">$1</span>')
            .replace(/\b(\$[0-9a-fA-F]+|0x[0-9a-fA-F]+|0b[01]+|\d+)\b/g, '<span class="syn-num">$1</span>');

        processed = processed.replace(/\b([a-zA-Z]+)\b/g, (match) => {
            if (KNOWN_OPS.has(match.toLowerCase())) return `<span class="syn-op">${match}</span>`;
            return match;
        });

        return processed + (comment ? `<span class="syn-com">${escapeHtml(comment)}</span>` : '');
    }).join('\n');
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function updateSyntax() {
    const code = document.getElementById('asmCode').value;
    document.getElementById('highlightingContent').innerHTML = highlightCode(code) + '\n';
    renderGutter();
}

export function scrollToSlide(index) {
    const viewport = document.getElementById('sliderViewport');
    const panelWidth = viewport.clientWidth;
    viewport.scrollTo({ left: panelWidth * index, behavior: 'smooth' });
    const btns = document.querySelectorAll('.nav-screen-btn');
    btns.forEach((b, i) => b.classList.toggle('active', i === index));
}
