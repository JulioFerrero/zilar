// A formatted number: optional sign and currency symbol, digits with `.`/`,`/spaces, then an optional `%`,
// a degree sign or a short unit. It matches `8`, `-0.66%`, `$81,719.29`, `300 ml` and `18°`, but not `1 pinch` or `Girona`.
const NUMBER = /^[+-]?[^\d\s+-]?\s*\d[\d.,\s]*(?:%|°[A-Za-z]?|[A-Za-z]{1,4})?$/;

function isNumericCell(cell: string): boolean {
  return NUMBER.test(cell.trim());
}

export function numericColumns(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): boolean[] {
  return columns.map((_, column) => {
    const cells = rows.map((row) => row[column] ?? '').filter((cell) => cell.trim() !== '');
    return cells.length > 0 && cells.every(isNumericCell);
  });
}
