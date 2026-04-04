# CLAUDE.md — WorkflowApp (.wflow)

Node-graph petrophysics pipeline editor. Users wire together processing nodes to compute curves (Vclay, Sw, etc.) and display results as well-log tracks.

---

## File Structure

```
workflow/
├── WorkflowApp.svelte    # Root component; toolbar + NodePalette + NodeCanvas
├── format.js             # parseWorkflow / serialiseWorkflow (JSON ↔ graph)
├── engine.js             # execute(nodes, wires, slotData) → { results, errors }
├── components/
│   ├── NodeCanvas.svelte # Infinite pan/zoom canvas; renders NodeBox + Wire
│   ├── NodeBox.svelte    # Individual node card with ports
│   ├── NodePalette.svelte# Drag-from palette of available node types
│   ├── Wire.svelte       # SVG bezier connection between ports
│   └── PortDot.svelte    # Input/output port hit target
└── nodes/
    ├── registry.js       # NODE_TYPES map: typeId → node definition
    └── types/            # One file per node type (see below)
```

---

## Node Definitions (`nodes/registry.js`)

Each entry in `NODE_TYPES` defines:
```js
{
  label: string,           // display name
  inputs: [{ key, label }],
  outputs: [{ key, label }],
  params: [{ key, label, type, default }],
  compute(inputs, params): outputs,
}
```

| Type ID | Node | Description |
|---------|------|-------------|
| `CurveSource` | Curve Source | Reads a depth-aligned curve from an assigned file slot |
| `Constant` | Constant | Emits a fixed scalar value |
| `Arithmetic` | Arithmetic | Binary operation (+, −, ×, ÷) on two inputs |
| `DepthFilter` | Depth Filter | Masks data to a min/max depth range |
| `IGR` | IGR | Gamma-ray index (GR − GRmin) / (GRmax − GRmin) |
| `Vclay` | Vclay | Larionov / linear clay volume from IGR |
| `SwArchie` | Sw Archie | Water saturation via Archie equation |
| `SwSimandoux` | Sw Simandoux | Simandoux Sw for shaly sands |
| `SwIndonesian` | Sw Indonesian | Indonesian equation Sw |
| `TrackDisplay` | Track Display | Renders output curve as a well-log track panel |

---

## Data Flow

1. `CurveSource` nodes reference a slot label (e.g. `F1`) resolved from `slotData` — a `Map` populated when users assign open LAS/DLIS tabs to slots.
2. `engine.js` topologically sorts nodes, executes each `compute()`, and propagates `Float64Array` curve data along wires.
3. `TrackDisplay` output is collected and rendered as depth-aligned panels.

---

## Save / Dirty

- **Dirty** tracked via `$derived(serialiseWorkflow(nodes, wires) !== _loadedJson)`
- **Save** (`tab.handle` present) → `saveToHandle`; otherwise → `downloadBlob`
- **Download** always available from toolbar
- **Ctrl/Cmd+S** keyboard shortcut

---

## Adding a Node Type

1. Create `nodes/types/MyNode.js` exporting a definition object matching the shape above
2. Import and register it in `nodes/registry.js`
3. The palette and engine pick it up automatically
