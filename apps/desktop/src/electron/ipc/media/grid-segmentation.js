'use strict';

function normalizeGridSelection({ rows, columns, cells } = {}) {
  const safeRows = Math.max(1, Math.min(8, Math.floor(Number(rows) || 1)));
  const safeColumns = Math.max(1, Math.min(8, Math.floor(Number(columns) || 1)));
  const total = safeRows * safeColumns;
  const requestedCells = Array.from(new Set(
    (Array.isArray(cells) ? cells : [])
      .map(Number)
      .filter(index => Number.isInteger(index) && index >= 0 && index < total),
  )).slice(0, 64);
  return { rows: safeRows, columns: safeColumns, cells: requestedCells };
}

function resolveGridCropCells({ width, height, rows, columns, cells } = {}) {
  const normalized = normalizeGridSelection({ rows, columns, cells });
  return normalized.cells.map(index => {
    const row = Math.floor(index / normalized.columns);
    const column = index % normalized.columns;
    const x0 = Math.round((column * width) / normalized.columns);
    const x1 = Math.round(((column + 1) * width) / normalized.columns);
    const y0 = Math.round((row * height) / normalized.rows);
    const y1 = Math.round(((row + 1) * height) / normalized.rows);
    return {
      index,
      row,
      column,
      x: x0,
      y: y0,
      width: Math.max(1, x1 - x0),
      height: Math.max(1, y1 - y0),
    };
  });
}

module.exports = {
  normalizeGridSelection,
  resolveGridCropCells,
};
