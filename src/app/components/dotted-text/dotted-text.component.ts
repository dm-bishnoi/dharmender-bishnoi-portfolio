import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
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
 * Dot-matrix typography.
 *
 * Renders the input text as a true dot-matrix: each letter is drawn on
 * a 5×7 grid of cells where "on" cells become small circles. This gives
 * the typography an LED / arrival-board / digital character while
 * keeping the letterforms instantly readable (not solid bars).
 *
 * Two rendering modes (controlled by `traceColor`):
 *
 * 1. **Two-tier (legacy, default).** `traceColor === ''`. Only "on" cells
 *    render. Each on cell is filled with `color` (white) or, with
 *    probability `accentRatio`, with `accentColor` (electric blue). This
 *    is the existing behavior — unchanged.
 *
 * 2. **Three-tier (hero use).** `traceColor !== ''`. All 35 cells per
 *    character render. A faint `traceColor` dot shows every cell, with
 *    a brighter `activeColor` (or `accentColor` for a few) layered on
 *    top of the "on" cells. Off cells get only a very faint trace dot,
 *    so the letterform is recognizable as a ghost from frame 1, and
 *    brightens as the active tier lights up.
 *
 * Behavior:
 *  - IntersectionObserver triggers the reveal when the component enters
 *    the viewport.
 *  - Reveal sequence: each dot fades in from low → bright with a
 *    stagger. Total duration is `revealDuration`.
 *  - In three-tier mode, the trace tier peaks at 40% of the duration and
 *    the active tier peaks at 80%, so the letterform is legible
 *    throughout.
 *  - After reveal: an extremely subtle ambient pulse (a thin column of
 *    dots temporarily brightens and drifts across the display).
 *  - Mouse interaction: pointer position brightens nearby dots in real
 *    time. The effect is purely visual; the ambient pulse continues
 *    regardless of pointer activity.
 *  - prefers-reduced-motion: full display visible immediately, no
 *    pulse, no mouse interaction.
 *  - SSR-safe: returns a placeholder when not in the browser.
 */
