/**
 * Workflow DAG execution engine.
 *
 * execute(nodes, wires, slotData) → Map<nodeId, outputs>
 *
 * Where:
 *   nodes    — array of node instances { id, type, params, ... }
 *   wires    — array of { id, from:[nodeId,portKey], to:[nodeId,portKey] }
 *   slotData — Map<slotKey, { depths:Float64Array, curves:Map<mnemonic,Float64Array> }>
 *   NODE_TYPES — imported from nodes/registry.js
 */

import { NODE_TYPES } from './nodes/registry.js';

/** Topological sort using Kahn's algorithm. Returns sorted node ids. */
function topoSort(nodes, wires) {
  const nodeIds = nodes.map(n => n.id);
  const inDegree = new Map(nodeIds.map(id => [id, 0]));
  const adjList  = new Map(nodeIds.map(id => [id, []]));

  for (const w of wires) {
    const [fromId] = w.from;
    const [toId]   = w.to;
    if (!adjList.has(fromId) || !inDegree.has(toId)) continue;
    adjList.get(fromId).push(toId);
    inDegree.set(toId, (inDegree.get(toId) ?? 0) + 1);
  }

  const queue  = nodeIds.filter(id => (inDegree.get(id) ?? 0) === 0);
  const sorted = [];
  while (queue.length) {
    const id = queue.shift();
    sorted.push(id);
    for (const next of (adjList.get(id) ?? [])) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('Workflow graph has a cycle — cannot execute.');
  }
  return sorted;
}

/**
 * Execute all nodes in topological order.
 *
 * @returns Map<nodeId, Record<portKey, any>>  — resolved outputs per node
 * @returns also a Map<nodeId, string>         — errors per node (if any)
 */
export function execute(nodes, wires, slotData) {
  const results = new Map();  // nodeId → { portKey → value }
  const errors  = new Map();  // nodeId → error message

  let order;
  try {
    order = topoSort(nodes, wires);
  } catch (e) {
    return { results, errors: new Map([['__graph__', e.message]]) };
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId);
    const def  = NODE_TYPES[node.type];
    if (!def) {
      errors.set(nodeId, `Unknown node type "${node.type}"`);
      continue;
    }

    // Gather resolved inputs from upstream nodes
    const inputs = {};
    for (const w of wires) {
      const [toId, toPort] = w.to;
      if (toId !== nodeId) continue;
      const [fromId, fromPort] = w.from;
      const upstream = results.get(fromId);
      if (upstream) inputs[toPort] = upstream[fromPort];
    }

    // Call compute
    try {
      const outputs = def.compute(inputs, node.params ?? {}, slotData);
      results.set(nodeId, outputs);
    } catch (e) {
      errors.set(nodeId, e.message);
      results.set(nodeId, {});
    }
  }

  return { results, errors };
}
