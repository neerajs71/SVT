/**
 * Logical Record classes - Port of Python LogicalRecord.py
 * Handles EFLR and IFLR parsing and all their variants
 */

import type { BinaryReader, JsonAble } from '../common/types';
import { PublicEFLRType, ComponentRole, COMPONENT_ROLE_MAP } from '../common/types';
import { readUSHORT, readUVARI, readIDENT, readUNITS, readOBNAME, readByRC, ObName } from '../readers/RCReader';
import { endPos, createLogger } from '../common/utils';
import { 
  SetComponent, 
  ObjectComponent, 
  Template, 
  Attribute, 
  AbsentAttribute, 
  InvariantAttribute,
  RedundantSet,
  ReplacementSet
} from '../components/Component';

const logger = createLogger('LogicalRecord');

// ==================== UTILITY FUNCTIONS ====================

function findAttr(label: string, object: { attributes: Attribute[] }): Attribute | undefined {
  return object.attributes.find(attr => attr.label === label);
}

function findAttrValue(label: string, object: { attributes: Attribute[] }): any {
  const attr = findAttr(label, object);
  return attr ? attr.value : undefined;
}

function getClassName(setType: string): string {
  const words = setType.split('-');
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
}

// ==================== BASE LOGICAL RECORD CLASSES ====================

export abstract class LogicalRecord implements JsonAble {
  toJSON(): any {
    return { [this.constructor.name]: { ...this } };
  }
}

export class EncryptedEFLR {
  constructor(public lrType: number) {}
}

export abstract class EFLR extends LogicalRecord {
  constructor(
    public setName: string | null,
    public setType: string | null,
    public template: Template | null,
    public objects: any[]
  ) {
    super();
  }
}

export abstract class IFLR extends LogicalRecord {}

// ==================== PUBLIC EFLR CLASSES ====================

export abstract class PublicEFLR extends EFLR {}

export abstract class PublicEflrObject implements JsonAble {
  protected _name: ObName | null;
  protected _attributes: Attribute[];

  constructor(obj: ObjectComponent) {
    this._name = obj.name;
    this._attributes = obj.attributes;
  }

  get name(): ObName | null {
    return this._name;
  }

  get attributes(): Attribute[] {
    return this._attributes;
  }

  getAttrValue(attrName: string): any {
    return findAttrValue(attrName, this);
  }

  getAttr(attrName: string): Attribute | undefined {
    return findAttr(attrName, this);
  }

  toJSON(): any {
    return { [this.constructor.name]: { ...this } };
  }
}

// File Header classes
export class FileHeader extends PublicEflrObject {
  static readonly SEQUENCE_NUMBER = 'SEQUENCE-NUMBER';
  static readonly ID = 'ID';
}

export class FhlrEFLR extends PublicEFLR {}

// Origin classes
export class Origin extends PublicEflrObject {
  static readonly FILE_ID = 'FILE-ID';
  static readonly FILE_SET_NAME = 'FILE-SET-NUMBER';
  static readonly FILE_SET_NUMBER = 'FILE-SET-NUMBER';
  static readonly FILE_NUMBER = 'FILE-NUMBER';
  static readonly FILE_TYPE = 'FILE-TYPE';
  static readonly PRODUCT = 'PRODUCT';
  static readonly VERSION = 'VERSION';
  static readonly PROGRAMS = 'PROGRAMS';
  static readonly CREATION_TIME = 'CREATION-TIME';
  static readonly ORDER_NUMBER = 'ORDER-NUMBER';
  static readonly RUN_NUMBER = 'RUN-NUMBER';
  static readonly WELL_ID = 'WELL-ID';
  static readonly WELL_NUMBER = 'WELL-NUMBER';
  static readonly PRODUCER_CODE = 'PRODUCER-CODE';
  static readonly PRODUCER_NAME = 'PRODUCER-NAME';
  static readonly COMPANY = 'COMPANY';
  static readonly NAME_SPACE_NAME = 'NAME-SPACE-NAME';
  static readonly NAME_SPACE_VERSION = 'NAME-SPACE-VERSION';
}

