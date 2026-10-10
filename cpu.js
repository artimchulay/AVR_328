/* =========================================================
   ЯДРО ПРОЦЕССОРА AVR ATmega328P (cpu.js)
   ========================================================= */

export const IO = {
    PINB: 0x23,  DDRB: 0x24,  PORTB: 0x25,
    PINC: 0x26,  DDRC: 0x27,  PORTC: 0x28,
    PIND: 0x29,  DDRD: 0x2A,  PORTD: 0x2B,
    SPL:  0x5D,  SPH:  0x5E,  SREG:  0x5F,
    UCSR0A: 0xC0, UCSR0B: 0xC1, UCSR0C: 0xC2,
    UBRR0L: 0xC4, UBRR0H: 0xC5, UDR0:   0xC6
};

export const cpu = {
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
    memFormat: 'hex'
};

export const vButtons = [
    { id: 'K1', port: 'D', pin: 2, pressed: false },
    { id: 'K2', port: 'D', pin: 3, pressed: false },
    { id: 'K3', port: 'B', pin: 0, pressed: false },
    { id: 'K4', port: 'B', pin: 1, pressed: false },
    { id: 'K5', port: 'B', pin: 2, pressed: false },
    { id: 'K6', port: 'B', pin: 3, pressed: false },
    { id: 'K7', port: 'B', pin: 4, pressed: false },
    { id: 'K8', port: 'B', pin: 5, pressed: false }
];

export function parseReg(arg) {
    if (!arg) return 0;
    arg = arg.trim().toLowerCase();
    const aliases = { 'xl': 26, 'xh': 27, 'yl': 28, 'yh': 29, 'zl': 30, 'zh': 31 };
    if (aliases[arg] !== undefined) return aliases[arg];
    const clean = arg.replace(/[^0-9]/g, '');
    return Math.min(31, Math.max(0, parseInt(clean, 10) || 0));
}

export function parseVal(arg) {
    if (!arg) return 0;
    arg = arg.trim().toLowerCase();
    if (arg.includes('low(ramend)')) return 0xFF;
    if (arg.includes('high(ramend)')) return 0x08;
    if (arg.includes('1<<txen0')) return 0x08;
    if (arg.includes('1<<ucsz00') || arg.includes('1<<ucsz01')) return 0x06;

    if (arg.startsWith('$')) return parseInt(arg.substring(1), 16);
    if (arg.startsWith('0x')) return parseInt(arg.substring(2), 16);
    if (arg.startsWith('0b')) return parseInt(arg.substring(2), 2);
    if (!isNaN(parseInt(arg, 10))) return parseInt(arg, 10);
    return 0;
}

