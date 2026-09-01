import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface DotPoint { x: number; y: number; }

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.css',
})
export class ProjectsComponent {
  // generate background dot grid: 14 columns x 10 rows for the larger visual
  readonly dotRows = Array.from({ length: 10 });
  readonly dotCols = Array.from({ length: 14 });

  // Stylized capital "A" composed of dots inside a 600x360 viewBox.
  // Centered around (300, 180), height ~150, width ~150.
  readonly letterA: ReadonlyArray<DotPoint> = this.buildLetterA();

  private buildLetterA(): DotPoint[] {
    const pts: DotPoint[] = [];
    const step = 10; // dot spacing
    // A is two diagonal strokes + a horizontal crossbar
    // Left diagonal: from (220, 240) up to (300, 100)
    // Right diagonal: from (380, 240) up to (300, 100)
    // Crossbar at y=190 between left and right
    // We'll "draw" with points near these lines.
    const A = (x: number, y: number) => { pts.push({ x, y }); };

    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      // left diagonal
      const lx = 220 + (300 - 220) * t;
      const ly = 240 + (100 - 240) * t;
      A(lx, ly);
      // right diagonal
      const rx = 380 - (380 - 300) * t;
      const ry = 240 + (100 - 240) * t;
      A(rx, ry);
    }
    // Crossbar
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = 248 + (352 - 248) * t;
      A(x, 195);
    }
    // small thickness — second row of dots next to each leg
    for (let i = 0; i <= 14; i += 1) {
      const t = i / 14;
      const lx = 220 + (300 - 220) * t;
      const ly = 240 + (100 - 240) * t;
      // shift perpendicular slightly
      const px = -((ly - 100) / Math.hypot(80, 140)) * 10;
      const py = ((lx - 220) / Math.hypot(80, 140)) * 10;
      A(lx + px, ly + py);
      const rx = 380 - (380 - 300) * t;
      const ry = 240 + (100 - 240) * t;
      const qx = ((ry - 100) / Math.hypot(80, 140)) * 10;
      const qy = ((rx - 380) / Math.hypot(80, 140)) * 10;
      A(rx + qx, ry + qy);
    }

    return pts;
  }
}
