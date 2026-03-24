/**
 * Main entry point
 * TypeScript DLIS parser for parsing Digital Log Interchange Standard files
 */

// Core parsing functions
export { parse, parseAsync, dump, FileReader, Validator } from '$lib/ts/dlis/core/parser';
export type { ParseResult, DumpResult } from '$lib/ts/dlis/core/parser';
import { parse, parseAsync, dump, Validator, FileReader } from '$lib/ts/dlis/core/parser';

// Storage Unit Label
export { StorageUnitLabel } from '$lib/ts/dlis/files/StorageUnitLabel';

// Logical File management
export { LogicalFile } from '$lib/ts/dlis/files/LogicalFile';
export type { SimpleFrame, SimpleChannel } from '$lib/ts/dlis/files/LogicalFile';

// Visible Records and Logical Record Segments
export { VisibleRecord } from '$lib/ts/dlis/records/VisibleRecord';
export { LogicalRecordSegment, EncryptionPacket } from '$lib/ts/dlis/records/LogicalRecordSegment';

// Logical Records (EFLR and IFLR)
export {
  // Base classes
  LogicalRecord,
  EFLR,
  IFLR,
  PublicEFLR,
  PublicEflrObject,

  // Public EFLR classes
  FhlrEFLR,
  FileHeader,
  OlrEFLR,
  Origin,
  WellReferencePoint,
  AxisEFLR,
  Axis,
  ChannelEFLR,
  Channel,
  FrameEFLR,
  Frame,
  Path,
  StaticEFLR,
  Zone,
  Parameter,
  Equipment,
  Tool,
  Process,
  Computation,
  CalibrationMeasurement,
  CalibrationCoefficient,
  Calibration,
  Group,
  Splice,
  ScriptEFLR,
  Comment,
  UpdateEFLR,
  Update,
  UdiEFLR,
  NoFormat,
  LongNameEFLR,
  LNameEFLR,
  LongName,
  SpecEFLR,
  SpecObject,
  DictEFLR,
  DictObject,

  // IFLR classes
  FrameData,
  UnformattedDataLR,
  EoD,

  // Private classes
  PrivateEFLR,
  PrivateEncryptedEFLR,
  PrivateIFLR,
  EncryptedEFLR,

  // Parsing functions
  parseSet,
  parseObjects,
  parseObject,
  parseTemplate
} from '$lib/ts/dlis/records/LogicalRecord';

// Components
export {
  Component,
  Attribute,
  AbsentAttribute,
  InvariantAttribute,
  ObjectComponent,
  Template,
  SetComponent,
  RedundantSet,
  ReplacementSet,
  COMPONENT_ROLES,
  COMPONENT_ROLE_MAP
} from '$lib/ts/dlis/components/Component';

// Binary data readers
export {
  // Integer readers
  readFSHORT,
  readSSHORT,
  readSNORM,
  readSLONG,
  readUSHORT,
  readUNORM,
  readULONG,
  readUVARI,

  // Floating point readers
  readFSINGL,
  readFDOUBL,
  readFSING1,
  readFSING2,
  readFDOUB1,
  readFDOUB2,
  readISINGL,
  readVSINGL,
  readCSINGL,
  readCDOUBL,

  // String readers
  readIDENT,
  readASCII,

  // Date/time readers
  readDTIME,

  // Object readers
  readORIGIN,
  readOBNAME,
  readOBJREF,
  readATTREF,
  readSTATUS,
  readUNITS,

  // Generic reader
  readByRC,

  // Complex types
  FSING1,
  FSING2,
  FDOUB1,
  FDOUB2,
  DTime,
  ObName,
  ObjRef,
  ATTREF,

  // Constants
  CODE_TO_RC,
  RC_TO_CODE
} from '$lib/ts/dlis/readers/RCReader';

// Common types and utilities
export type {
  JsonAble,
  BinaryReader
} from '$lib/ts/dlis/common/types';
export {
  BinaryStream,
  SeekWhence,
  TZ,
  ComponentRole,
  COMPONENT_ROLE_MAP as COMPONENT_ROLE_MAPPING,
  PublicEFLRType,
  DLIS_VERSION
} from '$lib/ts/dlis/common/types';

export {
  readAsString,
  readBytes,
  readAsInteger,
  seekStart,
  seekCurrent,
  endPos,
  Switch,
  ComplexEncoder,
  convertBytes,
  getFileSize,
  findFiles,
  Logger,
  createLogger
} from '$lib/ts/dlis/common/utils';

// Version information
export const VERSION = '1.0.0';
export const AUTHOR = 'DLIS Parser Team';
export const LICENSE = 'BSD-3-Clause';

/**
 * Default export for convenience
 */
export default {
  parse: parse,
  parseAsync: parseAsync,
  dump: dump,
  Validator: Validator,
  FileReader: FileReader,
  VERSION: VERSION,
  AUTHOR: AUTHOR,
  LICENSE: LICENSE
};
