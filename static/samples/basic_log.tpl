{
  "title": "Basic Well Log",
  "depth": {
    "min": 0,
    "max": 5000,
    "visibleMin": 1200,
    "visibleMax": 3500,
    "unit": "m"
  },
  "indexCurve": { "curveMnemonic": "DEPT" },
  "panels": [
    {
      "id": "P1",
      "title": "GR / CALI",
      "width": 120,
      "xMin": 0,
      "xMax": 150,
      "gridType": "linear",
      "numGridLines": 5,
      "color": "#ffffff"
    },
    {
      "id": "P2",
      "title": "Resistivity",
      "width": 130,
      "xMin": 0.1,
      "xMax": 1000,
      "gridType": "logarithmic",
      "color": "#fffdf5"
    },
    {
      "id": "P3",
      "title": "Density / Neutron",
      "width": 140,
      "xMin": 1.65,
      "xMax": 2.85,
      "gridType": "linear",
      "numGridLines": 6,
      "color": "#f8fff8"
    }
  ],
  "curveDefinitions": [
    {
      "id": "C1",
      "trackId": "P1",
      "curveMnemonic": "GR",
      "fileSlot": "F1",
      "color": "#22c55e",
      "line": { "thickness": 1.2, "style": "solid" }
    },
    {
      "id": "C2",
      "trackId": "P1",
      "curveMnemonic": "CALI",
      "fileSlot": "F1",
      "color": "#a3a3a3",
      "line": { "thickness": 0.8, "style": "dashed" }
    },
    {
      "id": "C3",
      "trackId": "P2",
      "curveMnemonic": "RT_HRLT",
      "fileSlot": "F1",
      "color": "#3b82f6",
      "line": { "thickness": 1.4, "style": "solid" }
    },
    {
      "id": "C4",
      "trackId": "P2",
      "curveMnemonic": "RXO",
      "fileSlot": "F1",
      "color": "#93c5fd",
      "line": { "thickness": 0.9, "style": "dashed" }
    },
    {
      "id": "C5",
      "trackId": "P3",
      "curveMnemonic": "RHOB",
      "fileSlot": "F1",
      "color": "#ef4444",
      "line": { "thickness": 1.4, "style": "solid" }
    },
    {
      "id": "C6",
      "trackId": "P3",
      "curveMnemonic": "NPHI",
      "fileSlot": "F1",
      "color": "#8b5cf6",
      "line": { "thickness": 1.4, "style": "dashed" }
    },
    {
      "id": "C7",
      "trackId": "P3",
      "curveMnemonic": "DRHO",
      "fileSlot": "F1",
      "color": "#f97316",
      "line": { "thickness": 0.8, "style": "dotted" }
    }
  ],
  "fileSlots": {
    "F1": null
  }
}
