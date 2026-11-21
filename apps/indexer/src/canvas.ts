/** A raw RGBA buffer to draw cards on the pixel grid (no fonts involved: text is cells from the pixel font). */
export type RGB = readonly [number, number, number];

export class Canvas {
  readonly buf: Buffer;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.buf = Buffer.alloc(width * height * 4);
  }
  fill(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) {
        const i = (yy * this.width + xx) * 4;
        this.buf[i] = c[0];
        this.buf[i + 1] = c[1];
        this.buf[i + 2] = c[2];
        this.buf[i + 3] = 255;
      }
    }
  }
  cells(cells: boolean[][], x: number, y: number, cell: number, c: RGB, gap = 0): void {
    cells.forEach((row, cy) =>
      row.forEach((on, cx) => {
        if (on) this.fill(x + cx * cell + gap, y + cy * cell + gap, cell - gap * 2, cell - gap * 2, c);
      }),
    );
  }
  /** Paper with the site's background grid. */
  grid(step: number, paper: RGB, line: RGB): void {
    this.fill(0, 0, this.width, this.height, paper);
    for (let x = 0; x < this.width; x += step) this.fill(x, 0, 1, this.height, line);
    for (let y = 0; y < this.height; y += step) this.fill(0, y, this.width, 1, line);
  }
}
