import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
} from '@angular/core';
import { DottedTextComponent } from '../dotted-text/dotted-text.component';
import { HeroSceneComponent } from '../hero-scene/hero-scene.component';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [DottedTextComponent, HeroSceneComponent],
  templateUrl: './hero.component.html',
  styleUrl: './hero.component.css'
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  private host: HTMLElement | null = null;
  private mediaQuery: MediaQueryList;
  private motionListener: (e: MediaQueryListEvent) => void;
  prefersReducedMotion = false;

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

    // Staggered entrance: trigger each child zone sequentially
    const inner = this.host.querySelector<HTMLElement>('.hero-inner');
    if (inner) {
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
    this.mediaQuery.removeEventListener('change', this.motionListener);
  }
}
