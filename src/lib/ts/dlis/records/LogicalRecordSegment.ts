/**
 * Logical Record Segment - Port of Python LogicalRecordSegment.py
 * Represents a logical record segment with header, optional encryption, body, and optional trailer
 */

import type { BinaryReader } from '../common/types';
import { SeekWhence } from '../common/types';
import { readUNORM, readUSHORT, readULONG } from '../readers/RCReader';
import { readBytes, seekStart, seekCurrent, createLogger } from '../common/utils';

const logger = createLogger('LogicalRecordSegment');

/**
 * Encryption Packet class
 */
export class EncryptionPacket {
  static readonly LENGTH_UNORM = 2;

  public length: number;
  public prodCode: number;
  public payload: Uint8Array;

  constructor(stream: BinaryReader) {
    this.length = readUNORM(stream);
    this.prodCode = readUNORM(stream);
    const payLen = this.length - EncryptionPacket.LENGTH_UNORM - EncryptionPacket.LENGTH_UNORM;
    if (payLen < 0) {
      throw new Error(`Negative encryption payload of ${payLen}`);
    }
    this.payload = stream.read(payLen);
  }

  get size(): number {
    return this.length;
  }
}

/**
 * Logical Record Segment class
 */
export class LogicalRecordSegment {
  private _startPos: number = 0;
  private _segLen: number = 0;
  
  // Segment attributes
  private _lrType: number | null = null; // Type of Logical record (version 1 only)
  private _encryptPkt: EncryptionPacket | null = null; // Encryption packet
  private _dataLen: number = 0; // Length of available data in segment
  private _padCount: number = 0; // Optional padding bytes
  private _checksum: number | null = null; // Optional checksum
  private _attrs: string | null = null; // Attributes as binary string
  private _trailerLen: number = 0; // Trailer length
  private _body: Uint8Array | null = null; // Segment body
  private _dataStartPos: number = 0; // Position where data starts

  constructor() {}

  get startPos(): number {
    return this._startPos;
  }

  get endPos(): number {
    return this._startPos + this._segLen;
  }

  get segLen(): number {
    return this._segLen;
  }

  get isEFLR(): boolean {
    return this._attrs ? parseInt(this._attrs[0]!, 10) === 1 : false;
  }

  get hasPred(): boolean {
    return this._attrs ? parseInt(this._attrs[1]!, 10) === 1 : false;
  }

  get hasSucc(): boolean {
    return this._attrs ? parseInt(this._attrs[2]!, 10) === 1 : false;
  }

  get encrypted(): boolean {
    return this._attrs ? parseInt(this._attrs[3]!, 10) === 1 : false;
  }

  get hasEncryptionPkt(): boolean {
    return this._attrs ? parseInt(this._attrs[4]!, 10) === 1 : false;
  }

  get hasChecksum(): boolean {
    return this._attrs ? parseInt(this._attrs[5]!, 10) === 1 : false;
  }

  get hasTrailingLength(): boolean {
    return this._attrs ? parseInt(this._attrs[6]!, 10) === 1 : false;
  }

  get hasPadding(): boolean {
    return this._attrs ? parseInt(this._attrs[7]!, 10) === 1 : false;
  }

  get hasTrailer(): boolean {
    return this.hasPadding || this.hasChecksum || this.hasTrailingLength;
  }

  get lrType(): number | null {
    return this._lrType;
  }

  get trailerLen(): number {
    return this._trailerLen;
  }

  /**
   * Read body data (lazy loading support)
   */
  readBody(stream: BinaryReader): Uint8Array {
    if (this._body === null) {
      stream.seek(this._dataStartPos, SeekWhence.SET);
      this._body = readBytes(stream, this._dataLen);
    }
    return this._body;
  }

  toString(): string {
    return `LogicalRecordSegment[len:${this._segLen} isEFLR:${this.isEFLR} hasPredecessor:${this.hasPred} hasSuccessor:${this.hasSucc} encrypted:${this.encrypted} hasEncryptPkt:${this.hasEncryptionPkt} hasCheckSum:${this.hasChecksum} hasTrailLen:${this.hasTrailingLength} hasPad:${this.hasPadding} lrType:${this.lrType}]`;
  }
}

/**
 * Check LR Segment length validity
 */
function checkLrSegLen(len: number): void {
  if (len % 2 !== 0) {
    throw new Error(`LR Segment length must be even, got ${len}`);
  }
  if (len < 16) {
    throw new Error(`LR Segment length must be at least 16, got ${len}`);
  }
}

