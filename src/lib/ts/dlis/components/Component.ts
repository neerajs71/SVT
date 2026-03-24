/**
 * Component classes - Port of Python Component.py
 * Represents the fundamental components in RP66: Set, Object, Attribute, Template
 */

import type { JsonAble } from '../common/types';
import { ComponentRole } from '../common/types';
import { ObName } from '../readers/RCReader';

/**
 * Base Component class
 */
export abstract class Component implements JsonAble {
  toJSON(): any {
    return { ...this };
  }
}

/**
 * Attribute Component
 */
export class Attribute extends Component {
  protected _label: string = '';
  protected _count: number = 1;
  protected _repCode: number = 19; // default IDENT
  protected _units: string = '';
  protected _value: any = null;

  constructor() {
    super();
  }

  get label(): string {
    return this._label;
  }

  set label(value: string) {
    this._label = value;
  }

  get count(): number {
    return this._count;
  }

  set count(value: number) {
    this._count = value;
  }

  get repCode(): number {
    return this._repCode;
  }

  set repCode(value: number) {
    this._repCode = value;
  }

  get units(): string {
    return this._units;
  }

  set units(value: string) {
    this._units = value;
  }

  get value(): any {
    return this._value;
  }

  set value(val: any) {
    this._value = val;
  }

  clone(attr: Attribute): Attribute {
    attr._label = this._label;
    attr._count = this._count;
    attr._repCode = this._repCode;
    attr._units = this._units;
    attr._value = this._value;
    return attr;
  }

  toString(): string {
    return `Attribute[label:${this._label} count:${this._count} repCode:${this._repCode} units:${this._units} value:${this._value}]`;
  }
}

/**
 * Absent Attribute Component
 */
export class AbsentAttribute extends Attribute {
  constructor(attr?: Attribute) {
    super();
    if (attr) {
      this.label = attr.label;
      this.count = attr.count;
      this.repCode = attr.repCode;
      this.units = attr.units;
      this.value = attr.value;
    }
  }
}

/**
 * Invariant Attribute Component
 */
export class InvariantAttribute extends Attribute {
  constructor() {
    super();
  }
}

/**
 * Object Component
 */
export class ObjectComponent extends Component {
  protected _name: ObName | null = null;
  protected _attributes: Attribute[] = [];

  constructor() {
    super();
  }

  get name(): ObName | null {
    return this._name;
  }

  set name(value: ObName | null) {
    this._name = value;
  }

  get attributes(): Attribute[] {
    return this._attributes;
  }

  toString(): string {
    const attrStr = this._attributes.map(attr => `    ${attr.toString()}`).join('\n');
    return `Object[name:${this._name?.toString()} with attributes:\n${attrStr}]`;
  }
}

/**
 * Template Component
 */
export class Template implements JsonAble {
  protected _attrList: Attribute[] = [];

  constructor() {}

  get attrList(): Attribute[] {
    return this._attrList;
  }

  toString(): string {
    const attrListStr = this._attrList.map(attr => `    ${attr.toString()}`).join('\n');
    return `Template with attributes [\n${attrListStr}]`;
  }

  toJSON(): any {
    return {
      attributeList: this._attrList
    };
  }
}

/**
 * Set Component
 */
export class SetComponent extends Component {
  protected _type: string | null = null;
  protected _name: string | null = null;
  public template: Template | null = null;
  public objects: ObjectComponent[] = [];

  constructor() {
    super();
  }

  get type(): string | null {
    return this._type;
  }

  set type(value: string | null) {
    this._type = value;
  }

  get name(): string | null {
    return this._name;
  }

  set name(value: string | null) {
    this._name = value;
  }

  toString(): string {
    return `Set[type:${this._type} name:${this._name} numOfObjects:${this.objects.length}]`;
  }
}

/**
 * Redundant Set Component
 */
export class RedundantSet extends SetComponent {
  constructor() {
    super();
  }
}

/**
 * Replacement Set Component
 */
export class ReplacementSet extends SetComponent {
  constructor() {
    super();
  }
}

// Component Role Constants matching Python implementation
export const COMPONENT_ROLES = {
  ABSATER: 'ABSATER',
  ATTRIB: 'ATTRIB',
  INVATR: 'INVATR',
  OBJECT: 'OBJECT',
  RDSET: 'RDSET',
  RSET: 'RSET',
  SET: 'SET'
} as const;

// Component Role mapping from binary bits
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