export class WellReferencePoint extends PublicEflrObject {
  static readonly PERMANENT_DATUM = 'PERMANENT-DATUM';
  static readonly VERTICAL_ZERO = 'VERTICAL-ZERO';
  static readonly PERMANENT_DATUM_ELEVATION = 'PERMANENT-DATUM-ELEVATION';
  static readonly ABOVE_PERMANENT_DATUM = 'ABOVE-PERMANENT-DATUM';
  static readonly MAGNETIC_DECLINATION = 'MAGNETIC-DECLINATION';
  static readonly COORDINATE_1_NAME = 'COORDINATE-1-NAME';
  static readonly COORDINATE_1_VALUE = 'COORDINATE-1-VALUE';
  static readonly COORDINATE_2_NAME = 'COORDINATE-2-NAME';
  static readonly COORDINATE_2_VALUE = 'COORDINATE-2-VALUE';
  static readonly COORDINATE_3_NAME = 'COORDINATE-3-NAME';
  static readonly COORDINATE_3_VALUE = 'COORDINATE-3-VALUE';
}

export class OlrEFLR extends PublicEFLR {}

// Axis classes
export class Axis extends PublicEflrObject {
  static readonly AXIS_ID = 'AXIS-ID';
  static readonly COORDINATES = 'COORDINATES';
  static readonly SPACING = 'SPACING';
}

export class AxisEFLR extends PublicEFLR {}

// Channel classes
export class Channel extends PublicEflrObject {
  static readonly LONG_NAME = 'LONG-NAME';
  static readonly PROPERTIES = 'PROPERTIES';
  static readonly REPRESENTATION_CODE = 'REPRESENTATION-CODE';
  static readonly UNITS = 'UNITS';
  static readonly DIMENSION = 'DIMENSION';
  static readonly AXIS = 'AXIS';
  static readonly ELEMENT_LIMIT = 'ELEMENT-LIMIT';
  static readonly SOURCE = 'SOURCE';
}

export class ChannelEFLR extends PublicEFLR {}

// Frame classes
export class Path extends PublicEflrObject {
  static readonly FRAME_TYPE = 'FRAME-TYPE';
  static readonly WELL_REFERENCE_POINT = 'WELL-REFERENCE-POINT';
  static readonly VALUE = 'VALUE';
  static readonly BOREHOLE_DEPTH = 'BOREHOLE-DEPTH';
  static readonly VERTICAL_DEPTH = 'VERTICAL-DEPTH';
  static readonly RADIAL_DRIFT = 'RADIAL-DRIFT';
  static readonly ANGULAR_DRIFT = 'ANGULAR-DRIFT';
  static readonly TIME = 'TIME';
  static readonly DEPTH_OFFSET = 'DEPTH-OFFSET';
  static readonly MEASURE_POINT_OFFSET = 'MEASURE-POINT-OFFSET';
  static readonly TOOL_ZERO_OFFSET = 'TOOL-ZERO-OFFSET';
}

export class Frame extends PublicEflrObject {
  static readonly DESCRIPTION = 'DESCRIPTION';
  static readonly INDEX_MIN = 'INDEX-MIN';
  static readonly INDEX_MAX = 'INDEX-MAX';
  static readonly ENCRYPTED = 'ENCRYPTED';
  static readonly SPACING = 'SPACING';
  static readonly INDEX_TYPE = 'INDEX-TYPE';
  static readonly CHANNELS = 'CHANNELS';
}

export class FrameEFLR extends PublicEFLR {}

// Static EFLR classes
export class Zone extends PublicEflrObject {
  static readonly DESCRIPTION = 'DESCRIPTION';
  static readonly DOMAIN = 'DOMAIN';
  static readonly MAXIMUM = 'MAXIMUM';
  static readonly MINIMUM = 'MINIMUM';
}

export class Parameter extends PublicEflrObject {
  static readonly LONG_NAME = 'LONG-NAME';
  static readonly DIMENSION = 'DIMENSION';
  static readonly AXIS = 'AXIS';
  static readonly ZONES = 'VALUES';
  static readonly VALUES = 'VALUES';
}

