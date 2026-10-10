/* =========================================================
   ГЛАВНЫЙ МОДУЛЬ ИНИЦИАЛИЗАЦИИ (main.js)
   ========================================================= */

import { cpu, vButtons, parseProgram, cpuStep, syncHardwareState } from './cpu.js';
import { updateUI, updateSyntax, renderMemoryDumps, scrollToSlide, renderHardware } from './ui.js';

const PROGRAMS = {
    empty: {
        hint: "",
        code: `; Новый чистый файл\n.include "m328pdef.inc"\n\nstart:\n    \n`
    },
    sort_ram: {
        hint: "Программа записывает 5 чисел в ОЗУ (0x0100..0x0104) и <b>сортирует их по возрастанию</b>.",
        code:
`; Сортировка массива в ОЗУ (0x0100)
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

ldi r20, 4
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
    },
    btn_counter: {
        hint: "Нажмите кнопку <b>K3 (PB0)</b> (+1) или <b>K4 (PB1)</b> (-1). Порт D покажет результат!",
        code:
`; Счётчик по кнопкам
.include "m328pdef.inc"
start:
    ser r16
    out DDRD, r16
    cbi DDRB, 0
    cbi DDRB, 1
    sbi PORTB, 0
    sbi PORTB, 1
    clr r0
loop:
    out PORTD, r0
    in r17, PINB
    sbrs r17, 0
    inc r0
    sbrs r17, 1
    dec r0
    rjmp loop`
    },
    led_blink: {
        hint: "Автоматический счётчик от 0 до 255 на Порту D.",
        code:
`; Бегущий огонёк
.include "m328pdef.inc"
start:
    ldi r16, 0xFF
    out DDRD, r16
    ldi r17, 0x00
loop:
    out PORTD, r17
    inc r17
    rjmp loop`
    }
};

function loadSelectedExample() {
    const key = document.getElementById('exampleSelector').value;
    const banner = document.getElementById('hintBanner');
    if (PROGRAMS[key]) {
        document.getElementById('asmCode').value = PROGRAMS[key].code;
        if (key === 'empty' || !PROGRAMS[key].hint) {
            banner.style.display = 'none';
        } else {
            banner.style.display = 'flex';
            document.getElementById('hintText').innerHTML = PROGRAMS[key].hint;
        }
        updateSyntax();
        window.cpuReset();
    }
}

window.cpuReset = function() {
    haltExecution();
    cpu.r.fill(0);
    cpu.prevR.fill(0);
    cpu.ram.fill(0);
    cpu.pc = 0;
    cpu.sp = 0x08FF;
    cpu.cycles = 0;
    cpu.sreg = { C:0, Z:0, N:0, V:0, S:0, H:0, T:0, I:0 };
    cpu.uartLog = "";

    parseProgram(document.getElementById('asmCode').value);
    syncHardwareState();
    updateUI();
};

function haltExecution() {
    cpu.running = false;
    clearTimeout(cpu.timer);
    const btn = document.getElementById('btnRun');
    if (btn) btn.classList.remove('running');
    document.getElementById('runIcon').textContent = '▶';
    document.getElementById('runText').textContent = 'Пуск';
}

function runLoop() {
    if (!cpu.running) return;
    const batchSize = Math.max(1, Math.floor(cpu.speed / 20));
    for (let i = 0; i < batchSize; i++) {
        cpuStep(updateUI, haltExecution);
        if (!cpu.running || cpu.error) {
            haltExecution();
            break;
        }
    }
    if (cpu.running) {
        const interval = Math.max(10, Math.floor(1000 / cpu.speed));
        cpu.timer = setTimeout(runLoop, interval);
    }
}

function toggleRun() {
    if (cpu.error) return;
    cpu.running = !cpu.running;
    const btn = document.getElementById('btnRun');
    const icon = document.getElementById('runIcon');
    const txt = document.getElementById('runText');
    if (cpu.running) {
        btn.classList.add('running');
        icon.textContent = '⏸';
        txt.textContent = 'Пауза';
        runLoop();
    } else {
        haltExecution();
    }
}

window.toggleVButton = function(id) {
    const btn = vButtons.find(b => b.id === id);
    if (!btn) return;
    btn.pressed = !btn.pressed;
    document.getElementById('vbtn_' + id)?.classList.toggle('latched', btn.pressed);
    syncHardwareState();
    updateUI();
};

window.selectLedPort = function(portLetter) {
    cpu.selectedPort = portLetter;
    document.querySelectorAll('.port-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btnPort' + portLetter)?.classList.add('active');
    document.getElementById('ledPortTitle').textContent = `Линейка светодиодов (Порт ${portLetter})`;
    renderHardware();
};

window.setMemView = function(view) {
    cpu.memView = view;
    document.getElementById('btnMemRAM').classList.toggle('active', view === 'ram');
    document.getElementById('btnMemStack').classList.toggle('active', view === 'stack');
    renderMemoryDumps();
};

window.setMemFormat = function(format) {
    cpu.memFormat = format;
    document.getElementById('btnFmtHex').classList.toggle('active', format === 'hex');
    document.getElementById('btnFmtDec').classList.toggle('active', format === 'dec');
    renderMemoryDumps();
};

window.toggleBreakpoint = function(lineNum) {
    if (cpu.breakpoints.has(lineNum)) cpu.breakpoints.delete(lineNum);
    else cpu.breakpoints.add(lineNum);
    updateSyntax();
};

window.clearUart = function() {
    cpu.uartLog = "";
    renderHardware();
};

window.scrollToSlide = scrollToSlide;
window.loadSelectedExample = loadSelectedExample;

document.addEventListener('DOMContentLoaded', () => {
    const txtArea = document.getElementById('asmCode');
    const highlighting = document.getElementById('highlighting');
    const gutter = document.getElementById('lineGutter');

    txtArea.addEventListener('input', () => {
        updateSyntax();
        window.cpuReset();
    });

    txtArea.addEventListener('scroll', () => {
        highlighting.scrollTop = txtArea.scrollTop;
        highlighting.scrollLeft = txtArea.scrollLeft;
        gutter.scrollTop = txtArea.scrollTop;
    });

    document.getElementById('btnStep').addEventListener('click', () => cpuStep(updateUI, haltExecution));
    document.getElementById('btnRun').addEventListener('click', toggleRun);
    document.getElementById('btnReset').addEventListener('click', window.cpuReset);
    document.getElementById('exampleSelector').addEventListener('change', loadSelectedExample);
    document.getElementById('btnClearCode').addEventListener('click', () => {
        document.getElementById('asmCode').value = '';
        document.getElementById('exampleSelector').value = 'empty';
        document.getElementById('hintBanner').style.display = 'none';
        cpu.breakpoints.clear();
        updateSyntax();
        window.cpuReset();
    });

    document.getElementById('speedRange').addEventListener('input', (e) => {
        cpu.speed = parseInt(e.target.value, 10);
        document.getElementById('speedVal').textContent = cpu.speed + ' оп/с';
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
            e.preventDefault();
            cpuStep(updateUI, haltExecution);
        }
        if (e.key === 'F9') {
            e.preventDefault();
            const text = txtArea.value.substring(0, txtArea.selectionStart);
            const lineNum = text.split('\n').length;
            window.toggleBreakpoint(lineNum);
        }
    });

    loadSelectedExample();
});
