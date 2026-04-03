/**
 * .wflow JSON schema helpers.
 * A workflow file contains: { version, nodes[], wires[] }
 */

let _id = 0;
function uid() { return `${Date.now()}_${_id++}`; }

/**
 * Create a new node instance.
 * @param {string} typeId   — node type id (e.g. 'Vclay')
 * @param {{x,y}} pos       — canvas position
 * @param {object} paramOverrides — optional initial param values
 */
export function createNode(typeId, pos = { x: 100, y: 100 }, paramOverrides = {}) {
  return {
    id:     `n_${uid()}`,
    type:   typeId,
    pos:    { ...pos },
    params: { ...paramOverrides },
  };
}

/**
 * Create a wire between two ports.
 * @param {string} fromNodeId
 * @param {string} fromPort   — output port key
 * @param {string} toNodeId
 * @param {string} toPort     — input port key
 */
export function createWire(fromNodeId, fromPort, toNodeId, toPort) {
  return {
    id:   `w_${uid()}`,
    from: [fromNodeId, fromPort],
    to:   [toNodeId,   toPort],
  };
}

/** Parse a .wflow JSON string. Throws on invalid format. */
export function parseWorkflow(text) {
  const obj = JSON.parse(text);
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.wires)) {
    throw new Error('Invalid .wflow format: missing nodes or wires arrays.');
  }
  return obj;
}

/** Serialise the workflow to a JSON string. */
export function serialiseWorkflow(nodes, wires) {
  return JSON.stringify({ version: '1.0', nodes, wires }, null, 2);
}

/** Remove a node and all wires connected to it. */
export function deleteNode(nodes, wires, nodeId) {
  return {
    nodes: nodes.filter(n => n.id !== nodeId),
    wires: wires.filter(w => w.from[0] !== nodeId && w.to[0] !== nodeId),
  };
}

/** Check if adding a wire would create a cycle (simple DFS). */
export function wouldCycle(nodes, wires, fromNodeId, toNodeId) {
  // Build adjacency
  const adj = new Map(nodes.map(n => [n.id, []]));
  for (const w of wires) adj.get(w.from[0])?.push(w.to[0]);
  // Temporarily add the proposed edge
  adj.get(fromNodeId)?.push(toNodeId);
  // DFS from toNodeId — if we reach fromNodeId, it's a cycle
  const visited = new Set();
  const stack = [toNodeId];
  while (stack.length) {
    const id = stack.pop();
    if (id === fromNodeId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of (adj.get(id) ?? [])) stack.push(next);
  }
  return false;
}