export class Equipment extends PublicEflrObject {
  static readonly TRADEMARK_NAME = 'TRADEMARK-NAME';
  static readonly STATUS = 'STATUS';
  static readonly TYPE = 'TYPE';
  static readonly SERIAL_NUMBER = 'SERIAL-NUMBER';
  static readonly LOCATION = 'LOCATION';
  static readonly HEIGHT = 'HEIGHT';
  static readonly LENGTH = 'LENGTH';
  static readonly MINIMUM_DIAMETER = 'MINIMUM-DIAMETER';
  static readonly MAXIMUM_DIAMETER = 'MAXIMUM-DIAMETER';
  static readonly VOLUME = 'VOLUME';
  static readonly WEIGHT = 'WEIGHT';
  static readonly HOLE_SIZE = 'HOLE-SIZE';
  static readonly PRESSURE = 'PRESSURE';
  static readonly TEMPERATURE = 'TEMPERATURE';
  static readonly VERTICAL_DEPTH = 'VERTICAL-DEPTH';
  static readonly RADIAL_DRIFT = 'RADIAL-DRIFT';
  static readonly ANGULAR_DRIFT = 'ANGULAR-DRIFT';
}

export class Tool extends PublicEflrObject {
  static readonly DESCRIPTION = 'DESCRIPTION';
  static readonly TRADEMARK_NAME = 'TRADEMARK-NAME';
  static readonly GENERIC_NAME = 'GENERIC-NAME';
  static readonly PARTS = 'PARTS';
  static readonly STATUS = 'STATUS';
  static readonly CHANNELS = 'CHANNELS';
  static readonly PARAMETERS = 'PARAMETERS';
}

export class Process extends PublicEflrObject {
  static readonly DESCRIPTION = 'DESCRIPTION';
  static readonly TRADEMARK_NAME = 'TRADEMARK-NAME';
  static readonly VERSION = 'VERSION';
  static readonly PROPERTIES = 'PROPERTIES';
  static readonly STATUS = 'STATUS';
  static readonly INPUT_CHANNELS = 'INPUT-CHANNELS';
  static readonly OUTPUT_CHANNELS = 'OUTPUT-CHANNELS';
  static readonly INPUT_COMPUTATIONS = 'INPUT-COMPUTATIONS';
  static readonly OUTPUT_COMPUTATIONS = 'OUTPUT-COMPUTATIONS';
  static readonly PARAMETERS = 'PARAMETERS';
  static readonly COMMENTS = 'COMMENTS';
}

export class Computation extends PublicEflrObject {
  static readonly DESCRIPTION = 'DESCRIPTION';
  static readonly PROPERTIES = 'PROPERTIES';
  static readonly DIMENSION = 'DIMENSION';
  static readonly AXIS = 'AXIS';
  static readonly ZONES = 'ZONES';
  static readonly VALUES = 'VALUES';
  static readonly SOURCE = 'SOURCE';
}

export class CalibrationMeasurement extends PublicEflrObject {
  static readonly PHASE = 'PHASE';
  static readonly MEASUREMENT_SOURCE = 'MEASUREMENT-SOURCE';
  static readonly TYPE = 'TYPE';
  static readonly DIMENSION = 'DIMENSION';
  static readonly AXIS = 'AXIS';
  static readonly MEASUREMENT = 'MEASUREMENT';
  static readonly SAMPLE_COUNT = 'SAMPLE-COUNT';
  static readonly MAXIMUM_DEVIATION = 'MAXIMUM-DEVIATION';
  static readonly STANDARD_DEVIATION = 'STANDARD-DEVIATION';
  static readonly BEGIN_TIME = 'BEGIN-TIME';
  static readonly DURATION = 'DURATION';
  static readonly REFERENCE = 'REFERENCE';
  static readonly STA = 'STA';
  static readonly PLUS_TOLERANCE = 'PLUS-TOLERANCE';
  static readonly MINUS_TOLERANCE = 'MINUS-TOLERANCE';
}

export class CalibrationCoefficient extends PublicEflrObject {
  static readonly LABEL = 'LABEL';
  static readonly COEFFICIENTS = 'COEFFICIENTS';
  static readonly REFERENCES = 'REFERENCES';
  static readonly PLUS_TOLERANCE = 'PLUS-TOLERANCE';
  static readonly MINUS_TOLERANCE = 'MINUS-TOLERANCE';
}

export class Calibration extends PublicEflrObject {
  static readonly CALIBRATED_CHANNELS = 'CALIBRATED-CHANNELS';
  static readonly UNCALIBRATED_CHANNELS = 'UNCALIBRATED-CHANNELS';
  static readonly COEFFICIENTS = 'COEFFICIENTS';
  static readonly MEASUREMENT = 'MEASUREMENT';
  static readonly PARAMETERS = 'PARAMETERS';
  static readonly METHOD = 'METHOD';
}

