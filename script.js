/* =========================================================
   ЯДРО ЭМУЛЯТОРА AVR ATmega328P (script.js - Монолит)
   Чистые названия программ, корректная сортировка и АЛУ
   ========================================================= */

/* ================= ГЛАВА 1: ПАМЯТЬ И СОСТОЯНИЕ ================= */

const IO = {
    PINB: 0x23,  DDRB: 0x24,  PORTB: 0x25,
    PINC: 0x26,  DDRC: 0x27,  PORTC: 0x28,
    PIND: 0x29,  DDRD: 0x2A,  PORTD: 0x2B,
    SPL:  0x5D,  SPH:  0x5E,  SREG:  0x5F,
    UCSR0A: 0xC0, UCSR0B: 0xC1, UCSR0C: 0xC2,
    UBRR0L: 0xC4, UBRR0H: 0xC5, UDR0:   0xC6
};

const IO_OFFSET = 0x20;

let currentLang = 'asm'; // 'asm' или 'c'

const cpu = {
    r: new Uint8Array(32),
    prevR: new Uint8Array(32),
    ram: new Uint8Array(0x0900), // 0x0000..0x08FF
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
    memFormat: 'hex'
};

// 8 КНОПОК: PD2, PD3, PD4 и PB0, PB1
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

/* ================= ГЛАВА 2: ТРАНСЛЯТОР MICRO-C -> ASSEMBLER ================= */

function evaluateCExpression(expr) {
    if (!expr) return 0;
    expr = expr.trim();
    expr = expr.replace(/\bDDD([0-7])\b/g, '$1')
               .replace(/\bDDB([0-7])\b/g, '$1')
               .replace(/\bDDC([0-7])\b/g, '$1')
               .replace(/\bPORTD([0-7])\b/g, '$1')
               .replace(/\bPORTB([0-7])\b/g, '$1')
               .replace(/\bPORTC([0-7])\b/g, '$1')
               .replace(/\bPIND([0-7])\b/g, '$1')
               .replace(/\bPINB([0-7])\b/g, '$1')
               .replace(/\bPINC([0-7])\b/g, '$1');

    if (/^[0-9xXa-fA-F<>&|^~()+ \t-]+$/.test(expr)) {
        try {
            return Function(`'use strict'; return (${expr});`)();
        } catch (e) {}
    }
    return null;
}

