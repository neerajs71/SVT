/**
 * Representation Code Reader - Port of Python RCReader.py
 * Handles all 27 representation codes for converting binary data to human-readable format
 */

import type { BinaryReader, JsonAble } from '../common/types';
import { TZ } from '../common/types';

/**
 * Read bytes from stream and validate length
 */
function readBytes(stream: BinaryReader, length: number): Uint8Array {
  const bytes = stream.read(length);
  if (bytes.length !== length) {
    throw new Error(`Cannot read ${length} bytes, only ${bytes.length} available`);
  }
  return bytes;
}

/**
 * Create DataView from bytes for multi-byte reads
 */
function createDataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// ==================== INTEGER TYPES ====================

/**
 * Read FSHORT - 2-byte signed integer
 */
export function readFSHORT(stream: BinaryReader): number {
  const bytes = readBytes(stream, 2);
  const view = createDataView(bytes);
  return view.getInt16(0, false); // big-endian
}

/**
 * Read SSHORT - 1-byte signed integer
 */
export function readSSHORT(stream: BinaryReader): number {
  const bytes = readBytes(stream, 1);
  const view = createDataView(bytes);
  return view.getInt8(0);
}

/**
 * Read SNORM - 2-byte signed integer
 */
export function readSNORM(stream: BinaryReader): number {
  const bytes = readBytes(stream, 2);
  const view = createDataView(bytes);
  return view.getInt16(0, false); // big-endian
}

/**
 * Read SLONG - 4-byte signed integer
 */
export function readSLONG(stream: BinaryReader): number {
  const bytes = readBytes(stream, 4);
  const view = createDataView(bytes);
  return view.getInt32(0, false); // big-endian
}

/**
 * Read USHORT - 1-byte unsigned integer
 */
export function readUSHORT(stream: BinaryReader): number {
  const bytes = readBytes(stream, 1);
  return bytes[0]!;
}

/**
 * Read UNORM - 2-byte unsigned integer
 */
export function readUNORM(stream: BinaryReader): number {
  const bytes = readBytes(stream, 2);
  const view = createDataView(bytes);
  return view.getUint16(0, false); // big-endian
}

/**
 * Read ULONG - 4-byte unsigned integer
 */
export function readULONG(stream: BinaryReader): number {
  const bytes = readBytes(stream, 4);
  const view = createDataView(bytes);
  return view.getUint32(0, false); // big-endian
}

/**
 * Read UVARI - Variable-length unsigned integer
 */
export function readUVARI(stream: BinaryReader): number {
  const firstByte = readBytes(stream, 1)[0]!;
  
  if (firstByte & 0x80) {
    if (firstByte & 0x40) {
      // 4-byte value
      let value = firstByte & 0x3F;
      for (let i = 0; i < 3; i++) {
        value <<= 8;
        value |= readBytes(stream, 1)[0]!;
      }
      return value;
    } else {
      // 2-byte value
      let value = firstByte & 0x7F;
      value <<= 8;
      value |= readBytes(stream, 1)[0]!;
      return value;
    }
  }
  return firstByte;
}

// ==================== FLOATING POINT TYPES ====================

/**
 * Read FSINGL - Single precision floating point
 */
export function readFSINGL(stream: BinaryReader): number {
  const bytes = readBytes(stream, 4);
  const view = createDataView(bytes);
  return view.getFloat32(0, false); // big-endian
}

/**
 * Read FDOUBL - Double precision floating point
 */
export function readFDOUBL(stream: BinaryReader): number {
  const bytes = readBytes(stream, 8);
  const view = createDataView(bytes);
  return view.getFloat64(0, false); // big-endian
}

/**
 * FSING1 - Validated Single Precision Floating Point
 */
export class FSING1 implements JsonAble {
  constructor(public value: number, public bound: number) {}

  static read(stream: BinaryReader): FSING1 {
    const value = readFSINGL(stream);
    const bound = readFSINGL(stream);
    return new FSING1(value, bound);
  }

  toJSON(): any {
    return { value: this.value, bound: this.bound };
  }

  equals(other: FSING1): boolean {
    return this.value === other.value && this.bound === other.bound;
  }
}

/**
 * Read FSING1
 */
export function readFSING1(stream: BinaryReader): FSING1 {
  return FSING1.read(stream);
}

/**
 * FSING2 - Two-Way Validated Single Precision Floating Point
 */
export class FSING2 implements JsonAble {
  constructor(public V: number, public A: number, public B: number) {}