export class Group extends PublicEflrObject {
  static readonly DESCRIPTION = 'DESCRIPTION';
  static readonly OBJECT_TYPE = 'OBJECT-TYPE';
  static readonly OBJECT_LIST = 'OBJECT-LIST';
  static readonly GROUP_LIST = 'GROUP-LIST';
}

export class Splice extends PublicEflrObject {
  static readonly OUTPUT_CHANNELS = 'OUTPUT-CHANNELS';
  static readonly INPUT_CHANNELS = 'INPUT-CHANNELS';
  static readonly ZONES = 'ZONES';
}

export class StaticEFLR extends PublicEFLR {
  static readonly SET_TYPES = new Set([
    'CALIBRATION', 'CALIBRATION-COEFFICIENT', 'CALIBRATION-MEASUREMENT', 
    'COMPUTATION', 'EQUIPMENT', 'GROUP', 'PARAMETER', 'PROCESS', 
    'SPICE', 'TOOL', 'ZONE'
  ]);

  static getInstance(set: SetComponent): StaticEFLR {
    if (set.type && StaticEFLR.SET_TYPES.has(set.type)) {
      const objectClassMap: { [key: string]: any } = {
        'Zone': Zone,
        'Parameter': Parameter,
        'Equipment': Equipment,
        'Tool': Tool,
        'Process': Process,
        'Computation': Computation,
        'CalibrationMeasurement': CalibrationMeasurement,
        'CalibrationCoefficient': CalibrationCoefficient,
        'Calibration': Calibration,
        'Group': Group,
        'Splice': Splice
      };
      
      const className = getClassName(set.type);
      const objectClass = objectClassMap[className];
      
      if (objectClass) {
        const objects = set.objects.map(obj => new objectClass(obj));
        return new StaticEFLR(set.name, set.type, set.template, objects);
      }
    }
    
    return new StaticEFLR(set.name, set.type, set.template, set.objects);
  }
}

// Other EFLR classes
export class Comment extends PublicEflrObject {}
export class ScriptEFLR extends PublicEFLR {}

export class Update extends PublicEflrObject {}
export class UpdateEFLR extends PublicEFLR {}

export class NoFormat extends PublicEflrObject {
  static readonly CONSUMER_NAME = 'CONSUMER-NAME';
  static readonly DESCRIPTION = 'DESCRIPTION';
}
export class UdiEFLR extends PublicEFLR {}

export class LongName extends PublicEflrObject {
  static readonly GENERAL_MODIFIER = 'GENERAL-MODIFIER';
  static readonly QUANTITY = 'QUANTITY';
  static readonly QUANTITY_MODIFIER = 'QUANTITY-MODIFIER';
  static readonly ALTERED_FORM = 'ALTERED-FORM';
  static readonly ENTITY = 'ENTITY';
  static readonly ENTITY_MODIFIER = 'ENTITY-MODIFIER';
  static readonly ENTITY_NUMBER = 'ENTITY-NUMBER';
  static readonly ENTITY_PART = 'ENTITY-PART';
  static readonly ENTITY_PART_NUMBER = 'ENTITY-PART-NUMBER';
  static readonly GENERIC_SOURCE = 'GENERIC-SOURCE';
  static readonly SOURCE_PART = 'SOURCE-PART';
  static readonly SOURCE_PART_NUMBER = 'SOURCE-PART-NUMBER';
  static readonly CONDITIONS = 'CONDITIONS';
  static readonly STANDARD_SYMBOL = 'STANDARD-SYMBOL';
  static readonly PRIVATE_SYMBOL = 'PRIVATE-SYMBOL';
}
export class LNameEFLR extends PublicEFLR {}
export class LongNameEFLR extends PublicEFLR {}

export class SpecObject extends PublicEflrObject {}
export class SpecEFLR extends PublicEFLR {}

export class DictObject extends PublicEflrObject {}
export class DictEFLR extends PublicEFLR {}

// ==================== IFLR CLASSES ====================

export class FrameData {
  public slots: any[] = [];

  constructor(public frameNumber: number) {}
}

