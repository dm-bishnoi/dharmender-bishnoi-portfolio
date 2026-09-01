import {
  AfterViewInit,
  Component,
  ElementRef,
  HostBinding,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  PLATFORM_ID,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Dotted LED-style display headline.
 * Renders the input text onto a high-resolution canvas as a dot matrix.
 * Each "pixel" of the rasterized glyphs becomes a small dot, creating
 * the LED / arrival-board / pixel-display effect seen in the reference.
 *
 * Performance: 2x DPR for retina, throttled to once per animation frame.
 * Idle animation: a very subtle horizontal sweep glides through the
 * dots (cursor-style), keeping the headline alive when the mouse is still.
 */
@Component({
  selector: 'app-dotted-text',
  standalone: true,
  template: `
    <canvas
      #cv
      class="dotted-canvas"
      [attr.aria-label]="text"
      role="img">
    </canvas>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      position: relative;
    }
    .dotted-canvas {
      display: block;
      width: 100%;
      height: auto;
    }
  `],
})
export class DottedTextComponent implements AfterViewInit, OnDestroy, OnChanges {
  @Input({ required: true }) text = '';
  @Input() pixelSize = 6;          // spacing between dot centers (px)
  @Input() dotRadius = 1.6;        // dot radius in CSS px
  @Input() color: string = '#f5f7fb';
  @Input() glowColor: string = 'rgba(86, 156, 255, 0.0)';
  @Input() sweep = true;           // idle cursor-style sweep
  @Input() aspectRatio: number | null = null;  // override aspect; null = compute from text

  @ViewChild('cv', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @HostBinding('style.--dotted-aspect') aspect = '0.36';

  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private ro?: ResizeObserver;
  private rafId: number | null = null;
  private sweepX = -0.2; // -0.2 .. 1.2 across canvas width
  private prefersReducedMotion = false;
  private motionListener = (e: MediaQueryListEvent) => {
    this.prefersReducedMotion = e.matches;
  };
  private ngZone = inject(NgZone);

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.motionListener = (e: MediaQueryListEvent) => { this.prefersReducedMotion = e.matches; };
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', this.motionListener);

    const cv = this.canvasRef.nativeElement;
    this.ro = new ResizeObserver(() => this.scheduleRender());
    this.ro.observe(cv);
    this.scheduleRender();

    if (!this.prefersReducedMotion) {
      this.ngZone.runOutsideAngular(() => this.startSweep());
    }
  }

  ngOnChanges(_changes: SimpleChanges): void {
    if (this.canvasRef) this.scheduleRender();
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.isBrowser) {
      window.matchMedia('(prefers-reduced-motion: reduce)').removeEventListener('change', this.motionListener);
    }
  }

  private startSweep(): void {
    const loop = (ts: number) => {
      this.rafId = requestAnimationFrame(loop);
      // advance sweep position slowly — a full pass every ~7 seconds
      this.sweepX += 0.0024;
      if (this.sweepX > 1.3) this.sweepX = -0.3;
      this.draw();
    };
    this.ngZone.runOutsideAngular(() => {
      this.rafId = requestAnimationFrame(loop);
    });
  }

  private pending = false;
  private scheduleRender(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.draw();
    });
  }

  private draw(): void {
    if (!this.isBrowser) return;
    const cv = this.canvasRef.nativeElement;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const cssWidth = cv.clientWidth;
    if (cssWidth === 0) return;

    // pick pixelSize relative to width so 1 line of text fills well
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(cssWidth * dpr);
    const aspect = this.computeAspect();
    const h = Math.floor(w * aspect);

    if (cv.width !== w) cv.width = w;
    cv.style.aspectRatio = `${cssWidth} / ${cssWidth * aspect}`;
    if (cv.height !== h) cv.height = h;

    // clear
    ctx.clearRect(0, 0, w, h);
    ctx.save();

    // rasterize text to an offscreen canvas, get pixel data
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d', { willReadFrequently: true });
    if (!octx) { ctx.restore(); return; }

    const fontStack = '"Space Grotesk", "Inter", system-ui, sans-serif';
    const fontSize = Math.floor(h * 0.78);
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, w, h);
    octx.fillStyle = '#fff';
    octx.textBaseline = 'middle';
    octx.textAlign = 'left';
    octx.font = `700 ${fontSize}px ${fontStack}`;
    // measure + position: vertically center
    const metrics = octx.measureText(this.text);
    const textW = metrics.width;
    // horizontal scale to fit
    const targetW = w * 0.94;
    const scale = targetW / textW;
    const drawW = textW * scale;
    const x = (w - drawW) / 2;
    octx.save();
    octx.translate(x, h / 2);
    octx.scale(scale, 1);
    octx.fillText(this.text, 0, 0);
    octx.restore();

    const data = octx.getImageData(0, 0, w, h).data;
    const ps = Math.max(3, Math.floor(this.pixelSize * dpr));
    const r = this.dotRadius * dpr;
    const sweepActive = this.sweep && !this.prefersReducedMotion;
    const sweepWidth = w * 0.18;
    const sweepCenter = this.sweepX * w;

    // first pass: base dots
    for (let y = 0; y < h; y += ps) {
      for (let x = 0; x < w; x += ps) {
        const idx = (y * w + x) * 4;
        const a = data[idx + 3] / 255;
        if (a < 0.45) continue;
        // sample a small block of the pixel cluster to decide if dot is "filled"
        let filled = false;
        // check a 3x3 sub-block for performance
        for (let dy = 0; dy < ps; dy += Math.max(1, Math.floor(ps / 2))) {
          for (let dx = 0; dx < ps; dx += Math.max(1, Math.floor(ps / 2))) {
            const px = x + dx;
            const py = y + dy;
            if (px >= w || py >= h) continue;
            const ai = (py * w + px) * 4 + 3;
            if (data[ai] > 130) { filled = true; break; }
          }
          if (filled) break;
        }
        if (!filled) continue;
        this.paintDot(ctx, x, y, r, this.color, 1);
      }
    }

    // second pass: optional blue sweep — paints a tinted ring of dots that are
    // inside the sweep band
    if (sweepActive) {
      for (let y = 0; y < h; y += ps) {
        for (let x = 0; x < w; x += ps) {
          const dist = Math.abs(x - sweepCenter);
          if (dist > sweepWidth) continue;
          const idx = (y * w + x) * 4;
          if (data[idx + 3] < 130) continue;
          const t = 1 - dist / sweepWidth;
          const alpha = Math.pow(t, 1.6) * 0.85;
          this.paintDot(ctx, x, y, r * 1.05, '#7eb1ff', alpha);
        }
      }
    }

    ctx.restore();
  }

  private paintDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
    if (alpha <= 0.02) return;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private computeAspect(): number {
    if (this.aspectRatio !== null) {
      return Math.max(0.14, Math.min(0.95, this.aspectRatio));
    }
    // height/width based on text length — for 10-char word "DHARMENDER" we want
    // a shorter aspect (~0.18) so the dotted line is wide-and-shallow, not blocky.
    const len = this.text.length || 1;
    // height = 0.95em; width = len * 0.62em; ratio = height/width
    const ratio = 0.95 / (len * 0.62);
    return Math.max(0.14, Math.min(0.95, ratio));
  }
}