/**
 * Read the header of a Logical Record Segment
 */
function readHeader(stream: BinaryReader, lrSeg: LogicalRecordSegment): void {
  (lrSeg as any)._startPos = stream.tell();
  (lrSeg as any)._segLen = readUNORM(stream);
  checkLrSegLen((lrSeg as any)._segLen);
  
  const myAttr = readUSHORT(stream);
  (lrSeg as any)._attrs = myAttr.toString(2).padStart(8, '0');
  (lrSeg as any)._lrType = readUSHORT(stream);

  // 2 bytes for LR seg length, 1 byte for LR seg attr and 1 byte for LR type
  (lrSeg as any)._dataLen = (lrSeg as any)._segLen - 4;

  getTrailerLength(stream, lrSeg);
  (lrSeg as any)._dataLen -= lrSeg.trailerLen;

  // Handle encryption
  if (lrSeg.hasEncryptionPkt) {
    (lrSeg as any)._encryptPkt = new EncryptionPacket(stream);
    (lrSeg as any)._dataLen -= (lrSeg as any)._encryptPkt.size;
  } else {
    (lrSeg as any)._encryptPkt = null;
  }

  if (!lrSeg.encrypted && (lrSeg as any)._dataLen < 0) {
    throw new Error(`Illegal negative data length of ${(lrSeg as any)._dataLen}`);
  }
}

/**
 * Read the trailer of a Logical Record Segment
 */
function readTrailer(stream: BinaryReader, lrSeg: LogicalRecordSegment): void {
  if (lrSeg.hasTrailer) {
    if (lrSeg.hasPadding) {
      seekCurrent(stream, (lrSeg as any)._padCount);
    }
    if (lrSeg.hasChecksum) {
      (lrSeg as any)._checksum = readUNORM(stream);
    } else {
      (lrSeg as any)._checksum = null;
    }
    if (lrSeg.hasTrailingLength) {
      const trailingLength = readULONG(stream);
      if (trailingLength !== lrSeg.segLen) {
        throw new Error(`Trailing length mismatch: expected ${lrSeg.segLen}, got ${trailingLength}`);
      }
    }
  }
}

/**
 * Read the body of LogicalRecordSegment
 * If it is part of an EFLR, then read it directly, otherwise, just read its index for lazy loading
 */
function readBody(stream: BinaryReader, lrSeg: LogicalRecordSegment): void {
  if (!lrSeg.isEFLR || (lrSeg.isEFLR && lrSeg.encrypted)) {
    // For IFLR or encrypted EFLR, use lazy loading
    (lrSeg as any)._dataStartPos = stream.tell();
    stream.seek((lrSeg as any)._dataLen, SeekWhence.CUR);
  } else {
    // For EFLR, read immediately
    (lrSeg as any)._body = readBytes(stream, (lrSeg as any)._dataLen);
  }
}

/**
 * Compute total length of trailer including padding, checksum and duplicated LR Segment length
 */
function getTrailerLength(stream: BinaryReader, lrSeg: LogicalRecordSegment): void {
  (lrSeg as any)._trailerLen = 0;
  
  if (lrSeg.hasTrailingLength) {
    (lrSeg as any)._trailerLen += 2;
  }
  if (lrSeg.hasChecksum) {
    (lrSeg as any)._trailerLen += 2;
  }
  if (lrSeg.hasPadding) {
    const currPos = stream.tell();
    
    let padCountPos = lrSeg.endPos - 1;
    if (lrSeg.hasTrailingLength) {
      if (lrSeg.hasChecksum) {
        padCountPos -= 4;
      } else {
        padCountPos -= 2;
      }
    } else {
      if (lrSeg.hasChecksum) {
        padCountPos -= 2;
      }
    }
    
    // Move to the position of pad count byte
    seekStart(stream, padCountPos);
    (lrSeg as any)._padCount = readUSHORT(stream);
    
    if ((lrSeg as any)._padCount > 255) {
      throw new Error(`Pad count too large: ${(lrSeg as any)._padCount}`);
    }
    
    // Move back to the original position
    seekStart(stream, currPos);
  }
  
  (lrSeg as any)._trailerLen += (lrSeg as any)._padCount;
}

/**
 * Parse a Logical Record Segment
 */
export function parseLRSegment(stream: BinaryReader): LogicalRecordSegment {
  const lrSeg = new LogicalRecordSegment();
  readHeader(stream, lrSeg);
  readBody(stream, lrSeg);
  readTrailer(stream, lrSeg);
  logger.debug(lrSeg.toString());
  return lrSeg;
}
