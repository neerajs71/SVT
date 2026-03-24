/**
 * Visible Record - Port of Python VisibleRecord.py
 * Represents a visible record which contains logical record segments
 */

import type { BinaryReader } from '../common/types';
import { DLIS_VERSION } from '../common/types';
import { readUNORM, readUSHORT } from '../readers/RCReader';
import { createLogger } from '../common/utils';
import { LogicalRecordSegment, parseLRSegment } from './LogicalRecordSegment';

const logger = createLogger('VisibleRecord');

/**
 * Visible Record class
 * 
 * Visible Record consists of three parts in order:
 * - Visible Record Length expressed in Representation Code UNORM
 * - Two-byte Format version field
 * - One or more complete Logical Record Segments
 */
export class VisibleRecord {
  // Header attributes
  static readonly VERSION_FIXED_VALUE = 0xFF;

  private _len: number | null = null;
  private _ff: number | null = null;
  private _version: number | null = null;
  private _startPos: number = 0;
  private _restPos: number = 0;
  private _lrSegList: LogicalRecordSegment[] = [];

  constructor() {}

  get length(): number | null {
    return this._len;
  }

  get version(): number | null {
    return this._version;
  }

  get startPos(): number {
    return this._startPos;
  }

  get remaining(): number {
    return this._len ? this._len - this._restPos : 0;
  }

  get lrSegList(): LogicalRecordSegment[] {
    return this._lrSegList;
  }

  toString(): string {
    return `\nVisibleRecord[Length=${this._len} Version=${this._version} startPos=${this._startPos}, remaining=${this.remaining}]`;
  }

  /**
   * Parse a visible record from binary stream
   */
  static parse(stream: BinaryReader): VisibleRecord {
    const vr = new VisibleRecord();

    vr._startPos = stream.tell();
    vr._len = readUNORM(stream);
    logger.debug(`Visible Record Length: ${vr._len}`);

    vr._ff = readUSHORT(stream);
    if (vr._ff !== 0xFF) {
      throw new Error(`Expected format marker 0xFF, but got 0x${vr._ff?.toString(16)}`);
    }

    const myV = readUSHORT(stream);
    logger.debug(`Format Version: ${myV}`);
    if (myV !== DLIS_VERSION) {
      throw new Error(
        `VisibleRecord, unsupported format version. Expected ${DLIS_VERSION}, but got ${myV}, at file position ${stream.tell()}`
      );
    }

    vr._version = myV;
    vr._restPos = stream.tell() - vr._startPos;

    // Parse logical record segments until we've consumed the entire visible record
    let maxSegments = 1000; // Prevent infinite loops
    let segmentCount = 0;
    let lastRemaining = -1;
    
    while (vr.remaining > 0 && segmentCount < maxSegments) {
      const currentRemaining = vr.remaining;
      
      // Check if we're making progress
      if (currentRemaining === lastRemaining) {
        throw new Error(`Visible record parsing stuck. Remaining bytes not decreasing: ${currentRemaining}`);
      }
      
      if (currentRemaining < 0) {
        throw new Error(`Invalid remaining bytes in visible record: ${currentRemaining}`);
      }
      
      const currSeg = parseLRSegment(stream);
      
      vr._restPos += currSeg.segLen;
      vr._lrSegList.push(currSeg);
      
      // Insurance policy in case any bug when parsing LogicalRecordSegment
      if (stream.tell() !== currSeg.endPos) {
        throw new Error(`Stream position mismatch: expected ${currSeg.endPos}, got ${stream.tell()}`);
      }
      
      lastRemaining = currentRemaining;
      segmentCount++;
    }
    
    if (segmentCount >= maxSegments) {
      throw new Error(`Visible record parsing aborted after ${maxSegments} segments. Record may be corrupted.`);
    }

    // Verify we consumed exactly the visible record length
    if (stream.tell() !== (vr._startPos + vr._len)) {
      throw new Error(`Visible record length mismatch: expected ${vr._startPos + vr._len}, got ${stream.tell()}`);
    }

    return vr;
  }
}