function compileCToAsm(cCode) {
    const rawLines = cCode.split('\n');
    const asmList = [];
    let regCounter = 17;
    const varMap = {};
    let labelCounter = 1;
    const controlStack = [];

    asmList.push({ asm: '.include "m328pdef.inc"', lineNum: 1 });

    for (let i = 0; i < rawLines.length; i++) {
        let line = rawLines[i].trim();
        const lineNum = i + 1;

        if (line.includes('//')) line = line.substring(0, line.indexOf('//')).trim();
        if (!line || line.startsWith('#') || line.startsWith('/*') || line.includes('main(')) continue;

        if (line === '}' || line.startsWith('}')) {
            if (controlStack.length > 0) {
                const top = controlStack.pop();
                if (top.type === 'if') {
                    asmList.push({ asm: `${top.lblFalse}:`, lineNum });
                    if (top.lblEnd) asmList.push({ asm: `${top.lblEnd}:`, lineNum });
                } else if (top.type === 'else') {
                    asmList.push({ asm: `${top.lblEnd}:`, lineNum });
                } else if (top.type === 'while') {
                    asmList.push({ asm: `rjmp ${top.startLbl}`, lineNum });
                }
            }
            if (line === '}') continue;
            line = line.substring(1).trim();
            if (!line) continue;
        }

        if (line.startsWith('else')) {
            if (controlStack.length > 0 && controlStack[controlStack.length - 1].type === 'if') {
                const prevIf = controlStack.pop();
                const lblEnd = `lbl_end_${labelCounter++}`;
                asmList.push({ asm: `rjmp ${lblEnd}`, lineNum });
                asmList.push({ asm: `${prevIf.lblFalse}:`, lineNum });
                controlStack.push({ type: 'else', lblEnd });
            }
            line = line.substring(4).trim();
            if (!line || line === '{') continue;
        }

        if (line === '{') continue;

        // Объявление переменных
        const declMatch = line.match(/\b(uint8_t|int8_t|uint16_t|int16_t|uint32_t|int)\s+([a-zA-Z0-9_]+)(\s*=\s*([^;]+))?;/);
        if (declMatch) {
            const varName = declMatch[2];
            const initVal = declMatch[4] ? declMatch[4].trim() : "0";
            const reg = 'r' + (regCounter++);
            varMap[varName] = { reg };

            let constVal = evaluateCExpression(initVal);
            if (constVal !== null) {
                if (constVal > 1000) constVal = 20; // Масштабирование счётчиков для симуляции
                asmList.push({ asm: `ldi ${reg}, ${constVal & 0xFF}`, lineNum });
            }
            continue;
        }

        // DDRx |= ... / PORTx |= ...
        const portOrMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC)\s*\|\=\s*([^;]+);/);
        if (portOrMatch) {
            const portName = portOrMatch[1];
            const mask = evaluateCExpression(portOrMatch[2]) & 0xFF;
            asmList.push({ asm: `in r16, ${portName}`, lineNum });
            asmList.push({ asm: `ori r16, ${mask}`, lineNum });
            asmList.push({ asm: `out ${portName}, r16`, lineNum });
            continue;
        }

        // DDRx &= ~... / PORTx &= ~...
        const portAndNotMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD|DDRC|PORTC)\s*&\=\s*~\s*\(?\s*([^;]+)\)?;/);
        if (portAndNotMatch) {
            const portName = portAndNotMatch[1];
            const rawExpr = portAndNotMatch[2].replace(/\)+$/, '');
            const mask = evaluateCExpression(rawExpr) & 0xFF;
            const invMask = (~mask) & 0xFF;
            asmList.push({ asm: `in r16, ${portName}`, lineNum });
            asmList.push({ asm: `andi r16, ${invMask}`, lineNum });
            asmList.push({ asm: `out ${portName}, r16`, lineNum });
            continue;
        }

        // Инверсия XOR (^=)
        const portXorMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD)\s*\^\=\s*([^;]+);/);
        if (portXorMatch) {
            const portName = portXorMatch[1];
            const mask = evaluateCExpression(portXorMatch[2]) & 0xFF;
            asmList.push({ asm: `in r16, ${portName}`, lineNum });
            asmList.push({ asm: `ldi r17, ${mask}`, lineNum });
            asmList.push({ asm: `eor r16, r17`, lineNum });
            asmList.push({ asm: `out ${portName}, r16`, lineNum });
            continue;
        }

        // Присваивание порту (=)
        const portAssignMatch = line.match(/\b(DDRB|PORTB|DDRD|PORTD)\s*=\s*([^;]+);/);
        if (portAssignMatch) {
            const portName = portAssignMatch[1];
            const expr = portAssignMatch[2].trim();

            if (expr.includes('&')) {
                const parts = expr.split('&');
                const vName = parts[0].trim();
                const mask = evaluateCExpression(parts[1]) & 0xFF;
                if (varMap[vName]) {
                    asmList.push({ asm: `mov r16, ${varMap[vName].reg}`, lineNum });
                    asmList.push({ asm: `andi r16, ${mask}`, lineNum });
                    asmList.push({ asm: `out ${portName}, r16`, lineNum });
                }
            } else {
                const constVal = evaluateCExpression(expr);
                if (constVal !== null) {
                    asmList.push({ asm: `ldi r16, ${constVal & 0xFF}`, lineNum });
                    asmList.push({ asm: `out ${portName}, r16`, lineNum });
                } else if (varMap[expr]) {
                    asmList.push({ asm: `out ${portName}, ${varMap[expr].reg}`, lineNum });
                }
            }
            continue;
        }

        // Ожидание отпускания кнопки: while (!(PIND & (1 << PIND2)));
        const waitReleaseMatch = line.match(/while\s*\(\s*!\s*\(\s*(PINB|PIND)\s*&\s*\(\s*1\s*<<\s*([^)]+)\)\s*\)\s*\);/);
        if (waitReleaseMatch) {
            const pinPort = waitReleaseMatch[1];
            const bit = evaluateCExpression(waitReleaseMatch[2]);
            const waitLbl = `wait_rel_${labelCounter++}`;
            asmList.push({ asm: `${waitLbl}:`, lineNum });
            asmList.push({ asm: `in r16, ${pinPort}`, lineNum });
            asmList.push({ asm: `sbrs r16, ${bit}`, lineNum });
            asmList.push({ asm: `rjmp ${waitLbl}`, lineNum });
            continue;
        }

        // Опрос кнопки: if (!(PIND & (1 << 2))) или if ((PINB & 0x01) == 0)
        let ifBtnMatch = line.match(/if\s*\(\s*!\s*\(\s*(PINB|PIND)\s*&\s*\(\s*1\s*<<\s*([^)]+)\)\s*\)\s*\)/);
        let pinPort = '', bit = 0;

        if (ifBtnMatch) {
            pinPort = ifBtnMatch[1];
            bit = evaluateCExpression(ifBtnMatch[2]);
        } else {
            const altBtnMatch = line.match(/if\s*\(\s*\(\s*(PINB|PIND)\s*&\s*([^)]+)\)\s*==\s*0[xX]?0*\s*\)/);
            if (altBtnMatch) {
                pinPort = altBtnMatch[1];
                const mask = evaluateCExpression(altBtnMatch[2]);
                bit = Math.log2(mask) || 0;
                ifBtnMatch = true;
            }
        }

        if (ifBtnMatch) {
            const lblFalse = `lbl_skip_${labelCounter++}`;
            asmList.push({ asm: `in r16, ${pinPort}`, lineNum });
            asmList.push({ asm: `sbrc r16, ${bit}`, lineNum });
            asmList.push({ asm: `rjmp ${lblFalse}`, lineNum });
            controlStack.push({ type: 'if', lblFalse });
            continue;
        }

        // while (1)
        if (line.startsWith('while') && line.includes('1')) {
            const startLbl = `while_start_${labelCounter++}`;
            asmList.push({ asm: `${startLbl}:`, lineNum });
            controlStack.push({ type: 'while', startLbl });
            continue;
        }

        // if (count == 255) / if (flag == 0)
        const ifCmpMatch = line.match(/if\s*\(\s*([a-zA-Z0-9_]+)\s*==\s*([^)]+)\)/);
        if (ifCmpMatch) {
            const vName = ifCmpMatch[1];
            let cmpVal = evaluateCExpression(ifCmpMatch[2]);
            if (cmpVal > 1000) cmpVal = 20;
            const lblFalse = `lbl_skip_${labelCounter++}`;
            if (varMap[vName]) {
                asmList.push({ asm: `cpi ${varMap[vName].reg}, ${cmpVal & 0xFF}`, lineNum });
                asmList.push({ asm: `brne ${lblFalse}`, lineNum });
                controlStack.push({ type: 'if', lblFalse });
            }
            continue;
        }

        // step = -1; flag = 1;
        const varAssignMatch = line.match(/\b([a-zA-Z0-9_]+)\s*=\s*([^;]+);/);
        if (varAssignMatch) {
            const vName = varAssignMatch[1];
            if (varMap[vName]) {
                let constVal = evaluateCExpression(varAssignMatch[2]);
                if (constVal > 1000) constVal = 20;
                asmList.push({ asm: `ldi ${varMap[vName].reg}, ${constVal & 0xFF}`, lineNum });
            }
            continue;
        }

        // count += step;
        const addAssignMatch = line.match(/\b([a-zA-Z0-9_]+)\s*\+=\s*([a-zA-Z0-9_]+);/);
        if (addAssignMatch) {
            const v1 = addAssignMatch[1], v2 = addAssignMatch[2];
            if (varMap[v1] && varMap[v2]) {
                asmList.push({ asm: `add ${varMap[v1].reg}, ${varMap[v2].reg}`, lineNum });
            }
            continue;
        }

        // x++; count--;
        const incMatch = line.match(/\b([a-zA-Z0-9_]+)\+\+;/);
        if (incMatch && varMap[incMatch[1]]) {
            asmList.push({ asm: `inc ${varMap[incMatch[1]].reg}`, lineNum });
            continue;
        }
        const decMatch = line.match(/\b([a-zA-Z0-9_]+)--;/);
        if (decMatch && varMap[decMatch[1]]) {
            asmList.push({ asm: `dec ${varMap[decMatch[1]].reg}`, lineNum });
            continue;
        }

        if (line.includes('_delay_')) {
            asmList.push({ asm: `nop`, lineNum });
            continue;
        }
    }

    while (controlStack.length > 0) {
        const top = controlStack.pop();
        if (top.type === 'while') asmList.push({ asm: `rjmp ${top.startLbl}`, lineNum: rawLines.length });
        else if (top.type === 'if') asmList.push({ asm: `${top.lblFalse}:`, lineNum: rawLines.length });
        else if (top.type === 'else') asmList.push({ asm: `${top.lblEnd}:`, lineNum: rawLines.length });
    }

    return asmList;
}