export class UnformattedDataLR extends IFLR {
  constructor(public noformatObject: any, public data: Uint8Array) {
    super();
  }
}

export class EoD extends IFLR {
  constructor(private _frameTypeRef: ObName, private _lrType: number | null) {
    super();
  }

  get frameTypeRef(): ObName {
    return this._frameTypeRef;
  }

  get lrType(): number | null {
    return this._lrType;
  }
}

// ==================== PRIVATE EFLR CLASSES ====================

export class PrivateEFLR extends EFLR {}

export class PrivateEncryptedEFLR extends PrivateEFLR {
  constructor(public producerCode: number) {
    super(null, null, null, []);
  }
}

export class PrivateIFLR extends IFLR {}

// ==================== PARSING FUNCTIONS ====================

function nextRole(bStream: BinaryReader): ComponentRole {
  const currPos = bStream.tell();
  const desc = readUSHORT(bStream).toString(2).padStart(8, '0');
  const role = COMPONENT_ROLE_MAP[desc.slice(0, 3)] || ComponentRole.OBJECT;
  bStream.seek(currPos);
  return role;
}

export function parseObjects(bStream: BinaryReader, template: Template): ObjectComponent[] {
  const eof = endPos(bStream);
  const objs: ObjectComponent[] = [];
  
  while (bStream.tell() < eof) {
    const obj = parseObject(bStream, template);
    logger.debug(obj.toString());
    objs.push(obj);
  }
  
  return objs;
}

export function parseObject(bStream: BinaryReader, template: Template): ObjectComponent {
  const eof = endPos(bStream);
  const desc = readUSHORT(bStream).toString(2).padStart(8, '0');
  const role = COMPONENT_ROLE_MAP[desc.slice(0, 3)];
  
  if (role === ComponentRole.OBJECT) {
    logger.debug('parsing object');
    const obj = new ObjectComponent();
    obj.name = readOBNAME(bStream);
    
    let i = 0;
    while (bStream.tell() < eof && nextRole(bStream) !== ComponentRole.OBJECT) {
      let attr: Attribute;
      
      if (i < template.attrList.length) {
        const attrRef = template.attrList[i]!;
        attr = parseAttrInObj(bStream, attrRef);
      } else {
        attr = parseAttrInObjWithoutRef(bStream);
      }
      
      if (attr instanceof AbsentAttribute) {
        logger.debug('get absentAttr');
      }
      
      obj.attributes.push(attr);
      i++;
    }
    
    return obj;
  } else {
    throw new Error('Only object is allowed');
  }
}

export function parseTemplate(bStream: BinaryReader): Template {
  const template = new Template();
  const eof = endPos(bStream);
  
  while (true) {
    const currPos = bStream.tell();
    if (currPos < eof) {
      const desc = readUSHORT(bStream).toString(2).padStart(8, '0');
      bStream.seek(currPos);
      
      if (COMPONENT_ROLE_MAP[desc.slice(0, 3)] === ComponentRole.OBJECT) {
        return template;
      } else {
        const hasLabel = parseInt(desc[3]!, 10) === 1;
        if (!hasLabel) {
          throw new Error('All components in Template must have label');
        }
        template.attrList.push(parseAttributeInTemplate(bStream));
      }
    } else {
      logger.warn('Encounter a Set without Objects');
      break;
    }
  }
  
  return template;
}

function parseAttrInObj(bStream: BinaryReader, attrRef: Attribute): Attribute {
  const desc = readUSHORT(bStream).toString(2).padStart(8, '0');
  const role = COMPONENT_ROLE_MAP[desc.slice(0, 3)];
  
  let attr: Attribute;
  
  if (role === ComponentRole.ATTRIB) {
    attr = new Attribute();
    attrRef.clone(attr);
  } else if (role === ComponentRole.INVATR) {
    attr = new InvariantAttribute();
    attrRef.clone(attr);
  } else if (role === ComponentRole.ABSATER) {
    return new AbsentAttribute(attrRef);
  } else {
    throw new Error('Only attribute is allowed');
  }
  
  if (parseInt(desc[3]!, 10)) { // label
    attr.label = readIDENT(bStream);
  }
  if (parseInt(desc[4]!, 10)) { // count
    attr.count = readUVARI(bStream);
  }
  if (parseInt(desc[5]!, 10)) { // representation code
    attr.repCode = readUSHORT(bStream);
  }
  if (parseInt(desc[6]!, 10)) { // units
    attr.units = readUNITS(bStream);
  }
  if (parseInt(desc[7]!, 10)) { // value
    if (attr.count > 1) {
      attr.value = Array.from({ length: attr.count }, () => readByRC(attr.repCode, bStream));
    } else {
      attr.value = readByRC(attr.repCode, bStream);
    }
  }
  
  return attr;
}

