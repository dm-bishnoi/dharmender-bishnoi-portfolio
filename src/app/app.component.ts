import {
  AfterViewInit,
  Component,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
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
    CommonModule,
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
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private ngZone = inject(NgZone);

  private prefersReducedMotion = false;
  private revealObserver: IntersectionObserver | null = null;

  // ── Cursor state ─────────────────────────────────────
  private cursorRafId: number | null = null;
  private cursorEnabled = false;

  // ── Scroll storytelling (single observer, not a scroll listener) ─
  /** Map of section id → opacity for the 3D scene as the user scrolls past it. */
  private static readonly SECTION_OPACITY: ReadonlyArray<{ id: string; opacity: number }> = [
    { id: 'home',       opacity: 1.00 },
    { id: 'about',      opacity: 0.85 },
    { id: 'experience', opacity: 0.70 },
    { id: 'skills',     opacity: 0.50 },
    { id: 'projects',   opacity: 0.30 },
    { id: 'contact',    opacity: 0.10 },
  ];

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.setupRevealObserver();
    this.setupScrollStorytelling();

    if (this.prefersReducedMotion) {
      // No cursor, no animation observers, no scroll opacity changes.
      return;
    }

    // Atmospheric parallax: one rAF-throttled scroll handler.
    this.setupAtmosphericParallax();
    // Custom cursor on desktop only.
    this.setupCursor();
  }

  // ── Reveal observer for all in-page sections (delegated, not per-component) ─
  private setupRevealObserver(): void {
    const revealEls = document.querySelectorAll(
      '.reveal, .reveal-left, .reveal-right, .reveal-scale, .reveal-stagger, [data-reveal-stage]'
    );
    if (revealEls.length === 0) return;
    this.revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible', 'is-revealed');
            this.revealObserver?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -8% 0px' }
    );
    revealEls.forEach((el) => this.revealObserver!.observe(el));
  }

  // ── Atmospheric parallax (rAF-throttled) ─────────────
  private atmRafId: number | null = null;
  private atmLight1: HTMLElement | null = null;
  private atmLight2: HTMLElement | null = null;
  private setupAtmosphericParallax(): void {
    this.atmLight1 = document.querySelector<HTMLElement>('.atm-light');
    this.atmLight2 = document.querySelector<HTMLElement>('.atm-light-2');
    if (!this.atmLight1 && !this.atmLight2) return;

    this.ngZone.runOutsideAngular(() => {
      const onScroll = () => {
        if (this.atmRafId !== null) return;
        this.atmRafId = requestAnimationFrame(() => {
          this.atmRafId = null;
          const y = window.scrollY;
          if (this.atmLight1) this.atmLight1.style.transform = `translate3d(0, ${y * -0.06}px, 0)`;
          if (this.atmLight2) this.atmLight2.style.transform = `translate3d(0, ${y * 0.04}px, 0)`;
        });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      this.atmScrollHandler = onScroll;
    });
  }
  private atmScrollHandler: (() => void) | null = null;

  // ── Custom cursor (desktop only, event-delegated) ─────
  private setupCursor(): void {
    // Touch / coarse-pointer devices use the native cursor.
    if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

    const dot = document.getElementById('cursor-dot');
    const ring = document.getElementById('cursor-ring');
    if (!dot || !ring) return;

    this.cursorEnabled = true;
    let mouseX = 0, mouseY = 0;
    let ringX = 0, ringY = 0;
    let shown = false;
    const LERP = 0.14;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      dot.style.transform = `translate3d(${mouseX - 3}px, ${mouseY - 3}px, 0)`;
      if (!shown) {
        ring.classList.add('is-active');
        shown = true;
      }
    }, { passive: true });

    this.ngZone.runOutsideAngular(() => {
      const animate = () => {
        this.cursorRafId = requestAnimationFrame(animate);
        ringX += (mouseX - ringX) * LERP;
        ringY += (mouseY - ringY) * LERP;
        ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
      };
      this.cursorRafId = requestAnimationFrame(animate);
    });

    // Event delegation: one pair of listeners on document, not N per element.
    const HOVER = 'a, button, [role="button"], .case-visual, .case-title, .exp-role-evidence li, .spec-item';
    const onOver = (e: Event) => {
      const target = e.target as Element | null;
      if (target && target.closest(HOVER)) ring.classList.add('is-hover');
    };
    const onOut = (e: Event) => {
      const target = e.target as Element | null;
      if (target && target.closest(HOVER)) ring.classList.remove('is-hover');
    };
    document.addEventListener('mouseover', onOver, { passive: true });
    document.addEventListener('mouseout', onOut, { passive: true });

    this.cursorHoverCleanup = () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
    };
  }
  private cursorHoverCleanup: (() => void) | null = null;

  // ── Scroll storytelling — single IntersectionObserver, not a scroll listener ─
  private storytellingObserver: IntersectionObserver | null = null;
  private setupScrollStorytelling(): void {
    // Skip on small screens: scene opacity is handled by the hero-scene component's own
    // visibility observer; no extra observers needed.
    if (window.innerWidth < 768) return;

    const getOpacity = (id: string): number => {
      const entry = AppComponent.SECTION_OPACITY.find((s) => s.id === id);
      return entry ? entry.opacity : 1;
    };

    // Per-section IntersectionObserver: when a section becomes visible, fade the
    // 3D scene to the mapped opacity. No getBoundingClientRect, no scroll listener.
    const sectionIds = AppComponent.SECTION_OPACITY.map((s) => s.id);
    const sectionEls: HTMLElement[] = [];
    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (el) sectionEls.push(el);
    }
    if (sectionEls.length === 0) return;

    let currentOpacity: number | null = null;
    const applyOpacity = (opacity: number) => {
      if (currentOpacity === opacity) return;
      currentOpacity = opacity;
      const scene = document.querySelector<HTMLElement>('app-hero-scene canvas');
      if (scene) scene.style.opacity = String(opacity);
    };

    // Build per-section observers. Each one tracks when its section enters the
    // middle 30% of the viewport and sets the scene opacity.
    for (let i = 0; i < sectionEls.length; i++) {
      const el = sectionEls[i];
      const opacity = getOpacity(el.id);
      const obs = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) applyOpacity(opacity);
          }
        },
        { threshold: 0, rootMargin: '-30% 0px -55% 0px' }
      );
      obs.observe(el);
    }
  }

  ngOnDestroy(): void {
    this.revealObserver?.disconnect();
    if (this.atmRafId !== null) cancelAnimationFrame(this.atmRafId);
    if (this.atmScrollHandler) {
      window.removeEventListener('scroll', this.atmScrollHandler);
    }
    if (this.cursorEnabled) {
      if (this.cursorRafId !== null) cancelAnimationFrame(this.cursorRafId);
      this.cursorHoverCleanup?.();
    }
  }
}