  static read(stream: BinaryReader): FSING2 {
    const V = readFSINGL(stream);
    const A = readFSINGL(stream);
    const B = readFSINGL(stream);
    return new FSING2(V, A, B);
  }

  toJSON(): any {
    return { V: this.V, A: this.A, B: this.B };
  }

  equals(other: FSING2): boolean {
    return this.V === other.V && this.A === other.A && this.B === other.B;
  }
}

/**
 * Read FSING2
 */
export function readFSING2(stream: BinaryReader): FSING2 {
  return FSING2.read(stream);
}

/**
 * FDOUB1 - Validated Double Precision Floating Point
 */
export class FDOUB1 implements JsonAble {
  constructor(public V: number, public A: number) {}

  static read(stream: BinaryReader): FDOUB1 {
    const V = readFDOUBL(stream);
    const A = readFDOUBL(stream);
    return new FDOUB1(V, A);
  }

  toJSON(): any {
    return { V: this.V, A: this.A };
  }

  equals(other: FDOUB1): boolean {
    return this.V === other.V && this.A === other.A;
  }
}

/**
 * Read FDOUB1
 */
export function readFDOUB1(stream: BinaryReader): FDOUB1 {
  return FDOUB1.read(stream);
}

/**
 * FDOUB2 - Two-Way Validated Double Precision Floating Point
 */
export class FDOUB2 implements JsonAble {
  constructor(public V: number, public A: number, public B: number) {}

  static read(stream: BinaryReader): FDOUB2 {
    const V = readFDOUBL(stream);
    const A = readFDOUBL(stream);
    const B = readFDOUBL(stream);
    return new FDOUB2(V, A, B);
  }

  toJSON(): any {
    return { V: this.V, A: this.A, B: this.B };
  }

  equals(other: FDOUB2): boolean {
    return this.V === other.V && this.A === other.A && this.B === other.B;
  }
}

/**
 * Read FDOUB2
 */
export function readFDOUB2(stream: BinaryReader): FDOUB2 {
  return FDOUB2.read(stream);
}

/**
 * Read ISINGL - IBM Single precision floating point (approximation)
 */
export function readISINGL(stream: BinaryReader): number {
  const bytes = readBytes(stream, 4);
  const view = createDataView(bytes);
  return view.getInt32(0, false); // Simplified - IBM format needs special handling
}

/**
 * Read VSINGL - VAX Single precision floating point (F_floating format)
 * 
 * Based on USGS libvaxdata: VAX Data Format Conversion Routines
 * Reference: https://pubs.usgs.gov/of/2005/1424/of2005-1424_v1.2.pdf
 * 
 * VAX F_floating format (32-bit):
 * - Sign bit: bit 15 (not bit 31 like IEEE)
 * - Exponent: bits 14-7 (8 bits, biased by 128)
 * - Mantissa: bits 6-0 (low 7 bits) and bits 31-16 (high 16 bits) = 23 bits total
 * 
 * DLIS files are big-endian, so we need to:
 * 1. Read 4 bytes as big-endian from DLIS file
 * 2. Convert to VAX format (which is little-endian internally)
 * 3. Extract sign, exponent, and mantissa according to VAX format
 * 4. Convert to IEEE 754 single precision
 */
export function readVSINGL(stream: BinaryReader): number {
  const bytes = readBytes(stream, 4);
  
  // Based on dlisio's exact implementation (equinor/dlisio lib/src/dlis/types.cpp)
  // Byte reordering: [A,B,C,D] -> combine as: B<<24 | A<<16 | D<<8 | C<<0
  const x = bytes;
  const v = (x[1]! << 24) | (x[0]! << 16) | (x[3]! << 8) | (x[2]! << 0);
  
  // After reordering, extract components using IEEE-like bit positions
  const signBit = v & 0x80000000;
  const fracBits = v & 0x007FFFFF;  // 23 bits for mantissa (bits 0-22)
  const expBits = (v & 0x7F800000) >> 23;  // 8 bits for exponent (bits 23-30)
  
  const sign = signBit ? -1.0 : 1.0;
  const exponent = expBits - 128.0;  // VAX bias is 128
  
  // VAX floats have a 24-bit normalized mantissa where the MSB is hidden
  // The normalized mantissa takes the form 0.1m where m is the 23 bits on disk
  // We need to add the hidden bit (0x00800000) and normalize by 2^24
  const significand = (fracBits | 0x00800000) / Math.pow(2.0, 24);
  
  if (expBits !== 0) {
    // Normal number
    return sign * significand * Math.pow(2.0, exponent);
  } else if (!signBit) {
    // Zero (e=0, s=0) - Unlike IEEE 754, VAX has no denormalized form
    return 0.0;
  } else {
    // Undefined (e=0, s=1) - return NaN
    return Number.NaN;
  }
}

