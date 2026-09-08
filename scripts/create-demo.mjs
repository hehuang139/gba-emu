/**
 * STAR ORBIT — an original, dependency-free Game Boy Advance homebrew.
 * Run: node scripts/create-demo.mjs
 * Generates ARMv4T machine code, a valid cartridge header and original graphics.
 * The bootstrap copies the program into IWRAM; mode 4 uses double buffering.
 * Source and game content: MIT (see public/demo/LICENSE.txt).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROM_BASE = 0x08000000, CODE_BASE = 0x03000000, CODE_OFFSET = 0x200;
const VARS = 0x02000000;
const C = { eq: 0, ne: 1, cs: 2, cc: 3, mi: 4, pl: 5, hi: 8, ls: 9, ge: 10, lt: 11, gt: 12, le: 13, al: 14 };
const I = value => ({ immediate: value >>> 0 });
const R = (register, shift = 0, type = 0) => ({ register, shift, type });
function immediate(value) {
  value >>>= 0;
  for (let rotate = 0; rotate < 16; rotate++) {
    const n = rotate * 2;
    const candidate = ((value << n) | (value >>> ((32 - n) & 31))) >>> 0;
    if (candidate <= 255) return (rotate << 8) | candidate;
  }
  throw new Error(`ARM immediate cannot encode 0x${value.toString(16)}`);
}
class ARM {
  constructor(base) { this.base = base; this.words = []; this.labels = new Map(); this.branches = []; this.literals = []; }
  emit(word, condition = 'al') { this.words.push(((word & 0x0fffffff) | (C[condition] << 28)) >>> 0); }
  label(name) { if (this.labels.has(name)) throw new Error(`Duplicate label ${name}`); this.labels.set(name, this.words.length * 4); }
  op(opcode, rd, rn, operand, condition = 'al', flags = false) {
    let encoded, isImmediate = 0;
    if ('immediate' in operand) { encoded = immediate(operand.immediate); isImmediate = 1; }
    else encoded = operand.register | (operand.shift << 7) | (operand.type << 5);
    this.emit((isImmediate << 25) | (opcode << 21) | (Number(flags) << 20) | (rn << 16) | (rd << 12) | encoded, condition);
  }
  mov(rd, value, condition = 'al') {
    try { this.op(13, rd, 0, I(value), condition); }
    catch { this.literals.push({ at: this.words.length, value: value >>> 0, condition, rd }); this.emit(0, condition); }
  }
  reg(rd, rm, shift = 0, type = 0, condition = 'al') { this.op(13, rd, 0, R(rm, shift, type), condition); }
  add(rd, rn, operand, condition = 'al') { this.op(4, rd, rn, operand, condition); }
  sub(rd, rn, operand, condition = 'al', flags = false) { this.op(2, rd, rn, operand, condition, flags); }
  cmp(rn, operand) { this.op(10, 0, rn, operand, 'al', true); }
  tst(rn, operand) { this.op(8, 0, rn, operand, 'al', true); }
  and(rd, rn, operand, condition = 'al') { this.op(0, rd, rn, operand, condition); }
  orr(rd, rn, operand, condition = 'al') { this.op(12, rd, rn, operand, condition); }
  bic(rd, rn, operand, condition = 'al') { this.op(14, rd, rn, operand, condition); }
  eor(rd, rn, operand) { this.op(1, rd, rn, operand); }
  ldr(rd, rn, offset = 0, byte = false) { this.emit(0x05900000 | (Number(byte) << 22) | (rn << 16) | (rd << 12) | offset); }
  str(rd, rn, offset = 0, post = false) { this.emit((post ? 0x04800000 : 0x05800000) | (rn << 16) | (rd << 12) | offset); }
  strb(rd, rn, offset = 0) { this.emit(0x05c00000 | (rn << 16) | (rd << 12) | offset); }
  ldrh(rd, rn, offset = 0) { this.emit(0x01d000b0 | (rn << 16) | (rd << 12) | ((offset & 0xf0) << 4) | (offset & 15)); }
  strh(rd, rn, offset = 0) { this.emit(0x01c000b0 | (rn << 16) | (rd << 12) | ((offset & 0xf0) << 4) | (offset & 15)); }
  ldrhReg(rd, rn, rm) { this.emit(0x019000b0 | (rn << 16) | (rd << 12) | rm); }
  strhReg(rd, rn, rm) { this.emit(0x018000b0 | (rn << 16) | (rd << 12) | rm); }
  mul(rd, rm, rs) { if (rd === rm) throw new Error('ARMv4 MUL destination must differ from first operand'); this.emit(0x00000090 | (rd << 16) | (rs << 8) | rm); }
  shiftRegister(rd, rm, rs, type) { this.emit(0x01a00010 | (rd << 12) | (rs << 8) | (type << 5) | rm); }
  push(registers) { this.emit(0x092d0000 | registers.reduce((n, r) => n | (1 << r), 0)); }
  pop(registers) { this.emit(0x08bd0000 | registers.reduce((n, r) => n | (1 << r), 0)); }
  bx(register = 14) { this.emit(0x012fff10 | register); }
  branch(label, condition = 'al', link = false) { this.branches.push({ at: this.words.length, label, condition, link }); this.emit(0); }
  call(label) { this.branch(label, 'al', true); }
  finish() {
    for (const b of this.branches) {
      if (!this.labels.has(b.label)) throw new Error(`Unknown label ${b.label}`);
      const offset = (this.labels.get(b.label) - (b.at * 4 + 8)) / 4;
      this.words[b.at] = ((C[b.condition] << 28) | (b.link ? 0x0b000000 : 0x0a000000) | (offset & 0xffffff)) >>> 0;
    }
    const unique = new Map();
    for (const l of this.literals) {
      if (!unique.has(l.value)) { unique.set(l.value, this.words.length * 4); this.words.push(l.value); }
      const offset = unique.get(l.value) - (l.at * 4 + 8);
      if (offset < 0 || offset > 4095) throw new Error(`Literal out of range (${offset})`);
      this.words[l.at] = ((C[l.condition] << 28) | 0x059f0000 | (l.rd << 12) | offset) >>> 0;
    }
    const result = Buffer.alloc(this.words.length * 4);
    this.words.forEach((word, index) => result.writeUInt32LE(word, index * 4));
    return result;
  }
}

const rom = Buffer.alloc(64 * 1024, 0xff);
let dataOffset = 0x8000;
function data(bytes) {
  const buffer = Buffer.from(bytes);
  const address = ROM_BASE + dataOffset;
  buffer.copy(rom, dataOffset); dataOffset = (dataOffset + buffer.length + 3) & ~3;
  return address;
}
const textData = Object.fromEntries(['STAR ORBIT', 'BEACONS', 'A BOOST', 'B PULSE', 'START RESET'].map(s => [s, data(Buffer.from(`${s}\0`))]));
// Standard save-type signature used by GBA emulators and flash cartridges.
data(Buffer.from('SRAM_V113\0'));
const FONT = {
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  A:['01110','10001','10001','11111','10001','10001','10001'], B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['01111','10000','10000','10000','10000','10000','01111'], D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'], F:['11111','10000','10000','11110','10000','10000','10000'],
  G:['01111','10000','10000','10111','10001','10001','01111'], H:['10001','10001','10001','11111','10001','10001','10001'],
  I:['11111','00100','00100','00100','00100','00100','11111'], J:['00111','00010','00010','00010','10010','10010','01100'],
  K:['10001','10010','10100','11000','10100','10010','10001'], L:['10000','10000','10000','10000','10000','10000','11111'],
  M:['10001','11011','10101','10101','10001','10001','10001'], N:['10001','11001','10101','10011','10001','10001','10001'],
  O:['01110','10001','10001','10001','10001','10001','01110'], P:['11110','10001','10001','11110','10000','10000','10000'],
  Q:['01110','10001','10001','10001','10101','10010','01101'], R:['11110','10001','10001','11110','10100','10010','10001'],
  S:['01111','10000','10000','01110','00001','00001','11110'], T:['11111','00100','00100','00100','00100','00100','00100'],
  U:['10001','10001','10001','10001','10001','10001','01110'], V:['10001','10001','10001','10001','10001','01010','00100'],
  W:['10001','10001','10001','10101','10101','11011','10001'], X:['10001','10001','01010','00100','01010','10001','10001'],
  Y:['10001','10001','01010','00100','00100','00100','00100'], Z:['11111','00001','00010','00100','01000','10000','11111'],
  0:['01110','10001','10011','10101','11001','10001','01110'], 1:['00100','01100','00100','00100','00100','00100','01110'],
  2:['01110','10001','00001','00010','00100','01000','11111'], 3:['11110','00001','00001','01110','00001','00001','11110'],
  4:['00010','00110','01010','10010','11111','00010','00010'], 5:['11111','10000','10000','11110','00001','00001','11110'],
  6:['01110','10000','10000','11110','10001','10001','01110'], 7:['11111','00001','00010','00100','01000','01000','01000'],
  8:['01110','10001','10001','01110','10001','10001','01110'], 9:['01110','10001','10001','01111','00001','00001','01110'],
};
const fontBytes = Buffer.alloc(128 * 7);
for (const [char, rows] of Object.entries(FONT)) rows.forEach((bits, row) => { fontBytes[char.charCodeAt(0) * 7 + row] = parseInt(bits, 2); });
const fontAddress = data(fontBytes);
let seed = 0x534f5242;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
const stars = Array.from({ length: 66 }, (_, i) => [6 + random() % 228, random() % 160, i % 5 === 0 ? 3 : i % 3 === 0 ? 2 : 1, i % 5 === 0 ? 1 : 2]).flat();
const starsAddress = data(stars);
const orbit = [];
for (let i = 0; i < 100; i++) { const angle = i * Math.PI * 2 / 100; orbit.push(Math.round(189 + Math.cos(angle) * 29), Math.round(65 + Math.sin(angle) * 29), 1, 0); }
for (let i = 0; i < 70; i++) { const angle = i * Math.PI * 2 / 70; orbit.push(Math.round(189 + Math.cos(angle) * 38), Math.round(65 + Math.sin(angle) * 10 + Math.cos(angle) * 10), 2, 0); }
const orbitAddress = data(orbit);
const ship = [
  '.......3.......', '......343......', '......343......', '.....33433.....',
  '.....34443.....', '....3344433....', '....3443443....', '...334434433...',
  '...344434443...', '..33444344433..', '.3334443444333.', '333544444445333',
  '335544444445533', '355553333355553', '33...55.55...33',
];
if (ship.some(row => row.length !== 15)) throw new Error('Ship must be 15 pixels wide');
const shipAddress = data(ship.join('').split('').map(char => char === '.' ? 0 : Number(char)));
const pulsePoints = Buffer.alloc(24 * 8);
for (let i = 0; i < 24; i++) { pulsePoints.writeInt32LE(Math.round(Math.cos(i * Math.PI / 12) * 16), i * 8); pulsePoints.writeInt32LE(Math.round(Math.sin(i * Math.PI / 12) * 16), i * 8 + 4); }
const pulseAddress = data(pulsePoints);
const rgb = (r, g, b) => ((r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10));
const colors = [[8,12,30],[32,42,70],[56,93,117],[221,250,247],[91,232,197],[30,127,138],[255,182,83],[177,137,233],[18,28,48],[120,153,171],[255,235,185],[137,241,153],[22,59,88],[102,143,243]];
const palette = Buffer.alloc(512);
colors.forEach((color, i) => palette.writeUInt16LE(rgb(...color), i * 2));
const paletteAddress = data(palette);

const a = new ARM(CODE_BASE);
a.label('entry');
a.mov(13, 0x03007f00); a.mov(10, VARS); a.mov(11, 0x0600a000);
a.mov(0, paletteAddress); a.mov(1, 0x05000000); a.mov(2, 128);
a.label('palette_loop'); a.ldr(3, 0); a.add(0, 0, I(4)); a.str(3, 1, 4, true); a.sub(2, 2, I(1), 'al', true); a.branch('palette_loop', 'ne');
a.mov(0, 0x04000000); a.mov(1, 0x0404); a.strh(1, 0);
a.mov(0, 0x04000084); a.mov(1, 0x80); a.strh(1, 0);
a.mov(0, 0x04000080); a.mov(1, 0x1177); a.strh(1, 0); a.mov(1, 2); a.strh(1, 0, 2);
a.call('reset'); a.call('battery_load');
a.label('frame'); a.call('update'); a.call('render');
// One flip per VBlank. This also makes state save/restore deterministic.
a.mov(0, 0x04000006);
a.label('wait_visible'); a.ldrh(1, 0); a.cmp(1, I(160)); a.branch('wait_visible', 'ge');
a.label('wait_vblank'); a.ldrh(1, 0); a.cmp(1, I(160)); a.branch('wait_vblank', 'lt');
a.mov(0, 0x04000000); a.ldrh(1, 0); a.eor(1, 1, I(16)); a.strh(1, 0); a.eor(11, 11, I(0xa000)); a.branch('frame');

// State: x, y, score, tick, pulse, previous keys, beacon x/y, reserved, boost.
a.label('reset'); a.mov(0, 94); a.str(0, 10); a.mov(0, 104); a.str(0, 10, 4); a.mov(0, 0);
for (const offset of [8, 12, 16, 20, 32, 36]) a.str(0, 10, offset);
a.mov(0, 172); a.str(0, 10, 24); a.mov(0, 69); a.str(0, 10, 28); a.bx();

a.label('update'); a.push([4,5,6,7,8,14]);
a.mov(0, 0x04000130); a.ldrh(1, 0); a.op(15, 1, 0, R(1)); a.mov(2, 0x3ff); a.and(1, 1, R(2));
a.ldr(2, 10, 20); a.str(1, 10, 20); a.bic(3, 1, R(2)); a.tst(3, I(8)); a.branch('not_reset', 'eq'); a.call('reset'); a.call('battery_save'); a.branch('update_end');
a.label('not_reset'); a.mov(6, 1); a.tst(1, I(1)); a.mov(6, 3, 'ne'); a.and(0, 1, I(1)); a.str(0, 10, 36);
a.ldr(4, 10); a.ldr(5, 10, 4);
a.tst(1, I(16)); a.add(4, 4, R(6), 'ne'); a.tst(1, I(32)); a.sub(4, 4, R(6), 'ne');
a.tst(1, I(64)); a.sub(5, 5, R(6), 'ne'); a.tst(1, I(128)); a.add(5, 5, R(6), 'ne');
a.cmp(4, I(10)); a.mov(4, 10, 'lt'); a.cmp(4, I(229)); a.mov(4, 229, 'gt');
a.cmp(5, I(34)); a.mov(5, 34, 'lt'); a.cmp(5, I(131)); a.mov(5, 131, 'gt'); a.str(4, 10); a.str(5, 10, 4);
a.ldr(7, 10, 12); a.add(7, 7, R(6)); a.cmp(7, I(640)); a.sub(7, 7, I(640), 'ge'); a.str(7, 10, 12);
a.ldr(8, 10, 16); a.cmp(8, I(0)); a.sub(8, 8, I(1), 'gt'); a.tst(3, I(2)); a.branch('pulse_ready', 'eq');
a.mov(8, 24); a.mov(0, 1150); a.call('tone');
a.label('pulse_ready'); a.str(8, 10, 16);
a.ldr(0, 10, 24); a.sub(0, 4, R(0), 'al', true); a.op(3, 0, 0, I(0), 'mi');
a.ldr(1, 10, 28); a.sub(1, 5, R(1), 'al', true); a.op(3, 1, 1, I(0), 'mi'); a.add(0, 0, R(1));
a.mov(2, 12); a.cmp(8, I(0)); a.mov(2, 42, 'gt'); a.cmp(0, R(2)); a.branch('update_end', 'gt');
a.ldr(0, 10, 8); a.add(0, 0, I(1)); a.cmp(0, I(100)); a.mov(0, 0, 'ge'); a.str(0, 10, 8); a.call('battery_save');
// Deterministic xorshift PRNG, seeded from the current frame on first capture.
a.ldr(0, 10, 32); a.cmp(0, I(0)); a.mov(0, 0x534f5242, 'eq'); a.eor(0, 0, R(0,13)); a.eor(0, 0, R(0,17,1)); a.eor(0, 0, R(0,5)); a.str(0, 10, 32);
a.and(1, 0, I(127)); a.add(1, 1, I(54)); a.str(1, 10, 24); a.reg(1, 0, 9, 1); a.and(1, 1, I(63)); a.add(1, 1, I(48)); a.str(1, 10, 28);
a.mov(0, 1850); a.call('tone');
a.label('update_end'); a.pop([4,5,6,7,8,14]); a.bx();
a.label('tone'); a.mov(1, 0x04000060); a.mov(2, 0); a.strh(2, 1); a.mov(2, 0xf1a0); a.strh(2, 1, 2); a.orr(0, 0, I(0xc000)); a.strh(0, 1, 4); a.bx();

// Battery SRAM uses byte accesses. A magic, version and complemented score
// reject erased, incompatible or partially written saves without affecting play.
a.label('battery_load'); a.push([14]); a.mov(0,0x0e000000);
for (const [offset,value] of [[0,0x53],[1,0x4f],[2,1]]) { a.ldr(1,0,offset,true); a.cmp(1,I(value)); a.branch('battery_empty','ne'); }
a.ldr(1,0,3,true); a.cmp(1,I(100)); a.branch('battery_empty','ge'); a.ldr(2,0,4,true); a.eor(2,2,R(1)); a.cmp(2,I(255)); a.branch('battery_empty','ne'); a.str(1,10,8); a.branch('battery_loaded');
a.label('battery_empty'); a.call('battery_save');
a.label('battery_loaded'); a.pop([14]); a.bx();
a.label('battery_save'); a.mov(0,0x0e000000); a.ldr(1,10,8); a.strb(1,0,3); a.eor(1,1,I(255)); a.strb(1,0,4);
for (const [offset,value] of [[0,0x53],[1,0x4f],[2,1]]) { a.mov(1,value); a.strb(1,0,offset); }
a.bx();

// Pixel: x=r0, y=r1, palette index=r2. Only r3/r12 are clobbered.
a.label('pixel'); a.reg(3, 1, 8); a.sub(3, 3, R(1,4)); a.add(3, 3, R(0)); a.bic(3, 3, I(1)); a.ldrhReg(12, 11, 3);
a.tst(0, I(1)); a.and(12, 12, I(0xff00), 'eq'); a.orr(12, 12, R(2), 'eq'); a.and(12, 12, I(0xff), 'ne'); a.orr(12, 12, R(2,8), 'ne'); a.strhReg(12, 11, 3); a.bx();
// Rectangle: x, y, width, height, color in r0..r4.
a.label('rect'); a.push([4,5,6,7,8,14]); a.reg(5,0); a.add(6,0,R(2)); a.add(7,1,R(3)); a.reg(2,4);
a.label('rect_row'); a.reg(0,5);
a.label('rect_pixel'); a.call('pixel'); a.add(0,0,I(1)); a.cmp(0,R(6)); a.branch('rect_pixel','lt'); a.add(1,1,I(1)); a.cmp(1,R(7)); a.branch('rect_row','lt'); a.pop([4,5,6,7,8,14]); a.bx();
// Character: ASCII, x, y, color in r0..r3; original 5 x 7 bitmap font.
a.label('char'); a.push([4,5,6,7,8,9,14]); a.mov(4,fontAddress); a.reg(5,0,3); a.sub(5,5,R(0)); a.add(4,4,R(5)); a.reg(5,1); a.reg(6,2); a.reg(7,3); a.mov(8,0);
a.label('char_row'); a.ldr(9,4,0,true); a.add(4,4,I(1)); a.mov(12,16); a.mov(0,0);
// r12 is pixel scratch, so use r3 as column and save row bits in r9.
a.mov(3,0);
a.label('char_column'); a.tst(9,I(16)); a.branch('char_blank','eq'); a.push([3]); a.add(0,5,R(3)); a.add(1,6,R(8)); a.reg(2,7); a.call('pixel'); a.pop([3]);
a.label('char_blank'); a.reg(9,9,1); a.add(3,3,I(1)); a.cmp(3,I(5)); a.branch('char_column','lt'); a.add(8,8,I(1)); a.cmp(8,I(7)); a.branch('char_row','lt'); a.pop([4,5,6,7,8,9,14]); a.bx();
a.label('text'); a.push([4,5,6,7,14]); a.reg(4,0); a.reg(5,1); a.reg(6,2); a.reg(7,3);
a.label('text_next'); a.ldr(0,4,0,true); a.add(4,4,I(1)); a.cmp(0,I(0)); a.branch('text_end','eq'); a.reg(1,5); a.reg(2,6); a.reg(3,7); a.call('char'); a.add(5,5,I(6)); a.branch('text_next');
a.label('text_end'); a.pop([4,5,6,7,14]); a.bx();
a.label('number'); a.push([4,5,14]); a.ldr(4,10,8); a.mov(5,0);
a.label('number_tens'); a.cmp(4,I(10)); a.branch('number_draw','lt'); a.sub(4,4,I(10)); a.add(5,5,I(1)); a.branch('number_tens');
a.label('number_draw'); a.add(0,5,I(48)); a.mov(1,205); a.mov(2,10); a.mov(3,4); a.call('char'); a.add(0,4,I(48)); a.mov(1,211); a.mov(2,10); a.mov(3,4); a.call('char'); a.pop([4,5,14]); a.bx();

a.label('render'); a.push([4,5,6,7,8,9,14]);
a.reg(0,11); a.mov(1,0); a.mov(2,9600);
a.label('clear'); a.str(1,0,4,true); a.sub(2,2,I(1),'al',true); a.branch('clear','ne');
a.mov(4,orbitAddress); a.mov(5,170);
a.label('orbit'); a.ldr(0,4,0,true); a.ldr(1,4,1,true); a.ldr(2,4,2,true); a.call('pixel'); a.add(4,4,I(4)); a.sub(5,5,I(1),'al',true); a.branch('orbit','ne');
a.mov(4,starsAddress); a.mov(5,66); a.ldr(7,10,12);
a.label('stars'); a.ldr(0,4,0,true); a.ldr(1,4,1,true); a.ldr(2,4,2,true); a.ldr(6,4,3,true); a.shiftRegister(3,7,6,1); a.add(1,1,R(3));
a.cmp(1,I(160)); a.sub(1,1,I(160),'ge'); a.cmp(1,I(160)); a.sub(1,1,I(160),'ge'); a.cmp(1,I(26)); a.branch('star_next','lt'); a.cmp(1,I(139)); a.branch('star_next','gt'); a.call('pixel');
a.ldr(3,10,36); a.cmp(3,I(0)); a.branch('star_next','eq'); a.cmp(2,I(3)); a.branch('star_next','ne'); a.add(1,1,I(1)); a.call('pixel'); a.add(1,1,I(1)); a.call('pixel');
a.label('star_next'); a.add(4,4,I(4)); a.sub(5,5,I(1),'al',true); a.branch('stars','ne');
// Beacon, with a pale center and a warm four-point glow.
a.ldr(0,10,24); a.sub(0,0,I(1)); a.ldr(1,10,28); a.sub(1,1,I(6)); a.mov(2,2); a.mov(3,12); a.mov(4,6); a.call('rect');
a.ldr(0,10,24); a.sub(0,0,I(6)); a.ldr(1,10,28); a.sub(1,1,I(1)); a.mov(2,12); a.mov(3,2); a.mov(4,6); a.call('rect');
a.ldr(0,10,24); a.sub(0,0,I(2)); a.ldr(1,10,28); a.sub(1,1,I(2)); a.mov(2,4); a.mov(3,4); a.mov(4,10); a.call('rect');
// Expanding 24-point pulse, clipped before touching VRAM.
a.ldr(7,10,16); a.cmp(7,I(0)); a.branch('pulse_done','eq'); a.op(3,7,7,I(26)); a.reg(7,7,1); a.mov(4,pulseAddress); a.mov(5,24);
a.label('pulse_point'); a.ldr(6,4); a.mul(0,6,7); a.reg(0,0,4,2); a.ldr(6,10); a.add(0,0,R(6)); a.ldr(6,4,4); a.mul(1,6,7); a.reg(1,1,4,2); a.ldr(6,10,4); a.add(1,1,R(6));
a.cmp(0,I(0)); a.branch('pulse_skip','lt'); a.cmp(0,I(240)); a.branch('pulse_skip','ge'); a.cmp(1,I(26)); a.branch('pulse_skip','lt'); a.cmp(1,I(140)); a.branch('pulse_skip','ge'); a.mov(2,4); a.call('pixel');
a.label('pulse_skip'); a.add(4,4,I(8)); a.sub(5,5,I(1),'al',true); a.branch('pulse_point','ne');
a.label('pulse_done');
// Thruster, then the transparent sprite.
a.ldr(0,10); a.sub(0,0,I(2)); a.ldr(1,10,4); a.add(1,1,I(6)); a.mov(2,4); a.mov(3,4); a.mov(4,6); a.ldr(5,10,36); a.cmp(5,I(0)); a.mov(3,9,'ne'); a.mov(4,10,'ne'); a.call('rect');
a.mov(4,shipAddress); a.ldr(5,10); a.sub(5,5,I(7)); a.ldr(6,10,4); a.sub(6,6,I(8)); a.mov(7,0);
a.label('ship_row'); a.mov(8,0);
a.label('ship_pixel'); a.ldr(2,4,0,true); a.add(4,4,I(1)); a.cmp(2,I(0)); a.branch('ship_skip','eq'); a.add(0,5,R(8)); a.add(1,6,R(7)); a.call('pixel');
a.label('ship_skip'); a.add(8,8,I(1)); a.cmp(8,I(15)); a.branch('ship_pixel','lt'); a.add(7,7,I(1)); a.cmp(7,I(15)); a.branch('ship_row','lt');
for (const y of [23,144]) { a.mov(0,12); a.mov(1,y); a.mov(2,216); a.mov(3,1); a.mov(4,1); a.call('rect'); }
for (const [label,x,y,color] of [['STAR ORBIT',12,10,3],['BEACONS',153,10,9],['A BOOST',12,150,9],['B PULSE',80,150,9],['START RESET',162,150,9]]) {
  a.mov(0,textData[label]); a.mov(1,x); a.mov(2,y); a.mov(3,color); a.call('text');
}
a.call('number'); a.pop([4,5,6,7,8,9,14]); a.bx();
const program = a.finish();
if (program.length > 0x7000) throw new Error('Program exceeds IWRAM budget');
program.copy(rom,CODE_OFFSET);

const boot = new ARM(ROM_BASE + 0xc0);
boot.mov(0, ROM_BASE + CODE_OFFSET); boot.mov(1,CODE_BASE); boot.mov(2,program.length);
boot.label('copy'); boot.ldr(3,0); boot.add(0,0,I(4)); boot.str(3,1,4,true); boot.sub(2,2,I(4),'al',true); boot.branch('copy','ne'); boot.mov(0,CODE_BASE); boot.bx(0);
const bootstrap = boot.finish();
if (bootstrap.length > CODE_OFFSET - 0xc0) throw new Error('Bootstrap overflow');
bootstrap.copy(rom,0xc0);
rom.writeUInt32LE(0xea00002e,0); // B 0x080000c0
// Standard cartridge recognition bytes required by original GBA boot ROMs.
Buffer.from('24ffae51699aa2213d84820a84e409ad11248b98c0817f21a352be199309ce2010464a4af82731ec58c7e83382e3cebf85f4df94ce4b09c194568ac01372a7fc9f844d73a3ca9a615897a327fc039876231dc7610304ae56bf38840040a70efdff52fe036f9530f197fbc08560d68025a963be03014e38e2f9a234ffbb3e0344780090cb88113a9465c07c6387f03cafd625e48b380aac7221d4f807','hex').copy(rom,4);
rom.fill(0,0xa0,0xc0); rom.write('STAR ORBIT',0xa0,'ascii'); rom.write('ASTE',0xac,'ascii'); rom.write('00',0xb0,'ascii'); rom[0xb2] = 0x96;
let checksum = 0x19;
for (let i = 0xa0; i <= 0xbc; i++) checksum += rom[i];
rom[0xbd] = (-checksum) & 255;
let verify = 0x19;
for (let i = 0xa0; i <= 0xbd; i++) verify += rom[i];
if ((verify & 255) !== 0) throw new Error('Invalid GBA header checksum');
mkdirSync(resolve(ROOT,'public/demo'),{ recursive:true });
const output = resolve(ROOT,'public/demo/star-orbit.gba');
writeFileSync(output,rom);
writeFileSync(resolve(ROOT,'public/demo/star-orbit.symbols.json'),JSON.stringify({ romBytes:rom.length, codeBytes:program.length, codeBase:CODE_BASE, variables:VARS, labels:Object.fromEntries([...a.labels].map(([key,value])=>[key,`0x${(CODE_BASE+value).toString(16)}`])) },null,2)+'\n');
console.log(`Created ${output}: ${rom.length} bytes; ${program.length} bytes of ARM code; header checksum 0x${rom[0xbd].toString(16)}.`);