/* ================= ГЛАВА 3: КОМПИЛЯТОР И ПАРСЕР ================= */

function parseProgram(text) {
    cpu.program = [];
    cpu.labels = {};
    cpu.error = null;

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
        let line = lines[i].trim();
        const commentIdx = line.indexOf(';');
        if (commentIdx !== -1) line = line.substring(0, commentIdx).trim();
        if (!line) continue;

        if (line.includes(':')) {
            const parts = line.split(':');
            cpu.labels[parts[0].trim().toLowerCase()] = instIndex;
            line = parts.slice(1).join(':').trim();
            if (!line) continue;
        }

        if (line.toLowerCase().startsWith('.db')) {
            const strPart = line.substring(3).trim().replace(/['"]/g, '');
            cpu.program.push({ type: 'DATA_DB', str: strPart, lineNum: i + 1 });
            instIndex++;
            continue;
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
    if (arg.includes('1<<txen0')) return 0x08;
    if (arg.includes('1<<ucsz00') || arg.includes('1<<ucsz01')) return 0x06;

    const upper = arg.toUpperCase();
    if (IO[upper] !== undefined) {
        return IO[upper] < 0x60 ? IO[upper] - IO_OFFSET : IO[upper];
    }

    if (arg.startsWith('$')) return parseInt(arg.substring(1), 16) || 0;
    if (arg.startsWith('0x')) return parseInt(arg.substring(2), 16) || 0;
    if (arg.startsWith('0b')) return parseInt(arg.substring(2), 2) || 0;
    const dec = parseInt(arg, 10);
    if (!isNaN(dec)) return dec;
    return 0;
}

function resolveIoRamAddr(token) {
    if (!token) return 0;
    const upper = token.trim().toUpperCase();
    if (IO[upper] !== undefined) return IO[upper];
    const num = parseVal(token);
    if (num >= 0 && num <= 0x3F) return num + IO_OFFSET;
    return num;
}

function resolveDataRamAddr(token) {
    if (!token) return 0;
    const upper = token.trim().toUpperCase();
    if (IO[upper] !== undefined) return IO[upper];
    return parseVal(token);
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

/* ================= ГЛАВА 4: АЛУ И ВЫПОЛНЕНИЕ ================= */

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

function setFlagsShift(val, carryOut) {
    cpu.sreg.C = carryOut ? 1 : 0;
    cpu.sreg.Z = ((val & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (val & 0x80) ? 1 : 0;
    cpu.sreg.V = cpu.sreg.N ^ cpu.sreg.C;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
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
            const r1 = parseReg(a[0]);
            const k = parseVal(a[1]) & 0xFF;
            const res = cpu.r[r1] - k;
            setFlagsSub(cpu.r[r1], k, res);
            cpu.r[r1] = res & 0xFF; break;
        }
        case 'adiw': {
            let ptrName = a[0].replace('l','').replace('h','');
            let cur = getPointerAddr(ptrName);
            let k = parseVal(a[1]);
            let sum = cur + k;
            setPointerAddr(ptrName, sum & 0xFFFF);
            cpu.sreg.C = (sum > 0xFFFF) ? 1 : 0;
            cpu.sreg.Z = ((sum & 0xFFFF) === 0) ? 1 : 0;
            cpu.sreg.N = (sum & 0x8000) ? 1 : 0;
            cpu.sreg.V = (!(cur & 0x8000) && (sum & 0x8000)) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V; break;
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
            cpu.sreg.H = (((0 - (val & 0x0F)) < 0) ? 1 : 0);
            cpu.sreg.C = (res !== 0) ? 1 : 0;
            cpu.sreg.Z = (res === 0) ? 1 : 0;
            cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.sreg.V = (val === 0x80) ? 1 : 0;
            cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
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
        case 'sbi': {
            const addr = resolveIoRamAddr(a[0]);
            writeRAM(addr, readRAM(addr) | (1 << parseVal(a[1]))); break;
        }
        case 'cbi': {
            const addr = resolveIoRamAddr(a[0]);
            writeRAM(addr, readRAM(addr) & ~(1 << parseVal(a[1]))); break;
        }
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
    updateUI();

    if (cpu.running && cpu.pc < cpu.program.length) {
        if (cpu.breakpoints.has(cpu.program[cpu.pc].lineNum