function parseAttrInObjWithoutRef(bStream: BinaryReader): Attribute {
  const desc = readUSHORT(bStream).toString(2).padStart(8, '0');
  const role = COMPONENT_ROLE_MAP[desc.slice(0, 3)];
  
  let attr: Attribute;
  
  if (role === ComponentRole.ATTRIB) {
    attr = new Attribute();
  } else if (role === ComponentRole.INVATR) {
    attr = new InvariantAttribute();
  } else if (role === ComponentRole.ABSATER) {
    return new AbsentAttribute();
  } else {
    throw new Error('Only attribute is allowed');
  }
  
  if (parseInt(desc[3]!, 10)) { // label
    attr.label = readIDENT(bStream);
  }
  if (parseInt(desc[4]!, 10)) { // count
    attr.count = readUVARI(bStream);
  }
  if (parseInt(desc[5]!, 10)) { // representation code
    attr.repCode = readUSHORT(bStream);
  }
  if (parseInt(desc[6]!, 10)) { // units
    attr.units = readUNITS(bStream);
  }
  if (parseInt(desc[7]!, 10)) { // value
    if (attr.count > 1) {
      attr.value = Array.from({ length: attr.count }, () => readByRC(attr.repCode, bStream));
    } else {
      attr.value = readByRC(attr.repCode, bStream);
    }
  }
  
  return attr;
}

function parseAttributeInTemplate(bStream: BinaryReader): Attribute {
  const desc = readUSHORT(bStream).toString(2).padStart(8, '0');
  const role = COMPONENT_ROLE_MAP[desc.slice(0, 3)];
  
  let attr: Attribute;
  
  if (role === ComponentRole.ATTRIB) {
    attr = new Attribute();
  } else if (role === ComponentRole.INVATR) {
    attr = new InvariantAttribute();
  } else if (role === ComponentRole.ABSATER) {
    return new AbsentAttribute();
  } else {
    throw new Error('Only attribute is allowed');
  }
  
  if (parseInt(desc[3]!, 10)) { // label
    attr.label = readIDENT(bStream);
  }
  if (parseInt(desc[4]!, 10)) { // count
    attr.count = readUVARI(bStream);
  }
  if (parseInt(desc[5]!, 10)) { // representation code
    attr.repCode = readUSHORT(bStream);
  }
  if (parseInt(desc[6]!, 10)) { // units
    attr.units = readUNITS(bStream);
  }
  if (parseInt(desc[7]!, 10)) { // value
    if (attr.count > 1) {
      (attr as any)._channelValue = Array.from({ length: attr.count }, () => readByRC(attr.repCode, bStream));
    } else {
      (attr as any)._channelValue = readByRC(attr.repCode, bStream);
    }
  }
  
  return attr;
}

export function parseSet(bStream: BinaryReader): SetComponent {
  const desc = readUSHORT(bStream).toString(2).padStart(8, '0');
  const role = COMPONENT_ROLE_MAP[desc.slice(0, 3)];
  
  let mySet: SetComponent;
  
  if (role === ComponentRole.SET) {
    mySet = new SetComponent();
  } else if (role === ComponentRole.RDSET) {
    mySet = new RedundantSet();
  } else if (role === ComponentRole.RSET) {
    mySet = new ReplacementSet();
  } else {
    throw new Error('Only set is allowed');
  }
  
  const hasType = parseInt(desc[3]!, 10) === 1;
  if (!hasType) {
    throw new Error('Set must have type');
  }
  mySet.type = readIDENT(bStream);
  
  if (parseInt(desc[4]!, 10)) { // has name
    mySet.name = readIDENT(bStream);
  }
  
  mySet.template = parseTemplate(bStream);
  mySet.objects = parseObjects(bStream, mySet.template);
  
  return mySet;
}
