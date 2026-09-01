import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
} from '@angular/core';

@Component({
  selector: 'app-contact',
  standalone: true,
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.css'
})
export class ContactComponent implements AfterViewInit, OnDestroy {
  private host: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;
  private hasTriggered = false;
  private timeouts: number[] = [];

  constructor(private el: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.revealAll();
      return;
    }
    this.host = this.el.nativeElement;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      this.revealAll();
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !this.hasTriggered) {
            this.hasTriggered = true;
            this.runReveal();
            this.observer?.disconnect();
            this.observer = null;
            break;
          }
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -10% 0px' }
    );
    this.observer.observe(this.host);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.timeouts.forEach(t => clearTimeout(t));
  }

  private revealAll(): void {
    if (!this.host) return;
    this.host.querySelectorAll<HTMLElement>('[data-reveal-stage]').forEach((el) => {
      el.classList.add('is-revealed');
    });
  }

  private runReveal(): void {
    if (!this.host) return;
    const stages = this.host.querySelectorAll<HTMLElement>('[data-reveal-stage]');
    stages.forEach((el) => {
      const delay = parseInt(el.dataset['revealDelay'] || '0', 10);
      const t = window.setTimeout(() => {
        el.classList.add('is-revealed');
      }, delay);
      this.timeouts.push(t);
    });
  }
}
