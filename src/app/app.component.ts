import { Component, AfterViewInit, OnDestroy, NgZone, inject } from '@angular/core';
import { HeaderComponent } from './components/header/header.component';
import { HeroComponent } from './components/hero/hero.component';
import { AboutComponent } from './components/about/about.component';
import { ExperienceComponent } from './components/experience/experience.component';
import { SkillsComponent } from './components/skills/skills.component';
import { ProjectsComponent } from './components/projects/projects.component';
import { ContactComponent } from './components/contact/contact.component';
import { FooterComponent } from './components/footer/footer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    HeaderComponent,
    HeroComponent,
    AboutComponent,
    ExperienceComponent,
    SkillsComponent,
    ProjectsComponent,
    ContactComponent,
    FooterComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements AfterViewInit, OnDestroy {
  private observer: IntersectionObserver | null = null;
  private scrollHandler: (() => void) | null = null;
  private rafId: number | null = null;
  private prefersReducedMotion = false;
  private ngZone = inject(NgZone);

  ngAfterViewInit(): void {
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Set up the legacy reveal observer for any elements that still use the
    // global `.reveal*` classes (none after this refactor, but kept for safety).
    const revealEls = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale, .reveal-stagger');
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            this.observer?.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -20px 0px' }
    );
    revealEls.forEach((el) => this.observer!.observe(el));

    // Cinematic scroll motion: subtle background light movement + atmospheric drift.
    if (!this.prefersReducedMotion) {
      this.setupScrollMotion();
    }
  }

  private setupScrollMotion(): void {
    let lastY = 0;
    const atmLight = document.querySelector<HTMLElement>('.atm-light');
    const atmLight2 = document.querySelector<HTMLElement>('.atm-light-2');

    this.ngZone.runOutsideAngular(() => {
      const onScroll = () => {
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          const y = window.scrollY;
          const delta = y - lastY;
          lastY = y;

          // Subtle parallax for atmospheric light layers (very slow, < 100px range)
          if (atmLight) {
            atmLight.style.transform = `translate3d(0, ${y * -0.06}px, 0)`;
          }
          if (atmLight2) {
            atmLight2.style.transform = `translate3d(0, ${y * 0.04}px, 0)`;
          }

          // Suppress unused delta warning
          void delta;
        });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      this.scrollHandler = onScroll;
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
    }
  }
}