export function parseProgram(text) {
    const lines = text.split('\n');
    cpu.program = [];
    cpu.labels = {};
    cpu.error = null;
    let instIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        const commentIdx = line.indexOf(';');
        if (commentIdx !== -1) line = line.substring(0, commentIdx).trim();
        if (!line) continue;

        if (line.includes(':')) {
            const parts = line.split(':');
            const lbl = parts[0].trim();
            cpu.labels[lbl.toLowerCase()] = instIndex;
            line = parts.slice(1).join(':').trim();
            if (!line) continue;
        }

        if (line.toLowerCase().startsWith('.db')) {
            const strPart = line.substring(3).trim();
            const rawStr = strPart.replace(/['"]/g, '');
            cpu.program.push({ type: 'DATA_DB', str: rawStr, lineNum: i + 1 });
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

export function writeRAM(addr, val) {
    if (addr >= 0 && addr < cpu.ram.length) cpu.ram[addr] = val & 0xFF;
}

export function readRAM(addr) {
    if (addr >= 0 && addr < cpu.ram.length) return cpu.ram[addr];
    return 0;
}

export function getPointerAddr(name) {
    name = name.toLowerCase();
    if (name === 'x' || name === 'xl' || name === 'xh') return (cpu.r[27] << 8) | cpu.r[26];
    if (name === 'y' || name === 'yl' || name === 'yh') return (cpu.r[29] << 8) | cpu.r[28];
    if (name === 'z' || name === 'zl' || name === 'zh') return (cpu.r[31] << 8) | cpu.r[30];
    return 0;
}

export function setPointerAddr(name, val) {
    name = name.toLowerCase();
    val &= 0xFFFF;
    if (name === 'x' || name === 'xl' || name === 'xh') { cpu.r[27] = (val >> 8) & 0xFF; cpu.r[26] = val & 0xFF; }
    if (name === 'y' || name === 'yl' || name === 'yh') { cpu.r[29] = (val >> 8) & 0xFF; cpu.r[28] = val & 0xFF; }
    if (name === 'z' || name === 'zl' || name === 'zh') { cpu.r[31] = (val >> 8) & 0xFF; cpu.r[30] = val & 0xFF; }
}

function setFlagsAdd(a, b, res) {
    cpu.sreg.C = (res > 0xFF) ? 1 : 0;
    cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (res & 0x80) ? 1 : 0;
    cpu.sreg.V = (!((a ^ b) & 0x80) && ((a ^ res) & 0x80)) ? 1 : 0;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
}

function setFlagsSub(a, b, res) {
    cpu.sreg.C = (a < b) ? 1 : 0;
    cpu.sreg.Z = ((res & 0xFF) === 0) ? 1 : 0;
    cpu.sreg.N = (res & 0x80) ? 1 : 0;
    cpu.sreg.V = (((a ^ b) & 0x80) && ((a ^ res) & 0x80)) ? 1 : 0;
    cpu.sreg.S = cpu.sreg.N ^ cpu.sreg.V;
}

function setFlagsLogic(val) {
    cpu.sreg.Z = (val === 0) ? 1 : 0;
    cpu.sreg.N = (val & 0x80) ? 1 : 0;
    cpu.sreg.V = 0;
    cpu.sreg.S = cpu.sreg.N;
}

export function cpuStep(onUpdateCallback, onHaltCallback) {
    if (cpu.error) {
        onHaltCallback();
        onUpdateCallback();
        return;
    }

    if (cpu.program.length === 0) {
        parseProgram(document.getElementById('asmCode').value);
    }
    if (cpu.program.length === 0 || cpu.error) {
        onHaltCallback();
        onUpdateCallback();
        return;
    }

    if (cpu.pc >= cpu.program.length) {
        onHaltCallback();
        onUpdateCallback();
        return;
    }

    cpu.prevR.set(cpu.r);
    const inst = cpu.program[cpu.pc];
    const op = inst.op;
    const a = inst.args;
    let nextPC = cpu.pc + 1;

    if (op === 'break') {
        onHaltCallback();
        onUpdateCallback();
        return;
    }

    switch (op) {
        case 'ldi': { cpu.r[parseReg(a[0])] = parseVal(a[1]) & 0xFF; break; }
        case 'mov': { cpu.r[parseReg(a[0])] = cpu.r[parseReg(a[1])]; break; }
        case 'in': {
            let addr = IO[a[1].toUpperCase()] !== undefined ? IO[a[1].toUpperCase()] : parseVal(a[1]);
            cpu.r[parseReg(a[0])] = readRAM(addr);
            break;
        }
        case 'out': {
            let addr = IO[a[0].toUpperCase()] !== undefined ? IO[a[0].toUpperCase()] : parseVal(a[0]);
            writeRAM(addr, cpu.r[parseReg(a[1])]);
            if (a[0].toUpperCase() === 'UDR0' || addr === IO.UDR0) {
                cpu.uartLog += String.fromCharCode(cpu.r[parseReg(a[1])]);
            }
            break;
        }
        case 'add': {
            const res = cpu.r[parseReg(a[0])] + cpu.r[parseReg(a[1])];
            setFlagsAdd(cpu.r[parseReg(a[0])], cpu.r[parseReg(a[1])], res);
            cpu.r[parseReg(a[0])] = res & 0xFF;
            break;
        }
        case 'adc': {
            const res = cpu.r[parseReg(a[0])] + cpu.r[parseReg(a[1])] + cpu.sreg.C;
            setFlagsAdd(cpu.r[parseReg(a[0])], cpu.r[parseReg(a[1])], res);
            cpu.r[parseReg(a[0])] = res & 0xFF;
            break;
        }
        case 'sub':
        case 'subi': {
            const k = (op === 'sub') ? cpu.r[parseReg(a[1])] : parseVal(a[1]);
            const res = cpu.r[parseReg(a[0])] - k;
            setFlagsSub(cpu.r[parseReg(a[0])], k, res);
            cpu.r[parseReg(a[0])] = res & 0xFF;
            break;
        }
        case 'sbc':
        case 'sbci': {
            const k = (op === 'sbc') ? cpu.r[parseReg(a[1])] : parseVal(a[1]);
            const res = cpu.r[parseReg(a[0])] - k - cpu.sreg.C;
            setFlagsSub(cpu.r[parseReg(a[0])], k + cpu.sreg.C, res);
            cpu.r[parseReg(a[0])] = res & 0xFF;
            break;
        }
        case 'mul': {
            const res = cpu.r[parseReg(a[0])] * cpu.r[parseReg(a[1])];
            cpu.r[0] = res & 0xFF; cpu.r[1] = (res >> 8) & 0xFF;
            cpu.sreg.C = (res & 0x8000) ? 1 : 0; cpu.sreg.Z = (res === 0) ? 1 : 0;
            break;
        }
        case 'muls': {
            const v1 = (cpu.r[parseReg(a[0])] & 0x80) ? cpu.r[parseReg(a[0])] - 256 : cpu.r[parseReg(a[0])];
            const v2 = (cpu.r[parseReg(a[1])] & 0x80) ? cpu.r[parseReg(a[1])] - 256 : cpu.r[parseReg(a[1])];
            const res = (v1 * v2) & 0xFFFF;
            cpu.r[0] = res & 0xFF; cpu.r[1] = (res >> 8) & 0xFF;
            cpu.sreg.C = (res & 0x8000) ? 1 : 0; cpu.sreg.Z = (res === 0) ? 1 : 0;
            break;
        }
        case 'adiw': {
            let val = (getPointerAddr(a[0].replace('l','').replace('h','')) + parseVal(a[1])) & 0xFFFF;
            setPointerAddr(a[0].replace('l','').replace('h',''), val);
            cpu.sreg.Z = (val === 0) ? 1 : 0; cpu.sreg.C = (val > 0xFFFF) ? 1 : 0;
            break;
        }
        case 'sbiw': {
            let val = (getPointerAddr(a[0].replace('l','').replace('h','')) - parseVal(a[1])) & 0xFFFF;
            setPointerAddr(a[0].replace('l','').replace('h',''), val);
            cpu.sreg.Z = (val === 0) ? 1 : 0; cpu.sreg.C = (val < 0) ? 1 : 0;
            break;
        }
        case 'inc': {
            const res = (cpu.r[parseReg(a[0])] + 1) & 0xFF;
            cpu.sreg.Z = (res === 0) ? 1 : 0; cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.r[parseReg(a[0])] = res;
            break;
        }
        case 'dec': {
            const res = (cpu.r[parseReg(a[0])] - 1) & 0xFF;
            cpu.sreg.Z = (res === 0) ? 1 : 0; cpu.sreg.N = (res & 0x80) ? 1 : 0;
            cpu.r[parseReg(a[0])] = res;
            break;
        }
        case 'neg': {
            const res = (0 - cpu.r[parseReg(a[0])]) & 0xFF;
            cpu.sreg.C = (res !== 0) ? 1 : 0; setFlagsLogic(res);
            cpu.r[parseReg(a[0])] = res;
            break;
        }
        case 'com': {
            cpu.r[parseReg(a[0])] = (~cpu.r[parseReg(a[0])]) & 0xFF;
            cpu.sreg.C = 1; setFlagsLogic(cpu.r[parseReg(a[0])]);
            break;
        }
        case 'cp':
        case 'cpi': {
            const k = (op === 'cp') ? cpu.r[parseReg(a[1])] : parseVal(a[1]);
            setFlagsSub(cpu.r[parseReg(a[0])], k, cpu.r[parseReg(a[0])] - k);
            break;
        }
        case 'cpc': {
            const k = cpu.r[parseReg(a[1])];
            const res = cpu.r[parseReg(a[0])] - k - cpu.sreg.C;
            const prevZ = cpu.sreg.Z;
            setFlagsSub(cpu.r[parseReg(a[0])], k + cpu.sreg.C, res);
            cpu.sreg.Z = (prevZ === 1 && (res & 0xFF) === 0) ? 1 : 0;
            break;
        }
        case 'tst': { setFlagsLogic(cpu.r[parseReg(a[0])]); break; }
        case 'and':
        case 'andi': {
            const k = (op === 'and') ? cpu.r[parseReg(a[1])] : parseVal(a[1]);
            cpu.r[parseReg(a[0])] &= k; setFlagsLogic(cpu.r[parseReg(a[0])]);
            break;
        }
        case 'or':
        case 'ori': {
            const k = (op === 'or') ? cpu.r[parseReg(a[1])] : parseVal(a[1]);
            cpu.r[parseReg(a[0])] |= k; setFlagsLogic(cpu.r[parseReg(a[0])]);
            break;
        }
        case 'eor': {
            cpu.r[parseReg(a[0])] ^= cpu.r[parseReg(a[1])]; setFlagsLogic(cpu.r[parseReg(a[0])]);
            break;
        }
        case 'clr': { cpu.r[parseReg(a[0])] = 0; setFlagsLogic(0); break; }
        case 'ser': { cpu.r[parseReg(a[0])] = 0xFF; break; }
        case 'swap': {
            const v = cpu.r[parseReg(a[0])];
            cpu.r[parseReg(a[0])] = ((v & 0x0F) << 4) | ((v & 0xF0) >> 4);
            break;
        }
        case 'lsl': {
            cpu.sreg.C = (cpu.r[parseReg(a[0])] & 0x80) ? 1 : 0;
            cpu.r[parseReg(a[0])] = (cpu.r[parseReg(a[0])] << 1) & 0xFF;
            setFlagsLogic(cpu.r[parseReg(a[0])]);
            break;
        }
        case 'lsr': {
            cpu.sreg.C = cpu.r[parseReg(a[0])] & 1;
            cpu.r[parseReg(a[0])] = cpu.r[parseReg(a[0])] >> 1;
            setFlagsLogic(cpu.r[parseReg(a[0])]);
            break;
        }
        case 'asr': {
            const msb = cpu.r[parseReg(a[0])] & 0x80;
            cpu.sreg.C = cpu.r[parseReg(a[0])] & 1;
            cpu.r[parseReg(a[0])] = (cpu.r[parseReg(a[0])] >> 1) | msb;
            setFlagsLogic(cpu.r[parseReg(a[0])]);
            break;
        }
        case 'ror': {
            const oldC = cpu.sreg.C;
            cpu.sreg.C = cpu.r[parseReg(a[0])] & 1;
            cpu.r[parseReg(a[0])] = (cpu.r[parseReg(a[0])] >> 1) | (oldC << 7);
            setFlagsLogic(cpu.r[parseReg(a[0])]);
            break;
        }
        case 'rol': {
            const oldC = cpu.sreg.C;
            cpu.sreg.C = (cpu.r[parseReg(a[0])] & 0x80) ? 1 : 0;
            cpu.r[parseReg(a[0])] = ((cpu.r[parseReg(a[0])] << 1) & 0xFF) | oldC;
            setFlagsLogic(cpu.r[parseReg(a[0])]);
            break;
        }
        case 'sbi': {
            let addr = IO[a[0].toUpperCase()] !== undefined ? IO[a[0].toUpperCase()] : parseVal(a[0]);
            writeRAM(addr, readRAM(addr) | (1 << parseVal(a[1])));
            break;
        }
        case 'cbi': {
            let addr = IO[a[0].toUpperCase()] !== undefined ? IO[a[0].toUpperCase()] : parseVal(a[0]);
            writeRAM(addr, readRAM(addr) & ~(1 << parseVal(a[1])));
            break;
        }
        case 'bst': { cpu.sreg.T = (cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) ? 1 : 0; break; }
        case 'bld': {
            if (cpu.sreg.T) cpu.r[parseReg(a[0])] |= (1 << parseVal(a[1]));
            else cpu.r[parseReg(a[0])] &= ~(1 << parseVal(a[1]));
            break;
        }
        case 'sbrs': { if ((cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) !== 0) nextPC++; break; }
        case 'sbrc': { if ((cpu.r[parseReg(a[0])] & (1 << parseVal(a[1]))) === 0) nextPC++; break; }
        case 'jmp':
        case 'rjmp': {
            if (cpu.labels[a[0].toLowerCase()] !== undefined) nextPC = cpu.labels[a[0].toLowerCase()];
            break;
        }
        case 'breq': { if (cpu.sreg.Z === 1) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brne': { if (cpu.sreg.Z === 0) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brcs':
        case 'brlo': { if (cpu.sreg.C === 1) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brcc':
        case 'brsh': { if (cpu.sreg.C === 0) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brlt': { if (cpu.sreg.S === 1) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brge': { if (cpu.sreg.S === 0) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brmi': { if (cpu.sreg.N === 1) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brpl': { if (cpu.sreg.N === 0) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brts': { if (cpu.sreg.T === 1) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'brtc': { if (cpu.sreg.T === 0) nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC; break; }
        case 'call': {
            writeRAM(cpu.sp, (nextPC >> 8) & 0xFF); writeRAM(cpu.sp - 1, nextPC & 0xFF);
            cpu.sp = (cpu.sp - 2) & 0x08FF;
            nextPC = cpu.labels[a[0].toLowerCase()] ?? nextPC;
            break;
        }
        case 'ret': {
            const high = readRAM(cpu.sp + 2), low = readRAM(cpu.sp + 1);
            cpu.sp = (cpu.sp + 2) & 0x08FF; nextPC = (high << 8) | low;
            break;
        }
        case 'sts': { writeRAM(parseVal(a[0]), cpu.r[parseReg(a[1])]); break; }
        case 'lds': { cpu.r[parseReg(a[0])] = readRAM(parseVal(a[1])); break; }
        case 'st': {
            let addr = getPointerAddr(a[0].replace('+', '').replace('-', ''));
            if (a[0].includes('-')) { addr--; setPointerAddr(a[0].replace('-', ''), addr); }
            writeRAM(addr, cpu.r[parseReg(a[1])]);
            if (a[0].includes('+')) setPointerAddr(a[0].replace('+', ''), addr + 1);
            break;
        }
        case 'ld': {
            let addr = getPointerAddr(a[1].replace('+', '').replace('-', ''));
            if (a[1].includes('-')) { addr--; setPointerAddr(a[1].replace('-', ''), addr); }
            cpu.r[parseReg(a[0])] = readRAM(addr);
            if (a[1].includes('+')) setPointerAddr(a[1].replace('+', ''), addr + 1);
            break;
        }
        case 'std': {
            const parts = a[0].toLowerCase().split('+');
            writeRAM(getPointerAddr(parts[0].trim()) + parseInt(parts[1] || '0', 10), cpu.r[parseReg(a[1])]);
            break;
        }
        case 'ldd': {
            const parts = a[1].toLowerCase().split('+');
            cpu.r[parseReg(a[0])] = readRAM(getPointerAddr(parts[0].trim()) + parseInt(parts[1] || '0', 10));
            break;
        }
        case 'lpm': {
            const dataObj = cpu.program.find(p => p.type === 'DATA_DB');
            if (dataObj && dataObj.str) {
                cpu.r[parseReg(a[0])] = dataObj.str.charCodeAt(getPointerAddr('z') % dataObj.str.length) || 0;
            }
            if (a.length > 1 && a[1].includes('+')) setPointerAddr('z', getPointerAddr('z') + 1);
            break;
        }
        case 'push': { writeRAM(cpu.sp, cpu.r[parseReg(a[0])]); cpu.sp = (cpu.sp - 1) & 0x08FF; break; }
        case 'pop': { cpu.sp = (cpu.sp + 1) & 0x08FF; cpu.r[parseReg(a[0])] = readRAM(cpu.sp); break; }
        case 'sec': cpu.sreg.C = 1; break;
        case 'clc': cpu.sreg.C = 0; break;
        case 'sez': cpu.sreg.Z = 1; break;
        case 'clz': cpu.sreg.Z = 0; break;
    }

    cpu.pc = nextPC;
    cpu.cycles++;

    onUpdateCallback();

    if (cpu.running && cpu.pc < cpu.program.length) {
        if (cpu.breakpoints.has(cpu.program[cpu.pc].lineNum)) {
            onHaltCallback();
            onUpdateCallback();
        }
    }
}
