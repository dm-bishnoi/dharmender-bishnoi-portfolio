import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeroVisualComponent } from '../hero-visual/hero-visual.component';

/**
 * One DOM node per emerging tech label. `ax`/`ay` are the final
 * position (vw / vh) from the laptop's center; `onset` is the
 * normalized scroll progress (0..1) at which the node begins
 * fading + scaling in.
 */
interface TechNode {
  readonly label: 'Angular' | 'TypeScript' | 'RxJS' | 'NgRx' | 'REST API';
  readonly icon: string;
  readonly ax: number;
  readonly ay: number;
  readonly onset: number;
}

@Component({
  selector: 'app-hero-storytelling',
  standalone: true,
  imports: [CommonModule, HeroVisualComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hero-storytelling.component.html',
  styleUrl: './hero-storytelling.component.css',
})
export class HeroStorytellingComponent implements AfterViewInit, OnDestroy {
  @ViewChild('stageEl',   { static: true }) stageRef!:   ElementRef<HTMLElement>;
  @ViewChild('laptopWrap',{ static: true }) laptopRef!:  ElementRef<HTMLElement>;
  @ViewChild('techNodes', { static: true }) nodesRef!:   ElementRef<HTMLElement>;
  @ViewChild(HeroVisualComponent) heroVisual!: HeroVisualComponent;

  /** Five emerging tech nodes. The numbers are tuned for the desktop layout. */
  readonly nodes: ReadonlyArray<TechNode> = [
    { label: 'Angular',    icon: 'A',  ax: -34, ay: 18, onset: 0.50 },
    { label: 'TypeScript', icon: 'TS', ax:  30, ay:  2, onset: 0.55 },
    { label: 'RxJS',       icon: 'Rx', ax: -30, ay: 40, onset: 0.60 },
    { label: 'NgRx',       icon: 'N',  ax:  32, ay: 30, onset: 0.65 },
    { label: 'REST API',   icon: '{}', ax:   0, ay: 52, onset: 0.70 },
  ];

  // Cached node element references — populated in ngAfterViewInit.
  // The rAF loop reads from this map; no per-frame querySelector.
  private nodeEls = new Map<TechNode['label'], HTMLElement>();

  private prefersReducedMotion = false;
  private isMobile = false;
  private isVisible = true;
  private isActive = false;

  // Scroll progress (0..1) over the parent .hero-stage.
  private rawProgress = 0;
  // Smoothed progress used for animation (lerps toward raw each frame).
  private smoothProgress = 0;
  private rafId: number | null = null;
  private scrollHandler: (() => void) | null = null;
  private observer: IntersectionObserver | null = null;

  private ngZone = inject(NgZone);

  ngAfterViewInit(): void {
    this.prefersReducedMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.isMobile = window.innerWidth < 768;
    this.isActive = !this.prefersReducedMotion;

    // Cache tech-node element references once.
    for (const n of this.nodes) {
      const el = this.nodesRef.nativeElement.querySelector<HTMLElement>(
        `[data-node="${n.label}"]`
      );
      if (el) this.nodeEls.set(n.label, el);
    }

    this.observer = new IntersectionObserver(
      ([entry]) => { this.isVisible = entry.isIntersecting; },
      { rootMargin: '50% 0px', threshold: 0 }
    );
    this.observer.observe(this.stageRef.nativeElement);

    if (!this.isActive) {
      // Reduced motion: do not run the storytelling loop.
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      const onScroll = (): void => this.tickScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      this.scrollHandler = onScroll;
      this.tickScroll();
      this.rafId = requestAnimationFrame(this.tickFrame);
    });
  }

  /**
   * Read scrollY once per rAF, compute normalized progress over .hero-stage.
   *
   *   .hero-stage   = 200vh
   *     └── .hero-stage-sticky   = 100vh (the visible viewport)
   *
   * #stageEl is the inner .hero-storytelling (100vh sticky). We traverse up
   * to find the parent .hero-stage so the progress is computed over the full
   * 200vh scrollable area, not the sticky viewport.
   *
   * Progress = 0 when the stage top first meets the sticky viewport.
   * Progress = 1 when the stage bottom has scrolled past the viewport top
   * (i.e., the user has consumed the entire 200vh of scrollable stage).
   */
  private tickScroll = (): void => {
    // Traverse to the 200vh outer .hero-stage (our parent's parent).
    const outerStage = this.stageRef.nativeElement.closest('.hero-stage') as HTMLElement | null;
    if (!outerStage) return;
    const rect = outerStage.getBoundingClientRect();
    const stageH = outerStage.offsetHeight;
    const vh = window.innerHeight;
    // The 200vh stage contains a 100vh sticky child. The sticky child
    // engages when stage top scrolls past the viewport top, i.e. when
    // rect.top = -vh. From there to rect.top = -stageH the user is
    // consuming the 100vh of transition room. Anything before the
    // engagement is "the hero presentation" (progress 0) and anything
    // after the room is consumed is the handoff (progress 1).
    const denom = Math.max(1, stageH - vh);
    const scrolled = -rect.top - vh;
    this.rawProgress = Math.max(0, Math.min(1, scrolled / denom));
  };

  /** rAF: smooth progress, write DOM transforms. */
  private tickFrame = (): void => {
    this.rafId = requestAnimationFrame(this.tickFrame);
    if (!this.isVisible) return;

    // Smooth toward the latest raw value (lerp). A higher factor
    // (~0.18) keeps the laptop responsive during fast scrolls without
    // introducing visible jitter on slow scrolls.
    this.smoothProgress += (this.rawProgress - this.smoothProgress) * 0.18;
    const p = this.smoothProgress;

    // Push smoothed progress to the 3D visual component
    if (this.heroVisual) {
      this.heroVisual.setScrollProgress(p);
    }

    // Laptop outer transform.
    const laptop = this.laptopRef.nativeElement;
    laptop.style.transform =
      `translate3d(${this.tx(p)}vw, ${this.ty(p)}vh, 0) ` +
      `scale(${this.scale(p).toFixed(3)})`;
    laptop.style.opacity = String(this.opacity(p).toFixed(3));

    // Tech nodes.
    const baseX = this.tx(p);
    const baseY = this.ty(p);
    
    for (const n of this.nodes) {
      const el = this.nodeEls.get(n.label);
      if (!el) continue;
      const local = clamp01((p - n.onset) / 0.25);     // 0..1 over onset..onset+0.25
      const e = easeOutCubic(local);
      el.style.transform =
        `translate3d(${(baseX + n.ax * e).toFixed(2)}vw, ${(baseY + n.ay * e).toFixed(2)}vh, 0) ` +
        `scale(${(0.6 + 0.4 * e).toFixed(3)})`;
      el.style.opacity = String(e.toFixed(3));
    }
  };

  // ── Phase functions ──────────────────────────────────────────
  // 0.00–0.25  Hero presentation:  large, in place, no transform
  // 0.25–0.55  Begin:             drift center, scale 0.92, slight depth
  // 0.50–0.80  Code focus:        scale 0.78, depth, nodes emerge
  // 0.75–1.00  Handoff:           scale 0.62, opacity 0.60, nodes settle
  private tx(p: number): number {
    if (p <= 0.25) return 0;
    const t = easeInOutCubic(mapRange(p, 0.25, 1.0, 0, 1));
    return this.isMobile ? -2 * t : -2 * t;
  }
  private ty(p: number): number {
    if (p <= 0.25) return 0;
    const t = easeInOutCubic(mapRange(p, 0.25, 1.0, 0, 1));
    return this.isMobile ? -4 * t : -5 * t;
  }
  private scale(p: number): number {
    if (p <= 0.25) return 1;
    const t = easeInOutCubic(mapRange(p, 0.25, 1.0, 0, 1));
    return this.isMobile ? 1 - 0.22 * t : 1 - 0.38 * t;
  }
  private opacity(p: number): number {
    if (p <= 0.25) return 1;
    const t = easeInOutCubic(mapRange(p, 0.25, 1.0, 0, 1));
    return this.isMobile ? 1 - 0.22 * t : 1 - 0.40 * t;
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.observer?.disconnect();
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
    }
  }
}

function clamp01(t: number): number { return Math.max(0, Math.min(1, t)); }

function mapRange(v: number, a: number, b: number, c: number, d: number): number {
  return c + (d - c) * clamp01((v - a) / Math.max(0.0001, b - a));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }
