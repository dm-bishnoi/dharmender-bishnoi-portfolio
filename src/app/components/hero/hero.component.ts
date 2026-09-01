import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  inject,
} from '@angular/core';
import { DottedTextComponent } from '../dotted-text/dotted-text.component';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [DottedTextComponent],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.css'
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  private host: HTMLElement | null = null;
  private prefersReducedMotion = false;
  private mouseX = 0;
  private mouseY = 0;
  private currentX = 0;
  private currentY = 0;
  private rafId: number | null = null;
  private ro?: ResizeObserver;
  private mediaQuery: MediaQueryList;
  private isMobile = false;
  private motionListener: (e: MediaQueryListEvent) => void;

  constructor(private el: ElementRef<HTMLElement>, private ngZone: NgZone) {
    this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motionListener = (e: MediaQueryListEvent) => {
      this.prefersReducedMotion = e.matches;
      if (this.prefersReducedMotion && this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      } else if (!this.prefersReducedMotion && this.rafId === null) {
        this.ngZone.runOutsideAngular(() => this.startMouseParallax());
      }
    };
  }

  ngAfterViewInit(): void {
    this.host = this.el.nativeElement;
    this.prefersReducedMotion = this.mediaQuery.matches;
    this.mediaQuery.addEventListener('change', this.motionListener);

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          this.isMobile = entry.contentRect.width <= 480;
        }
      });
      this.ro.observe(this.host);
    }

    if (!this.prefersReducedMotion && !this.isMobile) {
      this.ngZone.runOutsideAngular(() => this.startMouseParallax());
    }

    // Staggered entrance: trigger each child zone sequentially
    const inner = this.host.querySelector<HTMLElement>('.hero-inner');
    if (inner) {
      // Elements animate via CSS keyframes triggered by JS class additions
      // for more precise control than CSS animation-delay alone.
      setTimeout(() => {
        inner.querySelectorAll('.hero-meta, .hero-display, .hero-foot').forEach((el, i) => {
          setTimeout(() => {
            (el as HTMLElement).style.opacity = '1';
            (el as HTMLElement).style.transform = '';
          }, i * 120);
        });
      }, 100);
    }
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.ro?.disconnect();
    this.mediaQuery.removeEventListener('change', this.motionListener);
    if (this.host) {
      this.host.removeEventListener('pointermove', this.onPointerMove);
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.host || this.isMobile || this.prefersReducedMotion) return;
    const rect = this.host.getBoundingClientRect();
    this.mouseX = (e.clientX - rect.left) / rect.width - 0.5;
    this.mouseY = (e.clientY - rect.top) / rect.height - 0.5;
  };

  private startMouseParallax(): void {
    if (!this.host) return;
    this.host.addEventListener('pointermove', this.onPointerMove, { passive: true });

    let last = performance.now();
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;
      // Smooth damping — very subtle
      this.currentX += (this.mouseX * 12 - this.currentX) * 0.04;
      this.currentY += (this.mouseY * 8 - this.currentY) * 0.04;

      const display = this.host!.querySelector<HTMLElement>('.hero-display');
      const atm = this.host!.querySelector<HTMLElement>('.hero-atm');
      if (display) {
        display.style.transform = `translateY(${this.currentY * -0.4}px) rotateX(${this.currentY * -1}deg)`;
      }
      if (atm) {
        atm.style.transform = `translate(${this.currentX * 6}px, ${this.currentY * 4}px)`;
      }
    };
    this.rafId = requestAnimationFrame(loop);
  }
}
