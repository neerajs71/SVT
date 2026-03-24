/**
 * Storage Unit Label - Port of Python StorageUnitLabel.py
 * Represents the first 80 bytes of a DLIS file containing metadata
 */

import type { BinaryReader } from '../common/types';
import { DLIS_VERSION } from '../common/types';
import { readAsInteger, readAsString, readBytes, createLogger } from '../common/utils';

const logger = createLogger('StorageUnitLabel');

/**
 * Storage Unit Label class
 * Only RP66 V1 is supported
 */
export class StorageUnitLabel {
  // Length constants
  static readonly LENGTH = 80;
  static readonly SU_SEQNUM_LENGTH = 4;
  static readonly DLIS_VERSION_LENGTH = 5;
  static readonly SU_STRUCTURE_LENGTH = 6;
  static readonly MAX_RECORD_LEN_LENGTH = 5;
  static readonly SSI_LENGTH = 60;
  
  // Storage unit structure constant
  static readonly SU_STRUCTURE_RECORD = 'RECORD';

  // Properties
  private _susn: number = -1; // Storage unit sequence number
  private _version: number = 0; // DLIS version
  private _sus: string | null = null; // Storage unit structure
  private _maxRecordLen: number = -1; // Maximum record length
  private _ssi: string | null = null; // Storage set identifier

  constructor() {}

  get susn(): number {
    return this._susn;
  }

  get version(): number {
    return this._version;
  }

  get sus(): string | null {
    return this._sus;
  }

  get maxRecordLen(): number {
    return this._maxRecordLen;
  }

  get ssi(): string | null {
    return this._ssi;
  }

  toString(): string {
    return `\nStorageUnitLabel[SUSN=${this._susn} Vers=${this._version} SUS=${this._sus} MaxRecordLen=${this._maxRecordLen} SSI=${this._ssi}]`;
  }

  /**
   * Parse Storage Unit Label from binary stream
   */
  static parse(stream: BinaryReader): StorageUnitLabel {
    const sul = new StorageUnitLabel();

    /* Start to parse the Storage Unit Label. The first part of a logical file is the "Storage Unit Label" which follows this format:
     * - Storage Unit Seq Number: 4xChar Integer.
     * - DLIS Ver: 5xChar string, follows "Vn.mm" format, "n": one-digit major version number, "mm": two-digits minor version only support "v1.00" for now.
     * - Storage Unit Structure: 6xChar string, left with trailing blanks if needed. Only support option is "RECORD"
     * - Maximum Record Length: non-negative integer, 5xChar, with preceding blanks or zeros. A value 0 indicates max length of a record is unknown.
     * - Storage Set Identifier: 60xChar.
     */

    // First 4 bytes are Storage unit sequence number
    try {
      const value = readBytes(stream, StorageUnitLabel.SU_SEQNUM_LENGTH);
      sul._susn = parseInt(new TextDecoder('ascii').decode(value), 10);
      if (isNaN(sul._susn)) {
        throw new Error(`Failed to interpret SequenceNumber of SU from value [${new TextDecoder('ascii').decode(value)}]`);
      }
    } catch (error) {
      throw new Error(`Failed to interpret SequenceNumber of SU: ${error}`);
    }
    logger.debug(`Storage Unit Sequence Number: ${sul._susn}`);

    // Next 5 bytes are RP66 version and format edition in the form "VN.nn"
    const versionString = readAsString(stream, StorageUnitLabel.DLIS_VERSION_LENGTH);
    const versionPattern = /^V1\.[0-9][0-9]$/;
    if (!versionPattern.test(versionString)) {
      throw new Error(`Only supported DLIS version is V1.xx, but got ${versionString}`);
    }
    sul._version = parseInt(versionString.charAt(1), 10);
    logger.debug(`DLIS Version: ${sul._version}`);

    // Next 6 bytes is the Storage unit structure, only supported option in v1 is "RECORD"
    sul._sus = readAsString(stream, StorageUnitLabel.SU_STRUCTURE_LENGTH);
    if (sul._sus !== StorageUnitLabel.SU_STRUCTURE_RECORD) {
      throw new Error(`Unsupported Storage Unit Structure in V1: ${sul._sus}`);
    }
    logger.debug(`Storage Unit Structure: ${sul._sus}`);

    // Read the max record length (5 bytes)
    sul._maxRecordLen = readAsInteger(stream, StorageUnitLabel.MAX_RECORD_LEN_LENGTH);
    logger.debug(`Maximum Record Length: ${sul._maxRecordLen}`);

    // Finally the Storage Set Identifier (60 bytes) that is common to both versions
    sul._ssi = readAsString(stream, StorageUnitLabel.SSI_LENGTH);
    logger.debug(`Storage Set Identifier: ${sul._ssi}`);

    // Verify we read exactly 80 bytes
    if (stream.tell() !== StorageUnitLabel.LENGTH) {
      throw new Error(`Expected to read ${StorageUnitLabel.LENGTH} bytes, but read ${stream.tell()} bytes`);
    }

    return sul;
  }
}