@Component({
  selector: 'app-dotted-text',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dot-wrap" #wrap>
      <svg
        #svg
        class="dot-svg"
        xmlns="http://www.w3.org/2000/svg"
        [attr.viewBox]="viewBox"
        preserveAspectRatio="xMidYMid meet"
        [attr.aria-label]="text"
        role="img">
        <!-- Dots injected imperatively in ngAfterViewInit for performance. -->
      </svg>
      <span class="dot-sr">{{ text }}</span>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; position: relative; }
    .dot-wrap { display: block; width: 100%; position: relative; }
    .dot-svg { display: block; width: 100%; height: auto; overflow: visible; }
    /* Visually hidden accessible label, matches the dotted text. */
    .dot-sr {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `],
})
export class DottedTextComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) text = '';
  /** Width of one dot, in viewBox units. */
  @Input() dotSize = 6;
  /** Gap between dots, in viewBox units. */
  @Input() dotGap = 8;
  /** Color of primary dots (also serves as the active-tier color when `activeColor` is unset). */
  @Input() color: string = '#f3f6fc';
  /** Color of accent dots (electric blue). */
  @Input() accentColor: string = '#7eb1ff';

  // ── Three-tier inputs (optional) ───────────────────────
  /**
   * If non-empty, the component renders the **three-tier** mode: every
   * cell gets a trace dot, every "on" cell additionally gets an active
   * dot on top. If empty (default), the existing 2-tier behavior is
   * preserved.
   */
  @Input() traceColor: string = '';
  /** Color of active dots in three-tier mode. Falls back to `color`. */
  @Input() activeColor: string = '';
  /** Peak opacity for the trace tier on "on" cells (0..1). */
  @Input() traceOpacity: number = 0.35;

  // ── Animation inputs ─────────────────────────────────
  /** ms before reveal starts. */
  @Input() revealDelay = 0;
  /** ms for full dot reveal. */
  @Input() revealDuration = 1400;
  /** ms between each character joining the reveal. */
  @Input() charStagger = 70;
  /** ms between each word joining the reveal. */
  @Input() wordStagger = 220;
  /** ms between each dot within a character joining the reveal. */
  @Input() intraCharStagger = 18;
  /** Ambient pulse on after reveal. */
  @Input() ambient = true;
  /** Pointer interaction on/off. */
  @Input() interactive = true;
  /** Probability (0-1) that any single dot is an accent dot. */
  @Input() accentRatio = 0.18;
  /** Density of the mouse interaction (0-1). */
  @Input() pointerRadius = 70;

  @ViewChild('svg', { static: true }) svgRef!: ElementRef<SVGSVGElement>;
  @ViewChild('wrap', { static: true }) wrapRef!: ElementRef<HTMLDivElement>;

  /** Computed viewBox attribute. Set after layout. */
  viewBox = '0 0 100 40';

  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private ngZone = inject(NgZone);

  // Animation state.
  private revealStart: number | null = null;
  private reducedMotion = false;
  private motionListener?: (e: MediaQueryListEvent) => void;
  private motionQuery: MediaQueryList | null = null;
  private visibilityObserver: IntersectionObserver | null = null;
  private hasTriggered = false;
  private rafId: number | null = null;
  private resizeObserver?: ResizeObserver;

  // Mouse state.
  private mouseX = -9999;
  private mouseY = -9999;
  private pointerHandler = (e: PointerEvent) => this.onPointerMove(e);

  // All circles. Each entry references a circle and its grid metadata.
  // In three-tier mode, each entry may refer to a trace + an active dot
  // (or to a single circle in 2-tier mode).
  private circles: Array<{
    /** "on" cell: render the letterform. "off" cell: structural ghost (3-tier only). */
    isOn: boolean;
    /** Index of the character this dot belongs to (0..total chars-1). */
    charIndex: number;
    /** Index of the word this dot belongs to (0..total words-1). */
    wordIndex: number;
    /** Index of the cell within the character. */
    cellIndex: number;
    /** Whether this dot is an accent dot (uses accentColor). */
    isAccent: boolean;
    /** The trace-tier circle (3-tier only). null in 2-tier mode. */
    trace: SVGCircleElement | null;
    /** The active-tier circle. Always present. */
    active: SVGCircleElement;
  }> = [];

  /** Geometry of the current layout, in viewBox units. */
  private gridW = 0;       // total width of dot grid
  private gridH = 0;       // total height of dot grid
  private cell = 14;       // dot diameter + gap (px in viewBox units)
  /** Whether the three-tier rendering path is active. */
  private isThreeTier = false;
  /** Resolved active color (falls back to `color`). */
  private resolvedActiveColor = '';

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motionQuery = motionQuery;
    this.reducedMotion = motionQuery.matches;
    this.motionListener = (e: MediaQueryListEvent) => {
      this.reducedMotion = e.matches;
      this.applyReducedMotion();
    };
    motionQuery.addEventListener('change', this.motionListener);

    this.buildGrid();

    if (this.reducedMotion) {
      this.revealStart = performance.now() - this.revealDuration - 1;
      this.renderFrame();
    } else {
      this.setupVisibilityObserver();
      this.ngZone.runOutsideAngular(() => this.startLoop());
    }

    this.resizeObserver = new ResizeObserver(() => {
      // The viewBox is fixed, so size changes don't require rebuilding.
      // We re-apply the ambient pulse to ensure crispness on devicePixelRatio
      // changes (e.g. dragging between monitors).
      this.renderFrame();
    });
    this.resizeObserver.observe(this.wrapRef.nativeElement);

    if (this.interactive && !this.reducedMotion) {
      this.wrapRef.nativeElement.addEventListener('pointermove', this.pointerHandler, { passive: true });
      this.wrapRef.nativeElement.addEventListener('pointerleave', this.pointerHandler, { passive: true });
    }
  }

  ngOnChanges(_changes: SimpleChanges): void {
    if (this.svgRef) {
      this.buildGrid();
      this.renderFrame();
    }
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    if (this.motionListener && this.motionQuery) {
      this.motionQuery.removeEventListener('change', this.motionListener);
    }
    this.visibilityObserver?.disconnect();
    if (this.wrapRef?.nativeElement) {
      this.wrapRef.nativeElement.removeEventListener('pointermove', this.pointerHandler);
      this.wrapRef.nativeElement.removeEventListener('pointerleave', this.pointerHandler);
    }
  }

  // Re-build the dot grid from the input text.
  private buildGrid(): void {
    const svg = this.svgRef.nativeElement;
    // Clear existing children (we keep the SVG itself).
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    this.circles = [];

    // Determine rendering mode.
    this.isThreeTier = !!this.traceColor;
    this.resolvedActiveColor = this.activeColor || this.color;

    // Geometry: each cell holds one dot, dot sits centered in cell.
    this.cell = this.dotSize + this.dotGap;
    const charW = 5;                  // 5 columns per character
    const charH = 7;                  // 7 rows per character
    const charSpacing = 2;            // empty cells between characters
    const wordSpacing = 4;            // extra empty cells between words

    const words = this.text.toUpperCase().split(' ').filter(Boolean);
    if (words.length === 0) return;

    // Compute total width.
    const wordWidths = words.map(w => w.length * (charW + charSpacing) - charSpacing);
    const totalCols =
      wordWidths.reduce((a, b) => a + b, 0) + (words.length - 1) * wordSpacing;
    const totalRows = charH;

    this.gridW = totalCols * this.cell;
    this.gridH = totalRows * this.cell;
    const padX = this.cell * 1.5;
    const padY = this.cell * 1.5;
    const viewW = this.gridW + padX * 2;
    const viewH = this.gridH + padY * 2;
    this.viewBox = `0 0 ${viewW} ${viewH}`;

    // Build the circles.
    const ns = 'http://www.w3.org/2000/svg';
    let cursorX = padX;
    let charIndex = 0;
    let wordIndex = 0;

    for (let wi = 0; wi < words.length; wi++) {
      const word = words[wi];
      for (let ci = 0; ci < word.length; ci++) {
        const ch = word[ci];
        const glyph = FONT_5x7[ch] || FONT_5x7[' '];
        // Per-character stable accent pattern (so it doesn't flicker across renders).
        const accentSeed = (charIndex * 7 + 3) % 13;
        let cellCounter = 0;
        for (let row = 0; row < charH; row++) {
          for (let col = 0; col < charW; col++) {
            const on = (glyph[row] >> (charW - 1 - col)) & 1;
            const cx = cursorX + col * this.cell + this.cell / 2;
            const cy = padY + row * this.cell + this.cell / 2;

            // 2-tier mode: only render "on" cells.
            if (!this.isThreeTier) {
              if (!on) {
                cellCounter++;
                continue;
              }
              const accent = (((cellCounter * 31 + accentSeed) % 100) / 100) < this.accentRatio;
              const baseColor = accent ? this.accentColor : this.color;
              const circle = document.createElementNS(ns, 'circle');
              circle.setAttribute('cx', String(cx));
              circle.setAttribute('cy', String(cy));
              circle.setAttribute('r', String(this.dotSize / 2));
              circle.setAttribute('fill', baseColor);
              circle.setAttribute('opacity', '0');
              svg.appendChild(circle);
              this.circles.push({
                isOn: true,
                charIndex,
                wordIndex,
                cellIndex: cellCounter,
                isAccent: accent,
                trace: null,
                active: circle,
              });
              cellCounter++;
              continue;
            }

            // 3-tier mode: render every cell with a trace dot; on cells
            // additionally get an active dot on top.
            const accent = (((cellCounter * 31 + accentSeed) % 100) / 100) < this.accentRatio;

            // Trace dot (every cell).
            const trace = document.createElementNS(ns, 'circle');
            trace.setAttribute('cx', String(cx));
            trace.setAttribute('cy', String(cy));
            trace.setAttribute('r', String(this.dotSize / 2));
            trace.setAttribute('fill', this.traceColor);
            trace.setAttribute('opacity', '0');
            svg.appendChild(trace);

            // Active dot (on cells only).
            let active: SVGCircleElement;
            if (on) {
              const activeColor = accent ? this.accentColor : this.resolvedActiveColor;
              active = document.createElementNS(ns, 'circle');
              active.setAttribute('cx', String(cx));
              active.setAttribute('cy', String(cy));
              active.setAttribute('r', String(this.dotSize / 2));
              active.setAttribute('fill', activeColor);
              active.setAttribute('opacity', '0');
              svg.appendChild(active);
            } else {
              // Off cells get a sentinel active element (never visible
              // — keeps the entry shape uniform). We won't touch it in
              // renderFrame.
              active = trace;
            }

            this.circles.push({
              isOn: !!on, // coerce bitwise result (0|1) to boolean
              charIndex,
              wordIndex,
              cellIndex: cellCounter,
              isAccent: accent,
              trace,
              active,
            });
            cellCounter++;
          }
        }
        cursorX += (charW + charSpacing) * this.cell;
        charIndex++;
      }
      cursorX += wordSpacing * this.cell;
      wordIndex++;
    }
  }

  private setupVisibilityObserver(): void {
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
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );
    this.visibilityObserver.observe(this.wrapRef.nativeElement);
  }

  private applyReducedMotion(): void {
    if (this.reducedMotion) {
      this.revealStart = performance.now() - this.revealDuration - 1;
      this.renderFrame();
    }
  }

  private startLoop(): void {
    let last = performance.now();
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;
      this.tick(dt, now);
    };
    this.ngZone.runOutsideAngular(() => {
      this.rafId = requestAnimationFrame(loop);
    });
  }

  private tick(_dt: number, now: number): void {
    if (this.circles.length === 0) return;
    this.renderFrame();
  }

  private renderFrame(): void {
    if (this.circles.length === 0) return;
    const now = performance.now();
    const progress = this.computeRevealProgress(now);

    // SVG bbox for pointer math.
    const svg = this.svgRef.nativeElement;
    const rect = svg.getBoundingClientRect();
    // viewBox → screen scaling
    const viewBox = (svg.getAttribute('viewBox') || '').split(' ').map(Number);
    const viewW = viewBox[2] || this.gridW;
    const viewH = viewBox[3] || this.gridH;
    const scaleX = rect.width / viewW;
    const scaleY = rect.height / viewH;
    const padX = (viewW - this.gridW) / 2;
    const padY = (viewH - this.gridH) / 2;

    // Pulse parameters (only used after reveal completes, when ambient is enabled).
    const pulseActive = this.ambient && !this.reducedMotion && progress >= 1;
    const pulsePeriodMs = 5200; // one full drift
    const pulsePhase = (now / pulsePeriodMs) % 1;
    const pulseCenterX = padX + pulsePhase * this.gridW;
    const pulseWidth = this.gridW * 0.18;
    const pulseAlpha = 0.55;
    const pulseRadius = pulseWidth;

    // Convert pointer to viewBox coords.
    let mouseVX = -9999;
    let mouseVY = -9999;
    if (this.interactive && !this.reducedMotion && this.mouseX > -9000) {
      mouseVX = (this.mouseX - rect.left) / scaleX;
      mouseVY = (this.mouseY - rect.top) / scaleY;
    }

    for (let i = 0; i < this.circles.length; i++) {
      const c = this.circles[i];
      const cxc = parseFloat(c.active.getAttribute('cx') || '0');
      const cyc = parseFloat(c.active.getAttribute('cy') || '0');

      // Per-dot reveal start time, based on position in the sequence.
      const startFraction =
        (c.charIndex * this.charStagger +
          c.wordIndex * this.wordStagger +
          c.cellIndex * this.intraCharStagger) /
        this.revealDuration;

      // Compute eased reveal for both tiers.
      // Trace: peaks at 40% of the per-dot reveal window.
      // Active: peaks at 80% of the per-dot reveal window (starts after
      // 30% so it overlaps with the trace tail).
      let traceLocal: number;
      let activeLocal: number;
      const t = (progress - startFraction);
      if (this.isThreeTier) {
        const tT = t / 0.40;
        traceLocal = Math.max(0, Math.min(1, tT));
        const tA = (t - 0.30) / 0.50;
        activeLocal = Math.max(0, Math.min(1, tA));
      } else {
        // Legacy 2-tier: each dot fades in over 35% of duration.
        const tL = t / 0.35;
        traceLocal = 0;
        activeLocal = Math.max(0, Math.min(1, tL));
      }
      const traceEased = traceLocal * traceLocal * (3 - 2 * traceLocal);
      const activeEased = activeLocal * activeLocal * (3 - 2 * activeLocal);

      // Peak trace opacity depends on cell type: on cells get full
      // traceOpacity; off cells get a much fainter ghost dot.
      const tracePeak = c.isOn ? this.traceOpacity : 0.08;
      const traceOpacity = traceEased * tracePeak;

      // Build final active opacity.
      let activeOpacity = activeEased;
      if (progress >= 1) {
        // Subtle ambient pulse (a thin column of dots brightens).
        const dx = cxc - pulseCenterX;
        const dist = Math.abs(dx);
        if (pulseActive && dist < pulseRadius) {
          const t01 = 1 - dist / pulseRadius;
          const boost = Math.pow(t01, 1.6) * pulseAlpha;
          activeOpacity = Math.min(1, activeEased + boost);
        }
        // Pointer brightening.
        if (this.interactive && mouseVX > -9000) {
          const pdx = cxc - mouseVX;
          const pdy = cyc - mouseVY;
          const pd = Math.sqrt(pdx * pdx + pdy * pdy);
          const reach = (this.pointerRadius / scaleX);
          if (pd < reach) {
            const t01 = 1 - pd / reach;
            const boost = Math.pow(t01, 1.4) * 0.5;
            activeOpacity = Math.min(1, activeOpacity + boost);
          }
        }
      }

      // Slightly enlarge active dot on full reveal.
      const r = parseFloat(c.active.getAttribute('r') || '0');
      const baseR = this.dotSize / 2;
      const newR = baseR + (progress >= 1 ? activeOpacity * 0.4 : 0);
      if (Math.abs(newR - r) > 0.01) c.active.setAttribute('r', String(newR));

      // Write active opacity (in 2-tier mode, c.active is the only dot).
      if (this.isThreeTier && !c.isOn) {
        // Off cell: only the trace dot is visible. Active is the trace
        // sentinel — skip to avoid double-writing.
        if (Math.abs(traceOpacity - (parseFloat(c.trace!.getAttribute('opacity') || '0'))) > 0.005) {
          c.trace!.setAttribute('opacity', String(traceOpacity));
        }
        continue;
      }
      if (this.isThreeTier) {
        // On cell: write both trace and active.
        if (Math.abs(traceOpacity - (parseFloat(c.trace!.getAttribute('opacity') || '0'))) > 0.005) {
          c.trace!.setAttribute('opacity', String(traceOpacity));
        }
      }
      if (Math.abs(activeOpacity - (parseFloat(c.active.getAttribute('opacity') || '0'))) > 0.005) {
        c.active.setAttribute('opacity', String(activeOpacity));
      }
    }
  }

  private computeRevealProgress(now: number): number {
    if (this.reducedMotion) return 1;
    if (this.revealStart === null) return 0;
    if (now < this.revealStart) return 0;
    return Math.max(0, Math.min(1, (now - this.revealStart) / this.revealDuration));
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.type === 'pointerleave') {
      this.mouseX = -9999;
      this.mouseY = -9999;
    } else {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    this.renderFrame();
  }
}

/**
 * 5x7 dot-matrix font. Each row is a 5-bit number, MSB is the leftmost column.
 * Only uppercase A-Z, 0-9, hyphen, and a single space are defined; anything
 * unknown renders as a blank character.
 */
const FONT_5x7: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  'A': [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  'B': [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  'C': [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  'D': [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  'E': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  'F': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  'G': [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  'H': [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  'I': [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  'J': [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  'K': [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  'L': [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  'M': [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  'N': [0b10001, 0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001],
  'O': [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  'P': [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  'Q': [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  'R': [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  'S': [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  'T': [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  'U': [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  'V': [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  'W': [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  'X': [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  'Y': [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  'Z': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
  ',': [0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b00100, 0b01000],
  '!': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
  '?': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b00000, 0b00100],
  "'": [0b00100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000],
};
