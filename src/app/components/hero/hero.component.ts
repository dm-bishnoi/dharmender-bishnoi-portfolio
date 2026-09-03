import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
} from '@angular/core';
import { HeroSceneComponent } from '../hero-scene/hero-scene.component';
import { HeroStorytellingComponent } from '../hero-storytelling/hero-storytelling.component';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [HeroSceneComponent, HeroStorytellingComponent],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.css'
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  private host: HTMLElement | null = null;
  private mediaQuery: MediaQueryList;
  private motionListener: (e: MediaQueryListEvent) => void;
  prefersReducedMotion = false;
  private timeouts: number[] = [];

  constructor(private el: ElementRef<HTMLElement>) {
    this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motionListener = (e: MediaQueryListEvent) => {
      this.prefersReducedMotion = e.matches;
    };
  }

  ngAfterViewInit(): void {
    this.host = this.el.nativeElement;
    this.prefersReducedMotion = this.mediaQuery.matches;
    this.mediaQuery.addEventListener('change', this.motionListener);

    if (this.prefersReducedMotion) {
      this.revealAll();
      return;
    }

    // Cinematic staggered entrance — one element at a time.
    // The dotted text component has its own revealDelay (800ms) from IntersectionObserver.
    const reveals: Array<{ selector: string; delay: number }> = [
      { selector: '[data-hero-reveal="meta"]',      delay: 100 },
      { selector: '[data-hero-reveal="identity"]',   delay: 300 },
      { selector: '[data-hero-reveal="statement"]',    delay: 900 },
      { selector: '[data-hero-reveal="foot"]',        delay: 1100 },
    ];

    for (const { selector, delay } of reveals) {
      const el = this.host!.querySelector(selector);
      if (!el) continue;
      const t = window.setTimeout(() => {
        (el as HTMLElement).classList.add('is-revealed');
      }, delay);
      this.timeouts.push(t);
    }
  }

  private revealAll(): void {
    if (!this.host) return;
    const selectors = [
      '[data-hero-reveal="meta"]',
      '[data-hero-reveal="identity"]',
      '[data-hero-reveal="statement"]',
      '[data-hero-reveal="foot"]',
    ];
    selectors.forEach(sel => {
      this.host!.querySelectorAll<HTMLElement>(sel).forEach(el => {
        el.classList.add('is-revealed');
      });
    });
  }

  ngOnDestroy(): void {
    this.mediaQuery.removeEventListener('change', this.motionListener);
    this.timeouts.forEach(t => clearTimeout(t));
  }
}