// ==================== COMPLEX TYPES ====================

/**
 * Read CSINGL - Single precision complex
 */
export function readCSINGL(stream: BinaryReader): { real: number; imag: number } {
  const real = readFSINGL(stream);
  const imag = readFSINGL(stream);
  return { real, imag };
}

/**
 * Read CDOUBL - Double precision complex
 */
export function readCDOUBL(stream: BinaryReader): { real: number; imag: number } {
  const real = readFDOUBL(stream);
  const imag = readFDOUBL(stream);
  return { real, imag };
}

// ==================== STRING TYPES ====================

/**
 * Read IDENT - Variable-length identifier
 */
export function readIDENT(stream: BinaryReader): string {
  const length = readBytes(stream, 1)[0]!;
  const payload = readBytes(stream, length);
  
  try {
    return new TextDecoder('ascii').decode(payload);
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(payload);
    } catch {
      return new TextDecoder('iso-8859-1').decode(payload);
    }
  }
}

/**
 * Read ASCII - Variable-length ASCII string
 */
export function readASCII(stream: BinaryReader): string {
  const length = readUVARI(stream);
  const payload = readBytes(stream, length);
  
  try {
    return new TextDecoder('ascii').decode(payload);
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(payload);
    } catch {
      return new TextDecoder('iso-8859-1').decode(payload);
    }
  }
}

// ==================== DATE/TIME TYPES ====================

/**
 * DTime - Date/Time with timezone
 */
export class DTime implements JsonAble {
  constructor(public time: Date, public tzone: TZ) {}

  static read(stream: BinaryReader): DTime {
    const bytes = readBytes(stream, 8);
    const y = bytes[0]!;
    const tzM = bytes[1]!;
    const d = bytes[2]!;
    const h = bytes[3]!;
    const min = bytes[4]!;
    const s = bytes[5]!;
    const ms = (bytes[6]! << 8) | bytes[7]!;

    // Fix fields
    const year = y + 1900;
    const month = tzM & 0x0F;
    const tzone = (tzM >> 4) as TZ;

    const time = new Date(year, month - 1, d, h, min, s, ms);
    return new DTime(time, tzone);
  }

  toString(): string {
    return `DTime[time:${this.time.toISOString()} timeZone:${TZ[this.tzone]}]`;
  }

  toJSON(): any {
    return {
      time: this.time.toISOString(),
      tzone: { timezone: TZ[this.tzone] }
    };
  }
}

/**
 * Read DTIME
 */
export function readDTIME(stream: BinaryReader): DTime {
  return DTime.read(stream);
}

// ==================== OBJECT TYPES ====================

/**
 * Read ORIGIN
 */
export function readORIGIN(stream: BinaryReader): number {
  return readUVARI(stream);
}

/**
 * ObName - Object Name
 */
export class ObName implements JsonAble {
  constructor(
    public origin: number,
    public copy: number,
    public identifier: string
  ) {}

  static read(stream: BinaryReader): ObName {
    const origin = readORIGIN(stream);
    const copy = readUSHORT(stream);
    const identifier = readIDENT(stream);
    return new ObName(origin, copy, identifier);
  }

  static instance(origin: number, copy: number, identifier: string): ObName {
    return new ObName(origin, copy, identifier);
  }

  equals(other: ObName): boolean {
    return this.origin === other.origin && 
           this.copy === other.copy && 
           this.identifier === other.identifier;
  }

  toString(): string {
    return `OBNAME[origin:${this.origin} copy:${this.copy} identifier:${this.identifier}]`;
  }

  toJSON(): any {
    return {
      origin: this.origin,
      copy: this.copy,
      identifier: this.identifier
    };
  }
}

/**
 * Read OBNAME
 */
export function readOBNAME(stream: BinaryReader): ObName {
  return ObName.read(stream);
}

/**
 * ObjRef - Object Reference
 */
export class ObjRef implements JsonAble {
  constructor(
    public type: string,
    public origin: number,
    public copy: number,
    public identifier: string
  ) {}

