/**
 * Node type registry — maps type id → node definition.
 * Import NODE_TYPES anywhere to look up a node's ports, params, and compute fn.
 */

import CurveSource    from './types/CurveSource.js';
import Constant       from './types/Constant.js';
import DepthFilter    from './types/DepthFilter.js';
import IGR            from './types/IGR.js';
import Vclay          from './types/Vclay.js';
import Arithmetic     from './types/Arithmetic.js';
import SwArchie       from './types/SwArchie.js';
import SwSimandoux    from './types/SwSimandoux.js';
import SwIndonesian   from './types/SwIndonesian.js';
import TrackDisplay   from './types/TrackDisplay.js';

export const NODE_TYPES = {};

for (const def of [
  CurveSource,
  Constant,
  DepthFilter,
  IGR,
  Vclay,
  Arithmetic,
  SwArchie,
  SwSimandoux,
  SwIndonesian,
  TrackDisplay,
]) {
  NODE_TYPES[def.id] = def;
}

/** Grouped for the palette sidebar */
export const NODE_CATEGORIES = [
  {
    id: 'source',
    label: 'Sources',
    nodes: ['CurveSource', 'Constant'],
  },
  {
    id: 'filter',
    label: 'Filters',
    nodes: ['DepthFilter'],
  },
  {
    id: 'transform',
    label: 'Transforms',
    nodes: ['IGR', 'Vclay', 'Arithmetic'],
  },
  {
    id: 'compute',
    label: 'Saturation',
    nodes: ['SwArchie', 'SwSimandoux', 'SwIndonesian'],
  },
  {
    id: 'output',
    label: 'Output',
    nodes: ['TrackDisplay'],
  },
];
