import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
} from '@angular/core';

/**
 * Static laptop fallback — drawn on a <canvas> directly from TypeScript.
 * Bypasses Angular's template compiler to avoid ICU parsing issues with SVG
 * curly-brace entities. Used when:
 *   - `prefers-reduced-motion: reduce` is set, OR
 *   - WebGL is unavailable / failed to initialize.
 */
@Component({
  selector: 'app-hero-visual-fallback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas class="laptop-fallback-canvas" aria-hidden="true"></canvas>`,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    .laptop-fallback-canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `],
})
export class HeroVisualFallbackComponent implements AfterViewInit {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    // Size the canvas to the element's physical size.
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    this.drawLaptop(ctx, rect.width, rect.height);
  }

  private drawLaptop(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    // Scale everything to fit the canvas while preserving aspect ratio.
    const scale = Math.min(W / 640, H / 460);
    ctx.save();
    ctx.translate((W - 640 * scale) / 2, (H - 460 * scale) / 2);
    ctx.scale(scale, scale);

    const COLORS = {
      bg: '#1e1e1e', sidebar: '#252526', activity: '#333333',
      text: '#d4d4d4', muted: '#858585', white: '#ffffff',
      red: '#ff5f57', yellow: '#febc2e', green: '#28c840',
      keyword: '#c586c0', className: '#4ec9b0', fn: '#dcdcaa',
      string: '#ce9178', comment: '#6a9955', attr: '#9cdcfe',
      status: '#007acc',
    };

    // ── Background ───────────────────────────────────────
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, 640, 460);

    // ── Soft glow under laptop ──────────────────────────
    const glow = ctx.createRadialGradient(320, 370, 20, 320, 370, 220);
    glow.addColorStop(0, 'rgba(126,177,255,0.25)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 640, 460);

    // ── Screen bezel ────────────────────────────────────
    ctx.fillStyle = '#1a1a1a';
    this.roundRect(ctx, 120, 48, 400, 260, 12);
    ctx.fill();

    // Inner screen
    ctx.fillStyle = COLORS.bg;
    this.roundRect(ctx, 138, 64, 364, 226, 6);
    ctx.fill();

    // Clip to screen area
    ctx.save();
    ctx.beginPath();
    this.roundRect(ctx, 138, 64, 364, 226, 6);
    ctx.clip();

    // Activity bar
    ctx.fillStyle = COLORS.activity;
    ctx.fillRect(138, 64, 48, 226);

    // Sidebar
    ctx.fillStyle = COLORS.sidebar;
    ctx.fillRect(186, 64, 72, 226);

    // Sidebar text
    ctx.fillStyle = COLORS.muted;
    ctx.font = '600 9px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('EXPLORER', 196, 74);

    ctx.fillStyle = COLORS.text;
    ctx.font = '600 10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText('▾ src', 196, 90);

    ctx.font = '10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(' ▾ app', 196 + 8, 104);
    ctx.fillText(' ▸ shared', 196 + 8, 118);
    ctx.fillText(' ▸ core', 196 + 8, 132);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '600 10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText('▸ package.json', 196, 150);
    ctx.fillText('▸ angular.json', 196, 164);

    // Tab
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(258, 64, 110, 22);
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText('hero.component.ts', 264, 71);

    // Breadcrumb
    ctx.fillStyle = COLORS.muted;
    ctx.font = '8px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText('src › app › hero', 264, 98);

    // Code editor body
    const line = (y: number, parts: Array<{ text: string; color: string }>) => {
      let x = 264;
      for (const p of parts) {
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, x, y);
        x += ctx.measureText(p.text).width;
      }
    };

    const mono = '10.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.font = mono;
    line(122, [
      { text: 'import', color: COLORS.keyword },
      { text: ' { ', color: COLORS.text },
      { text: 'Component', color: COLORS.className },
      { text: ' } ', color: COLORS.text },
      { text: 'from', color: COLORS.keyword },
      { text: " '@angular/core';", color: COLORS.string },
    ]);
    line(140, [
      { text: 'import', color: COLORS.keyword },
      { text: ' { ', color: COLORS.text },
      { text: 'BehaviorSubject', color: COLORS.className },
      { text: ' } ', color: COLORS.text },
      { text: 'from', color: COLORS.keyword },
      { text: " 'rxjs';", color: COLORS.string },
    ]);
    ctx.fillStyle = COLORS.comment;
    ctx.fillText('// build cinematic interfaces', 264, 158);

    line(176, [
      { text: '@', color: COLORS.fn },
      { text: 'Component', color: COLORS.className },
      { text: '({', color: COLORS.text },
    ]);
    line(194, [
      { text: '  selector', color: COLORS.attr },
      { text: ": 'app-hero',", color: COLORS.text },
    ]);
    line(212, [
      { text: '  template', color: COLORS.attr },
      { text: ": '…',", color: COLORS.text },
    ]);
    line(230, [
      { text: '})', color: COLORS.text },
    ]);
    line(248, [
      { text: 'export class', color: COLORS.keyword },
      { text: ' HeroComponent {', color: COLORS.text },
    ]);
    line(266, [
      { text: '  title$', color: COLORS.attr },
      { text: ' = ', color: COLORS.text },
      { text: 'new', color: COLORS.keyword },
      { text: ' BehaviorSubject', color: COLORS.className },
      { text: "('…');", color: COLORS.text },
    ]);

    // Caret
    ctx.fillStyle = '#569cd6';
    ctx.fillRect(400, 176, 2, 13);

    // Status bar
    ctx.fillStyle = COLORS.status;
    ctx.fillRect(138, 270, 364, 20);
    ctx.fillStyle = COLORS.white;
    ctx.font = '9px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('⎇ main   TypeScript   UTF-8', 148, 281);

    ctx.restore(); // end clip

    // ── Hinge ─────────────────────────────────────────────
    ctx.fillStyle = '#1a1a1a';
    this.roundRect(ctx, 115, 304, 410, 6, 2);
    ctx.fill();

    // ── Base body ─────────────────────────────────────────
    ctx.fillStyle = '#c8c8cc';
    ctx.beginPath();
    ctx.moveTo(110, 308);
    ctx.lineTo(530, 308);
    ctx.lineTo(580, 348);
    ctx.lineTo(60, 348);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#9a9a9e';
    ctx.beginPath();
    ctx.moveTo(60, 348);
    ctx.lineTo(580, 348);
    ctx.lineTo(568, 366);
    ctx.lineTo(72, 366);
    ctx.closePath();
    ctx.fill();

    // Keyboard rows
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.5;
    [320, 328, 336].forEach(y => {
      ctx.beginPath();
      ctx.moveTo(120, y);
      ctx.lineTo(520, y);
      ctx.stroke();
    });

    // Trackpad
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    this.roundRect(ctx, 240, 338, 160, 6, 1);
    ctx.fill();

    // Camera notch
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.arc(320, 52, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** Draw a rounded rectangle path (cross-browser friendly). */
  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
