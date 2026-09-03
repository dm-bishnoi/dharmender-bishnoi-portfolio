import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  NgZone,
  inject,
} from '@angular/core';

@Component({
  selector: 'app-experience',
  standalone: true,
  templateUrl: './experience.component.html',
  styleUrl: './experience.component.css'
})
export class ExperienceComponent implements AfterViewInit, OnDestroy {
  private host: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;
  private ngZone = inject(NgZone);
  private scrollRafId: number | null = null;
  private scrollHandler: (() => void) | null = null;

  constructor(private el: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;
    this.host = this.el.nativeElement;

    // Observe stages for active state
    const stages = this.host.querySelectorAll('.exp-stage');
    if (stages.length > 0 && typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-active');
            } else {
              entry.target.classList.remove('is-active');
            }
          }
        },
        { rootMargin: '-30% 0px -40% 0px' }
      );
      stages.forEach((el) => this.observer!.observe(el));
    }

    // Scroll progress line
    this.setupScrollProgress();
  }

  private setupScrollProgress(): void {
    const timeline = this.host?.querySelector('.exp-timeline') as HTMLElement;
    const progressLine = this.host?.querySelector('#exp-progress-line') as HTMLElement;
    if (!timeline || !progressLine) return;

    this.ngZone.runOutsideAngular(() => {
      this.scrollHandler = () => {
        if (this.scrollRafId !== null) return;
        this.scrollRafId = requestAnimationFrame(() => {
          this.scrollRafId = null;
          const rect = timeline.getBoundingClientRect();
          const windowHeight = window.innerHeight;
          
          // Start progressing when top of timeline enters middle of screen
          const start = windowHeight * 0.5;
          const totalDist = rect.height;
          
          let progress = (start - rect.top) / totalDist;
          progress = Math.max(0, Math.min(1, progress));
          progressLine.style.height = `${progress * 100}%`;
        });
      };
      window.addEventListener('scroll', this.scrollHandler, { passive: true });
      this.scrollHandler(); // init
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
    }
    if (this.scrollRafId !== null) {
      cancelAnimationFrame(this.scrollRafId);
    }
  }
}
