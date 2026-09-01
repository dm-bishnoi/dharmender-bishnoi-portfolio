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
 * Behavior:
 *  - On section entry: dots progressively assemble from left → right
 *    with per-dot randomized delay so the reveal feels organic.
 *  - After assembly: an extremely subtle horizontal pulse glides through
 *    a small column of dots (no constant flash) keeping the headline
 *    alive when the user is still.
 *  - prefers-reduced-motion: full headline visible immediately, no pulse.
 */
@Component({
  selector: 'app-dotted-text',
  standalone: true,
  template: `
    <div class="dotted-wrap" #wrap>
      <canvas
        #cv
        class="dotted-canvas"
        [attr.aria-label]="text"
        role="img">
      </canvas>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      position: relative;
    }
    .dotted-wrap {
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
  @Input() accentColor: string = '#7eb1ff';
  @Input() glowColor: string = 'rgba(86, 156, 255, 0.0)';
  @Input() sweep = true;           // idle ambient pulse
  @Input() aspectRatio: number | null = null;
  @Input() revealDuration = 1400;  // ms for full dot reveal
  @Input() revealDelay = 0;        // ms before reveal starts

  @ViewChild('cv', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('wrap', { static: true }) wrapRef!: ElementRef<HTMLDivElement>;
  @HostBinding('style.--dotted-aspect') aspect = '0.36';

  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private ngZone = inject(NgZone);
  private ro?: ResizeObserver;
  private rafId: number | null = null;
  private prefersReducedMotion = false;
  private motionListener = (e: MediaQueryListEvent) => {
    this.prefersReducedMotion = e.matches;
    if (this.prefersReducedMotion) {
      this.revealStart = performance.now() - this.revealDuration - 1; // already complete
    }
  };
  private visibilityObserver: IntersectionObserver | null = null;
  private hasTriggered = false;

  // Animation state
  private revealStart: number | null = null;
  private pulseX = -0.18;
  private pulseDir = 1;

  // Cached dot grid (computed once per size/text)
  private cachedDots: { x: number; y: number; center: number }[] | null = null;
  private cachedKey = '';

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.motionListener = (e: MediaQueryListEvent) => { this.prefersReducedMotion = e.matches; };
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', this.motionListener);

    const cv = this.canvasRef.nativeElement;
    this.ro = new ResizeObserver(() => {
      this.cachedDots = null; // force re-rasterize
      this.scheduleRender();
    });
    this.ro.observe(cv);
    this.scheduleRender();

    if (!this.prefersReducedMotion) {
      this.setupVisibilityObserver();
      this.ngZone.runOutsideAngular(() => this.startLoop());
    } else {
      // Reduced motion: show full headline immediately.
      this.revealStart = performance.now() - this.revealDuration - 1;
      this.scheduleRender();
    }
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.cachedDots = null;
    if (this.canvasRef) this.scheduleRender();
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.isBrowser) {
      window.matchMedia('(prefers-reduced-motion: reduce)').removeEventListener('change', this.motionListener);
      this.visibilityObserver?.disconnect();
    }
  }

  private setupVisibilityObserver(): void {
    const wrap = this.wrapRef.nativeElement;
    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !this.hasTriggered) {
            this.hasTriggered = true;
            this.revealStart = performance.now() + this.revealDelay;
            this.visibilityObserver?.disconnect();
            this.visibilityObserver = null;
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -10% 0px' }
    );
    this.visibilityObserver.observe(wrap);
  }

  private startLoop(): void {
    let last = performance.now();
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;

      // Pulse: gentle drift back-and-forth across canvas (a slow 8s cycle)
      this.pulseX += (0.00018 * dt) * this.pulseDir;
      if (this.pulseX > 1.18) { this.pulseX = 1.18; this.pulseDir = -1; }
      if (this.pulseX < -0.18) { this.pulseX = -0.18; this.pulseDir = 1; }

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

  private getRevealProgress(): number {
    if (this.prefersReducedMotion) return 1;
    if (this.revealStart === null) return 0;
    const now = performance.now();
    if (now < this.revealStart) return 0;
    const t = (now - this.revealStart) / this.revealDuration;
    return Math.max(0, Math.min(1, t));
  }

  private draw(): void {
    if (!this.isBrowser) return;
    const cv = this.canvasRef.nativeElement;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const cssWidth = cv.clientWidth;
    if (cssWidth === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(cssWidth * dpr);
    const aspect = this.computeAspect();
    const h = Math.floor(w * aspect);

    if (cv.width !== w) cv.width = w;
    cv.style.aspectRatio = `${cssWidth} / ${cssWidth * aspect}`;
    if (cv.height !== h) cv.height = h;

    ctx.clearRect(0, 0, w, h);
    ctx.save();

    // Cache key includes dimensions + text to avoid re-rasterizing every frame
    const key = `${w}x${h}|${this.text}`;
    if (!this.cachedDots || this.cachedKey !== key) {
      this.cachedDots = this.rasterizeDots(w, h);
      this.cachedKey = key;
    }
    const dots = this.cachedDots;
    if (!dots || dots.length === 0) { ctx.restore(); return; }

    const r = this.dotRadius * dpr;
    const progress = this.getRevealProgress();
    const pulseActive = this.sweep && !this.prefersReducedMotion && progress >= 1;
    const pulseWidth = w * 0.14;
    const pulseCenter = this.pulseX * w;
    const pulseColor = this.accentColor;

    // Reveal: each dot has a "center" value (0..1 across width).
    // Reveal when progress * 1.4 > center (gives slight overlap for organic feel).
    const threshold = progress * 1.35;

    // Pre-pass: which dots are revealed?
    // First paint all base dots
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      if (d.center > threshold) continue; // not yet revealed

      // ease-out for the individual dot's fade-in
      const local = 1 - Math.max(0, (threshold - d.center) / 0.35);
      const eased = local * local * (3 - 2 * local); // smoothstep
      this.paintDot(ctx, d.x, d.y, r, this.color, eased);
    }

    // Second pass: subtle ambient pulse highlight (only after reveal complete)
    if (pulseActive) {
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const dist = Math.abs(d.x - pulseCenter);
        if (dist > pulseWidth) continue;
        const t = 1 - dist / pulseWidth;
        const alpha = Math.pow(t, 1.8) * 0.5;
        this.paintDot(ctx, d.x, d.y, r * 1.04, pulseColor, alpha);
      }
    }

    ctx.restore();
  }

  private rasterizeDots(w: number, h: number): { x: number; y: number; center: number }[] {
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d', { willReadFrequently: true });
    if (!octx) return [];

    const fontStack = '"Space Grotesk", "Inter", system-ui, sans-serif';
    const fontSize = Math.floor(h * 0.78);
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, w, h);
    octx.fillStyle = '#fff';
    octx.textBaseline = 'middle';
    octx.textAlign = 'left';
    octx.font = `700 ${fontSize}px ${fontStack}`;
    const metrics = octx.measureText(this.text);
    const textW = metrics.width;
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
    const dprValue = Math.min(window.devicePixelRatio || 1, 2);
    const ps = Math.max(3, Math.floor(this.pixelSize * dprValue));

    const dots: { x: number; y: number; center: number }[] = [];
    for (let y = 0; y < h; y += ps) {
      for (let x = 0; x < w; x += ps) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] < 0.45 * 255) continue;
        let filled = false;
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
        dots.push({ x, y, center: x / w });
      }
    }
    return dots;
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
    const len = this.text.length || 1;
    const ratio = 0.95 / (len * 0.62);
    return Math.max(0.14, Math.min(0.95, ratio));
  }
}
