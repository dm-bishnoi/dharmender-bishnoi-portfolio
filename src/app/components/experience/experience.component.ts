import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  QueryList,
  ViewChildren,
  inject,
} from '@angular/core';

@Component({
  selector: 'app-experience',
  standalone: true,
  templateUrl: './experience.component.html',
  styleUrl: './experience.component.css'
})
export class ExperienceComponent implements AfterViewInit, OnDestroy {
  @ViewChildren('evidenceItem') evidenceItems!: QueryList<HTMLElement>;

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
    this.host.querySelectorAll<SVGElement>('.exp-timeline-line').forEach((el) => {
      el.style.strokeDashoffset = '0';
    });
    this.host.querySelectorAll<HTMLElement>('.exp-role-evidence li').forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }

  private runReveal(): void {
    if (!this.host) return;

    // Reveal each data-reveal-stage element with its configured delay
    const stages = this.host.querySelectorAll<HTMLElement>('[data-reveal-stage]');
    stages.forEach((el) => {
      const delay = parseInt(el.dataset['revealDelay'] || '0', 10);
      const t = window.setTimeout(() => {
        el.classList.add('is-revealed');
      }, delay);
      this.timeouts.push(t);
    });

    // Animate the timeline line drawing
    const timelineLine = this.host.querySelector<SVGElement>('.exp-timeline-line');
    if (timelineLine) {
      const length = parseFloat(timelineLine.dataset['length'] || '200');
      timelineLine.style.strokeDasharray = `${length}`;
      timelineLine.style.strokeDashoffset = `${length}`;
      const t = window.setTimeout(() => {
        timelineLine.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(0.22, 1, 0.36, 1)';
        timelineLine.style.strokeDashoffset = '0';
      }, 600);
      this.timeouts.push(t);
    }

    // Stagger evidence items
    const items = this.host.querySelectorAll<HTMLElement>('.exp-role-evidence li');
    items.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-12px)';
      el.style.transition = `opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1), transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)`;
      const t = window.setTimeout(() => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      }, 1200 + i * 110);
      this.timeouts.push(t);
    });
  }
}
