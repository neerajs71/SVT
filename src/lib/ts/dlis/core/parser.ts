/**
 * Core DLIS Parser - Port of Python core.py
 * Main parsing and dump functions
 */

import type { BinaryReader } from '$lib/ts/dlis/common/types';
import { BinaryStream } from '$lib/ts/dlis/common/types';
import { createLogger, getFileSize } from '$lib/ts/dlis/common/utils';
import { StorageUnitLabel } from '../files/StorageUnitLabel';
import { VisibleRecord } from '../records/VisibleRecord';
import { LogicalFile } from '../files/LogicalFile';
import { LogicalRecordSegment } from '../records/LogicalRecordSegment';

const logger = createLogger('core');

/**
 * Parse result interface
 */
export interface ParseResult {
  storageUnitLabel: StorageUnitLabel;
  logicalFiles: LogicalFile[];
}

/**
 * Parse a DLIS file which may include multiple Logical Files
 * 
 * @param buffer - ArrayBuffer or Uint8Array containing DLIS file data
 * @param eflrOnly - If true, only parse EFLR in each logical file
 * @returns Tuple of StorageUnitLabel and array of LogicalFile
 */
export function parse(buffer: ArrayBuffer | Uint8Array, eflrOnly: boolean = false): ParseResult {
  const startTime = performance.now();
  logger.info(`Start parsing DLIS file`);
  
  const stream = new BinaryStream(buffer);
  const totalBytes = stream.length;
  
  try {
    // Parse Storage Unit Label
    logger.debug('Start parsing Storage Unit Label');
    const sul = StorageUnitLabel.parse(stream);
    logger.debug(sul.toString());
    logger.debug('End parsing Storage Unit Label');
    
    const vrList: VisibleRecord[] = [];
    const lrSegList: LogicalRecordSegment[] = [];
    
    // Parse all visible records with safety checks
    let maxIterations = 10000; // Prevent infinite loops
    let iterationCount = 0;
    let lastPosition = -1;
    
    while (stream.tell() < totalBytes && iterationCount < maxIterations) {
      const currentPosition = stream.tell();
      
      // Check if we're making progress
      if (currentPosition === lastPosition) {
        throw new Error(`Parsing stuck at position ${currentPosition}. Stream is not advancing.`);
      }
      
      // Check for reasonable progress
      if (currentPosition >= totalBytes) {
        break;
      }
      
      try {
        const vr = VisibleRecord.parse(stream);
        vrList.push(vr);
        
        // Lazy loading for IFLR: if lrSeg is part of EFLR, then its body is loaded,
        // otherwise only the pos and length are recorded.
        lrSegList.push(...vr.lrSegList);
        logger.debug(vr.toString());
        
        lastPosition = currentPosition;
        iterationCount++;
        
        // Periodic progress check for very large files
        if (iterationCount % 100 === 0) {
          const progress = (currentPosition / totalBytes) * 100;
          logger.debug(`Parsing progress: ${progress.toFixed(1)}% (${iterationCount} visible records)`);
        }
        
      } catch (vrError) {
        logger.error(`Error parsing visible record at position ${currentPosition}: ${vrError}`);
        throw new Error(`Failed to parse visible record at position ${currentPosition}: ${vrError}`);
      }
    }
    
    if (iterationCount >= maxIterations) {
      throw new Error(`Parsing aborted after ${maxIterations} iterations. File may be corrupted or extremely large.`);
    }
    
    logger.debug(`Parsed ${vrList.length} visible records, ${lrSegList.length} LR segments`);
    logger.debug(`Start parsing ${lrSegList.length} LR Segments`);
    const lfList = splitLogicalFiles(lrSegList, stream, eflrOnly);
    logger.info(`End parsing DLIS file, found ${lfList.length} LogicalFiles`);
    
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(3);
    const bufferLength = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.byteLength;
    logger.info(`Took ${duration} sec to parse file (${bufferLength} bytes)`);
    
    return {
      storageUnitLabel: sul,
      logicalFiles: lfList
    };
    
  } catch (error) {
    logger.error(`Error parsing DLIS file: ${error}`);
    throw error;
  }
}

/**
 * Async version of parse with progress callback and yielding control
 * 
 * @param buffer - ArrayBuffer or Uint8Array containing DLIS file data
 * @param eflrOnly - If true, only parse EFLR in each logical file
 * @param progressCallback - Optional callback for progress updates
 * @returns Promise resolving to ParseResult
 */
