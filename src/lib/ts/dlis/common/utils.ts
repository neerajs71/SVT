/**
 * Common utility functions - Port of Python common.py
 */

import type { BinaryReader } from './types';
import { SeekWhence } from './types';

/**
 * Read exactly n bytes and return as string (ASCII)
 */
export function readAsString(stream: BinaryReader, n: number): string {
  const bytes = readBytes(stream, n);
  return new TextDecoder('ascii').decode(bytes);
}

/**
 * Read exactly n bytes
 */
export function readBytes(stream: BinaryReader, n: number): Uint8Array {
  const bytes = stream.read(n);
  if (bytes.length !== n) {
    throw new Error(`Cannot read ${n} bytes, only ${bytes.length} left`);
  }
  return bytes;
}

/**
 * Read n bytes as integer
 */
export function readAsInteger(stream: BinaryReader, n: number): number {
  const bytes = stream.read(n);
  if (bytes.length !== n) {
    throw new Error(`Cannot read ${n} bytes, only ${bytes.length} available`);
  }
  
  try {
    const str = new TextDecoder('ascii').decode(bytes);
    const result = parseInt(str, 10);
    if (isNaN(result)) {
      throw new Error(`Cannot determine integer from ${str}`);
    }
    return result;
  } catch (error) {
    throw new Error(`Cannot determine integer RP66 version number from bytes`);
  }
}

/**
 * Seek to absolute position from start of stream
 */
export function seekStart(stream: BinaryReader, offset: number): void {
  if (offset < 0) {
    throw new Error('Offset must be non-negative');
  }
  stream.seek(offset, SeekWhence.SET);
}

/**
 * Seek relative to current position
 */
export function seekCurrent(stream: BinaryReader, offset: number): void {
  if (offset < 0) {
    throw new Error('Offset must be non-negative');
  }
  stream.seek(offset, SeekWhence.CUR);
}

/**
 * Get end position of stream
 */
export function endPos(stream: BinaryReader): number {
  const currPos = stream.tell();
  stream.seek(0, SeekWhence.END);
  const endPosition = stream.tell();
  stream.seek(currPos, SeekWhence.SET);
  return endPosition;
}

/**
 * Switch statement helper (JavaScript doesn't have switch fallthrough like Python)
 */
export class Switch {
  private value: any;
  private matched: boolean = false;

  constructor(value: any) {
    this.value = value;
  }

  case(...values: any[]): boolean {
    if (this.matched || values.length === 0) {
      return true;
    }
    
    if (values.includes(this.value)) {
      this.matched = true;
      return true;
    }
    
    return false;
  }

  default(): boolean {
    return !this.matched;
  }
}

/**
 * Complex JSON encoder
 */
export class ComplexEncoder {
  static stringify(obj: any, space?: string | number): string {
    return JSON.stringify(obj, (key, value) => {
      if (value && typeof value === 'object' && 'toJSON' in value) {
        return value.toJSON();
      }
      return value;
    }, space);
  }
}

/**
 * Convert bytes to human readable format
 */
export function convertBytes(numBytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let num = numBytes;
  
  for (const unit of units) {
    if (num < 1024.0) {
      return `${num.toFixed(1)} ${unit}`;
    }
    num /= 1024.0;
  }
  
  return `${num.toFixed(1)} TB`;
}

/**
 * Get file size (for browser environment, this would need to be adapted)
 */
export function getFileSize(buffer: ArrayBuffer): string {
  return convertBytes(buffer.byteLength);
}

/**
 * Find files matching patterns (browser adaptation would be needed)
 */
export function findFiles(directory: string, patterns: string[]): string[] {
  // This would need to be implemented differently for browser environment
  // For now, return empty array as this is mainly used for testing
  return [];
}

/**
 * Logger class - Disabled for production
 */
export class Logger {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  debug(message: string, ...args: any[]): void {
    // Debug logging disabled
  }

  info(message: string, ...args: any[]): void {
    // Info logging disabled
  }

  warn(message: string, ...args: any[]): void {
    // Warning logging disabled
  }

  error(message: string, ...args: any[]): void {
    // Error logging disabled
  }
}

/**
 * Create logger instance
 */
export function createLogger(moduleName: string): Logger {
  return new Logger(moduleName);
}