  static read(stream: BinaryReader): ObjRef {
    const type = readIDENT(stream);
    const origin = readORIGIN(stream);
    const copy = readUVARI(stream);
    const identifier = readIDENT(stream);
    return new ObjRef(type, origin, copy, identifier);
  }

  toJSON(): any {
    return {
      type: this.type,
      origin: this.origin,
      copy: this.copy,
      identifier: this.identifier
    };
  }
}

/**
 * Read OBJREF
 */
export function readOBJREF(stream: BinaryReader): ObjRef {
  return ObjRef.read(stream);
}

/**
 * ATTREF - Attribute Reference
 */
export class ATTREF implements JsonAble {
  constructor(
    public type: string,
    public origin: number,
    public copy: number,
    public identifier: string,
    public label: string
  ) {}

  static read(stream: BinaryReader): ATTREF {
    const type = readIDENT(stream);
    const origin = readORIGIN(stream);
    const copy = readUVARI(stream);
    const identifier = readIDENT(stream);
    const label = readIDENT(stream);
    return new ATTREF(type, origin, copy, identifier, label);
  }

  toJSON(): any {
    return {
      type: this.type,
      origin: this.origin,
      copy: this.copy,
      identifier: this.identifier,
      label: this.label
    };
  }
}

/**
 * Read ATTREF
 */
export function readATTREF(stream: BinaryReader): ATTREF {
  return ATTREF.read(stream);
}

// ==================== OTHER TYPES ====================

/**
 * Read STATUS - Boolean status value
 */
export function readSTATUS(stream: BinaryReader): number {
  return readUSHORT(stream);
}

/**
 * Read UNITS
 */
export function readUNITS(stream: BinaryReader): string {
  return readASCII(stream);
}

// ==================== REPRESENTATION CODE MAPPING ====================

export const CODE_TO_RC: { [key: number]: string } = {
  1: 'FSHORT',
  2: 'FSINGL',
  3: 'FSING1',
  4: 'FSING2',
  5: 'ISINGL',
  6: 'VSINGL',
  7: 'FDOUBL',
  8: 'FDOUB1',
  9: 'FDOUB2',
  10: 'CSINGL',
  11: 'CDOUBL',
  12: 'SSHORT',
  13: 'SNORM',
  14: 'SLONG',
  15: 'USHORT',
  16: 'UNORM',
  17: 'ULONG',
  18: 'UVARI',
  19: 'IDENT',
  20: 'ASCII',
  21: 'DTIME',
  22: 'ORIGIN',
  23: 'OBNAME',
  24: 'OBJREF',
  25: 'ATTREF',
  26: 'STATUS',
  27: 'UNITS'
};

export const RC_TO_CODE: { [key: string]: number } = Object.fromEntries(
  Object.entries(CODE_TO_RC).map(([k, v]) => [v, parseInt(k)])
);

// Reader function mapping
const READ_RC_METHODS: { [key: string]: (stream: BinaryReader) => any } = {
  'FSHORT': readFSHORT,
  'FSINGL': readFSINGL,
  'FSING1': readFSING1,
  'FSING2': readFSING2,
  'ISINGL': readISINGL,
  'VSINGL': readVSINGL,
  'FDOUBL': readFDOUBL,
  'FDOUB1': readFDOUB1,
  'FDOUB2': readFDOUB2,
  'CSINGL': readCSINGL,
  'CDOUBL': readCDOUBL,
  'SSHORT': readSSHORT,
  'SNORM': readSNORM,
  'SLONG': readSLONG,
  'USHORT': readUSHORT,
  'UNORM': readUNORM,
  'ULONG': readULONG,
  'UVARI': readUVARI,
  'IDENT': readIDENT,
  'ASCII': readASCII,
  'DTIME': readDTIME,
  'ORIGIN': readORIGIN,
  'OBNAME': readOBNAME,
  'OBJREF': readOBJREF,
  'ATTREF': readATTREF,
  'STATUS': readSTATUS,
  'UNITS': readUNITS
};

/**
 * Read by representation code
 */
export function readByRC(code: number, stream: BinaryReader): any {
  if (code < 1 || code > Object.keys(CODE_TO_RC).length) {
    throw new Error(`Unexpected representation code: ${code}`);
  }
  
  const rcName = CODE_TO_RC[code];
  if (!rcName) {
    throw new Error(`Unknown representation code: ${code}`);
  }
  
  const readerMethod = READ_RC_METHODS[rcName];
  if (!readerMethod) {
    throw new Error(`No reader method for representation code: ${rcName}`);
  }
  
  return readerMethod(stream);
}