export async function parseAsync(
  buffer: ArrayBuffer | Uint8Array, 
  eflrOnly: boolean = false,
  progressCallback?: (progress: number, status: string) => void
): Promise<ParseResult> {
  const startTime = performance.now();
  logger.info(`Start async parsing DLIS file`);
  
  const stream = new BinaryStream(buffer);
  const totalBytes = stream.length;
  
  try {
    progressCallback?.(5, 'Parsing Storage Unit Label...');
    
    // Parse Storage Unit Label
    logger.debug('Start parsing Storage Unit Label');
    const sul = StorageUnitLabel.parse(stream);
    logger.debug(sul.toString());
    logger.debug('End parsing Storage Unit Label');
    
    progressCallback?.(10, 'Parsing visible records...');
    
    const vrList: VisibleRecord[] = [];
    const lrSegList: LogicalRecordSegment[] = [];
    
    // Parse all visible records with safety checks
    let maxIterations = 10000; // Prevent infinite loops
    let iterationCount = 0;
    let lastPosition = -1;
    
    while (stream.tell() < totalBytes && iterationCount < maxIterations) {
      const currentPosition = stream.tell();
      
      // Check if we're making progress
      if (currentPosition === lastPosition) {
        throw new Error(`Parsing stuck at position ${currentPosition}. Stream is not advancing.`);
      }
      
      // Check for reasonable progress
      if (currentPosition >= totalBytes) {
        break;
      }
      
      try {
        const vr = VisibleRecord.parse(stream);
        vrList.push(vr);
        
        // Lazy loading for IFLR: if lrSeg is part of EFLR, then its body is loaded,
        // otherwise only the pos and length are recorded.
        lrSegList.push(...vr.lrSegList);
        logger.debug(vr.toString());
        
        lastPosition = currentPosition;
        iterationCount++;
        
        // Periodic progress check and yield control
        if (iterationCount % 50 === 0) {
          const progress = 10 + (currentPosition / totalBytes) * 70; // 10-80% for visible records
          progressCallback?.(progress, `Parsing visible records... (${iterationCount} records)`);
          
          // Yield control to prevent UI blocking
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        
      } catch (vrError) {
        logger.error(`Error parsing visible record at position ${currentPosition}: ${vrError}`);
        throw new Error(`Failed to parse visible record at position ${currentPosition}: ${vrError}`);
      }
    }
    
    if (iterationCount >= maxIterations) {
      throw new Error(`Parsing aborted after ${maxIterations} iterations. File may be corrupted or extremely large.`);
    }
    
    progressCallback?.(80, 'Processing logical files...');
    
    logger.debug(`Parsed ${vrList.length} visible records, ${lrSegList.length} LR segments`);
    logger.debug(`Start parsing ${lrSegList.length} LR Segments`);
    const lfList = splitLogicalFiles(lrSegList, stream, eflrOnly);
    logger.info(`End parsing DLIS file, found ${lfList.length} LogicalFiles`);
    
    progressCallback?.(100, 'Parsing completed!');
    
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(3);
    const bufferLength = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.byteLength;
    logger.info(`Took ${duration} sec to parse file (${bufferLength} bytes)`);
    
    return {
      storageUnitLabel: sul,
      logicalFiles: lfList
    };
    
  } catch (error) {
    logger.error(`Error parsing DLIS file: ${error}`);
    throw error;
  }
}

/**
 * Dump a DLIS file to structured format
 * 
 * @param buffer - ArrayBuffer or Uint8Array containing DLIS file data
 * @param eflrOnly - If true, only dump EFLRs
 * @returns Structured representation of the DLIS file
 */
export function dump(buffer: ArrayBuffer | Uint8Array, eflrOnly: boolean = false): DumpResult {
  const { storageUnitLabel, logicalFiles } = parse(buffer, eflrOnly);
  
  const result: DumpResult = {
    storageUnitLabel: storageUnitLabel,
    logicalFiles: logicalFiles.map(lf => ({
      id: lf.id.trim(),
      seqNum: lf.seqNum.trim(),
      data: lf.dump(eflrOnly)
    }))
  };
  
  return result;
}

/**
 * Dump result interface
 */
export interface DumpResult {
  storageUnitLabel: StorageUnitLabel;
  logicalFiles: Array<{
    id: string;
    seqNum: string;
    data: {
      json: string;
      csvFiles?: Map<string, string>;
      binaryFiles?: Map<string, { metadata: any; data: Uint8Array }>;
    };
  }>;
}

/**
 * Split logical record segments into logical files
 */
function splitLogicalFiles(
  lrSegList: LogicalRecordSegment[], 
  stream: BinaryReader, 
  eflrOnly: boolean = false
): LogicalFile[] {
  const eflrSegList: LogicalRecordSegment[] = [];
  const iflrSegList: LogicalRecordSegment[] = [];
  const lfList: LogicalFile[] = [];
  
  for (const lrSeg of lrSegList) {
    if (lrSeg.isEFLR) {
      if (lrSeg.lrType === 0) { // FHLR, starts a new LogicalFile
        if (eflrSegList.length === 0) {
          // First one
          eflrSegList.push(lrSeg);
        } else {
          // Start a new logical file
          lfList.push(new LogicalFile(eflrSegList, iflrSegList, stream, eflrOnly));
          eflrSegList.length = 0; // clear
          iflrSegList.length = 0; // clear
          eflrSegList.push(lrSeg);
        }
      } else {
        eflrSegList.push(lrSeg);
      }
    } else {
      iflrSegList.push(lrSeg);
    }
  }
  
  // Add the last logical file (always, to match Python behavior)
  lfList.push(new LogicalFile(eflrSegList, iflrSegList, stream, eflrOnly));
  
  return lfList;
}

/**
 * Browser-specific file reading utilities
 */
export class FileReader {
  /**
   * Read file from File input
   */
  static async readFile(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new globalThis.FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read file as ArrayBuffer'));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Read file from URL (for browser environment)
   */
  static async readUrl(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    return response.arrayBuffer();
  }
}

/**
 * Validation utilities
 */
export class Validator {
  /**
   * Check if buffer contains a valid DLIS file
   */
  static isDLISFile(buffer: ArrayBuffer | Uint8Array): boolean {
    try {
      const stream = new BinaryStream(buffer);
      if (stream.length < StorageUnitLabel.LENGTH) {
        return false;
      }
      
      // Try to parse the Storage Unit Label
      StorageUnitLabel.parse(stream);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get basic file information without full parsing
   */
  static getFileInfo(buffer: ArrayBuffer | Uint8Array): {
    isValid: boolean;
    storageUnitLabel?: StorageUnitLabel;
    error?: string;
  } {
    try {
      const stream = new BinaryStream(buffer);
      const sul = StorageUnitLabel.parse(stream);
      return {
        isValid: true,
        storageUnitLabel: sul
      };
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
