// Court geometry. Pure functions, no screen code, no randomness, no clock.
//
// Coordinates are in "cell units": x runs 0..2 across the court, y runs 0..6
// up the court. y = 0 is the near edge (where players stand to throw).
//
// Numbering is a U-shape: 1..6 go up the left column, 7..12 come down the
// right column. Square 1 is bottom-left, 6 is top-left, 7 is top-right and
// 12 is bottom-right.

export const COLS = 2;
export const ROWS = 6;
export const SQUARES = COLS * ROWS;

// Half the width of a chalk line, in cell units.
export const LINE_HALF = 0.04;

// Where a player stands before the first throw (outside the court, below square 1).
export const START_POINT = Object.freeze({ x: 0.5, y: -0.9 });

export function isSquare(n) {
  return Number.isInteger(n) && n >= 1 && n <= SQUARES;
}

export function squareToCell(n) {
  if (!isSquare(n)) throw new RangeError(`not a square: ${n}`);
  return n <= ROWS ? { col: 0, row: n - 1 } : { col: 1, row: SQUARES - n };
}

export function cellToSquare(col, row) {
  if (col === 0) return row + 1;
  if (col === 1) return SQUARES - row;
  throw new RangeError(`not a column: ${col}`);
}

export function squareRect(n) {
  const { col, row } = squareToCell(n);
  return { x: col, y: row, w: 1, h: 1 };
}

export function squareCenter(n) {
  const r = squareRect(n);
  return { x: r.x + 0.5, y: r.y + 0.5 };
}

// Which square is a point in, and is it on a chalk line?
// Outside the court: { square: null, onLine: false }.
export function locate(x, y) {
  if (x < 0 || x > COLS || y < 0 || y > ROWS) return { square: null, onLine: false };
  const nearLine = (v, max) => {
    for (let i = 0; i <= max; i++) if (Math.abs(v - i) <= LINE_HALF) return true;
    return false;
  };
  const onLine = nearLine(x, COLS) || nearLine(y, ROWS);
  const col = Math.min(COLS - 1, Math.floor(x));
  const row = Math.min(ROWS - 1, Math.floor(y));
  return { square: cellToSquare(col, row), onLine };
}

// A stone (a disc of the given radius) counts as "in" a square only when it
// lies completely inside the square, clear of every chalk line around it.
// Returns the square number, or null for a miss or a line touch.
export function stoneSquare(x, y, radius) {
  const col = Math.floor(x);
  const row = Math.floor(y);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  const margin = radius + LINE_HALF;
  const inside =
    x - margin >= col && x + margin <= col + 1 && y - margin >= row && y + margin <= row + 1;
  return inside ? cellToSquare(col, row) : null;
}
