// T-1793: the table's alignment rule shared by the web and phone renderers. A
// table's text column ("Team") must stay left-aligned while the number columns
// ("P", "GD", "Pts") are right-aligned, mono and tabular, so both apps read the
// same cells and reach the same answer.

// A formatted number: an optional sign and currency symbol, digits with `.`, `,`
// or spaces, then an optional `%`, a degree sign with up to one letter, or a
// short unit of up to four letters. It matches `8`, `-0.66%`, `$81,719.29`,
// `+1 234`, `300 ml`, `18°`, `21 °C` and `-3°F`, but not `1 pinch`, `Girona` or
// an empty cell.
const NUMBER = /^[+-]?[^\d\s+-]?\s*\d[\d.,\s]*(?:%|°[A-Za-z]?|[A-Za-z]{1,4})?$/;

function isNumericCell(cell: string): boolean {
  return NUMBER.test(cell.trim());
}

/**
 * Marks each column that holds formatted numbers only. Empty cells are ignored,
 * so a blank total cell does not break a column; a column with no filled cell at
 * all is text. The result has one entry per column.
 */
export function numericColumns(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): boolean[] {
  return columns.map((_, column) => {
    const cells = rows.map((row) => row[column] ?? '').filter((cell) => cell.trim() !== '');
    return cells.length > 0 && cells.every(isNumericCell);
  });
}
