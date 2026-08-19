/**
 * Which card lands in which cell of the torus.
 *
 * A modular stride is the obvious answer and it is wrong: any pair of strides
 * has some small combination that sums to zero, and that combination is
 * exactly where a duplicate appears. Ours put an identical card on every
 * diagonal neighbour, which is the single most visible artefact a repeating
 * grid can have.
 *
 * This is a greedy graph colouring instead. Each cell looks at its six
 * neighbours on the staggered grid, bans every card they already hold, and
 * then takes the least-used card that remains — with a tiebreak that also
 * pushes second-ring repeats away. No adjacency ever repeats, and usage stays
 * even across the set.
 */

/**
 * The six neighbours of a cell on a brick-staggered torus. Odd rows are
 * shifted half a cell, so their diagonal neighbours sit on the other side.
 */
function neighboursOf(col: number, row: number, cols: number, rows: number): number[] {
  const left = (col + cols - 1) % cols;
  const right = (col + 1) % cols;
  const up = (row + rows - 1) % rows;
  const down = (row + 1) % rows;
  const pairs: Array<[number, number]> =
    row % 2 === 0
      ? [[left, row], [right, row], [left, up], [col, up], [left, down], [col, down]]
      : [[left, row], [right, row], [col, up], [right, up], [col, down], [right, down]];

  const self = row * cols + col;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const [c, r] of pairs) {
    const idx = r * cols + c;
    if (idx === self || seen.has(idx)) continue;
    seen.add(idx);
    out.push(idx);
  }
  return out;
}

export function assignCards(cols: number, rows: number, count: number): Int32Array {
  const total = cols * rows;
  const neighbours: number[][] = new Array(total);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      neighbours[row * cols + col] = neighboursOf(col, row, cols, rows);
    }
  }

  const assigned = new Int32Array(total).fill(-1);
  const usage = new Int32Array(count);

  for (let cell = 0; cell < total; cell++) {
    const banned = new Set<number>();
    const nearby = new Set<number>();
    for (const n of neighbours[cell]) {
      const direct = assigned[n];
      if (direct >= 0) banned.add(direct);
      for (const nn of neighbours[n]) {
        const second = assigned[nn];
        if (second >= 0) nearby.add(second);
      }
    }

    let best = -1;
    let bestScore = Infinity;
    for (let card = 0; card < count; card++) {
      if (banned.has(card)) continue;
      /* Usage dominates by an order of magnitude; the second-ring penalty
         only breaks ties between equally-used cards. */
      const score = usage[card] * 10 + (nearby.has(card) ? 1 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = card;
      }
    }
    /* Only reachable with fewer than seven cards, where the ban set can cover
       everything. Falling back keeps the grid drawn rather than empty. */
    if (best < 0) best = cell % count;

    assigned[cell] = best;
    usage[best]++;
  }
  return assigned;
}
