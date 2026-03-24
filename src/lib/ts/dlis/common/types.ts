/**
 * Core types and interfaces for the DLIS parser
 */

export interface JsonAble {
  toJSON(): any;
}

export interface BinaryReader {
  read(length: number): Uint8Array;
  tell(): number;
  seek(position: number, whence?: SeekWhence): void;
}

export enum SeekWhence {
  SET = 0,  // Absolute position
  CUR = 1,  // Relative to current position
  END = 2   // Relative to end
}

export class BinaryStream implements BinaryReader {
  private buffer: Uint8Array;
  private position: number = 0;

  constructor(buffer: Uint8Array | ArrayBuffer) {
    this.buffer = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  read(length: number): Uint8Array {
    if (this.position + length > this.buffer.length) {
      throw new Error(`Cannot read ${length} bytes, only ${this.buffer.length - this.position} bytes available`);
    }
    const result = this.buffer.slice(this.position, this.position + length);
    this.position += length;
    return result;
  }

  tell(): number {
    return this.position;
  }

  seek(position: number, whence: SeekWhence = SeekWhence.SET): void {
    switch (whence) {
      case SeekWhence.SET:
        this.position = position;
        break;
      case SeekWhence.CUR:
        this.position += position;
        break;
      case SeekWhence.END:
        this.position = this.buffer.length + position;
        break;
    }
    
    if (this.position < 0) {
      this.position = 0;
    } else if (this.position > this.buffer.length) {
      this.position = this.buffer.length;
    }
  }

  get length(): number {
    return this.buffer.length;
  }

  get remaining(): number {
    return this.buffer.length - this.position;
  }
}

// Timezone enumeration matching Python implementation
export enum TZ {
  LocalStandard = 0,
  LocalDaylightSavings = 1,
  GreenwichMeanTime = 2
}

// Component roles matching Python implementation
export enum ComponentRole {
  ABSATER = 'ABSATER',
  ATTRIB = 'ATTRIB',
  INVATR = 'INVATR',
  OBJECT = 'OBJECT',
  RDSET = 'RDSET',
  RSET = 'RSET',
  SET = 'SET'
}

export const COMPONENT_ROLE_MAP: { [key: string]: ComponentRole } = {
  '000': ComponentRole.ABSATER,
  '001': ComponentRole.ATTRIB,
  '010': ComponentRole.INVATR,
  '011': ComponentRole.OBJECT,
  '100': 'reserved' as any,
  '101': ComponentRole.RDSET,
  '110': ComponentRole.RSET,
  '111': ComponentRole.SET
};

// Public EFLR Types
export enum PublicEFLRType {
  FHLR = 0,
  OLR = 1,
  AXIS = 2,
  CHANNL = 3,
  FRAME = 4,
  STATIC = 5,
  SCRIPT = 6,
  UPDATE = 7,
  UDI = 8,
  LNAME = 9,
  SPEC = 10,
  DICT = 12
}

// Constants
export const DLIS_VERSION = 1;
