/**
 * Marching squares: iso-line `field == 0` of a scalar field sampled on an
 * n×n grid (row-major, field[j * n + i]). Inside is `field <= 0`.
 * Returns line segments [x1, y1, x2, y2, ...] in grid coordinates (0..n-1).
 */
export function isoSegments(field: Float32Array, n: number): Float32Array {
  const out: number[] = [];
  const lerp = (a: number, b: number) => (a === b ? 0.5 : a / (a - b));

  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const tl = field[j * n + i];
      const tr = field[j * n + i + 1];
      const br = field[(j + 1) * n + i + 1];
      const bl = field[(j + 1) * n + i];
      if (!(Number.isFinite(tl) && Number.isFinite(tr) && Number.isFinite(br) && Number.isFinite(bl))) {
        continue;
      }
      const code = (tl <= 0 ? 8 : 0) | (tr <= 0 ? 4 : 0) | (br <= 0 ? 2 : 0) | (bl <= 0 ? 1 : 0);
      if (code === 0 || code === 15) continue;

      // Edge crossing points.
      const top = (): [number, number] => [i + lerp(tl, tr), j];
      const right = (): [number, number] => [i + 1, j + lerp(tr, br)];
      const bottom = (): [number, number] => [i + lerp(bl, br), j + 1];
      const left = (): [number, number] => [i, j + lerp(tl, bl)];
      const seg = (p: [number, number], q: [number, number]) => out.push(p[0], p[1], q[0], q[1]);

      switch (code) {
        case 1: case 14: seg(left(), bottom()); break;
        case 2: case 13: seg(bottom(), right()); break;
        case 3: case 12: seg(left(), right()); break;
        case 4: case 11: seg(top(), right()); break;
        case 6: case 9: seg(top(), bottom()); break;
        case 7: case 8: seg(left(), top()); break;
        case 5: case 10: {
          // Saddle: disambiguate with the cell centre.
          const centreInside = (tl + tr + br + bl) / 4 <= 0;
          if ((code === 5) === centreInside) {
            seg(left(), top());
            seg(bottom(), right());
          } else {
            seg(left(), bottom());
            seg(top(), right());
          }
          break;
        }
      }
    }
  }
  return new Float32Array(out);
}
