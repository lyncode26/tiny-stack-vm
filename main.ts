// Tiny stack VM for make.fun's tiny-stack-vm-01 (ISA v1).
// Runs every instance under MAKEFUN_INPUT_DIR and writes each answer
// (stdout.bin + exit.txt) under MAKEFUN_OUTPUT_DIR.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Binary ops: opcode -> (a, b) => result. Divide-by-zero returns undefined,
// which the dispatch below turns into trap 4.
const BIN = {
  0x10: (a, b) => (a + b) | 0,
  0x11: (a, b) => (a - b) | 0,
  0x12: (a, b) => Math.imul(a, b),
  0x13: (a, b) => b ? Math.trunc(a / b) | 0 : undefined,
  0x14: (a, b) => b ? (a % b) | 0 : undefined,
  0x15: (a, b) => b ? Math.trunc((a >>> 0) / (b >>> 0)) | 0 : undefined,
  0x16: (a, b) => b ? ((a >>> 0) % (b >>> 0)) | 0 : undefined,
  0x18: (a, b) => a & b,
  0x19: (a, b) => a | b,
  0x1a: (a, b) => a ^ b,
  0x1c: (a, b) => a << (b & 31),
  0x1d: (a, b) => a >> (b & 31),
  0x1e: (a, b) => (a >>> (b & 31)) | 0,
  0x20: (a, b) => (a === b ? 1 : 0),
  0x21: (a, b) => (a < b ? 1 : 0),
  0x22: (a, b) => ((a >>> 0) < (b >>> 0) ? 1 : 0),
};

// Run one program. Returns [output bytes, exit code].
// Values are 32-bit two's-complement ints; results are forced back to int32
// with |0 so arithmetic wraps modulo 2^32. Traps throw their code.
function run(prog, input) {
  const st = [], cs = [], mem = new Int32Array(256), out = [];
  let pc = 0, steps = 0, ip = 0;
  const n = prog.length;
  const T = (c) => { throw c; };
  const u = (k) => { if (st.length < k) T(2); };
  const v = () => { if (st.length >= 256) T(3); };
  const off = () => (prog[pc + 1] | prog[pc + 2] << 8) << 16 >> 16;
  try {
    for (;;) {
      if (steps >= 1000000) T(10);
      if (pc < 0 || pc >= n) T(9);
      const op = prog[pc];
      const imm = op === 1 ? 1 : op === 2 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
      if (pc + 1 + imm > n) T(9);
      const next = pc + 1 + imm;
      steps++;
      const f = BIN[op];
      if (f) {
        u(2);
        const b = st.pop(), a = st.pop(), r = f(a, b);
        if (r === undefined) T(4);
        st.push(r);
        pc = next;
        continue;
      }
    switch (op) {
      case 0x00: return [out, 0]; // HALT
      case 0x01: v(); st.push((prog[pc + 1] << 24) >> 24); pc = next; break; // PUSH8
      case 0x02: v(); st.push(prog[pc + 1] | prog[pc + 2] << 8 | prog[pc + 3] << 16 | prog[pc + 4] << 24); pc = next; break; // PUSH32
      case 0x03: u(1); st.pop(); pc = next; break; // POP
      case 0x04: u(1); v(); st.push(st[st.length - 1]); pc = next; break; // DUP
      case 0x05: u(2); { const a = st.pop(); st.push(a, st.pop()); } pc = next; break; // SWAP
      case 0x06: u(2); v(); st.push(st[st.length - 2]); pc = next; break; // OVER
      case 0x07: u(3); st.push(st.splice(st.length - 3, 1)[0]); pc = next; break; // ROT
      case 0x17: u(1); st[st.length - 1] = -st[st.length - 1] | 0; pc = next; break; // NEG
      case 0x1b: u(1); st[st.length - 1] = ~st[st.length - 1]; pc = next; break; // NOT
      case 0x30: pc = next + off(); break; // JMP
      case 0x31: u(1); pc = st.pop() === 0 ? next + off() : next; break; // JZ
      case 0x32: u(1); pc = st.pop() !== 0 ? next + off() : next; break; // JNZ
      case 0x33: if (cs.length >= 64) T(7); cs.push(next); pc = prog[pc + 1] | prog[pc + 2] << 8; break; // CALL
      case 0x34: if (!cs.length) T(8); pc = cs.pop(); break; // RET
      case 0x40: u(1); { const a = st.pop(); if (a < 0 || a > 255) T(6); st.push(mem[a]); } pc = next; break; // LOAD
      case 0x41: u(2); { const a = st.pop(), w = st.pop(); if (a < 0 || a > 255) T(6); mem[a] = w; } pc = next; break; // STORE
      case 0x50: u(1); { const w = String(st.pop()); if (out.length + w.length > 65536) T(11); for (let i = 0; i < w.length; i++) out.push(w.charCodeAt(i)); } pc = next; break; // PRINT
      case 0x51: u(1); if (out.length + 1 > 65536) T(11); out.push(st.pop() & 255); pc = next; break; // PUTC
      case 0x52: v(); st.push(ip < input.length ? input[ip++] : -1); pc = next; break; // IN
      case 0x53: u(1); return [out, st.pop() & 255]; // EXIT
      default: T(5); // unknown opcode
    }
  }
  } catch (e) {
    if (typeof e === 'number') return [out, e];
    throw e;
  }
}

for (const id of readdirSync(I).sort()) {
  let out, exit;
  try {
    const prog = readFileSync(join(I, id, 'program.bin'));
    const input = readFileSync(join(I, id, 'input.bin'));
    [out, exit] = run(prog, input);
  } catch {
    out = [];
    exit = 0;
  }
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), Buffer.from(out));
  writeFileSync(join(O, id, 'exit.txt'), String(exit) + '\n');
}
