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

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.setupRevealObserver();
    // Per-section opacity fade for the background particle plexus is now
    // owned by <app-hero-scene>. The Hero storytelling wrapper drives the
    // laptop + tech nodes independently.

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
      '.reveal-up, .reveal-stagger, .mask-reveal, .mask-stagger'
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
      { threshold: 0.1, rootMargin: '0px 0px -15% 0px' }
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

  private cursorHoverCleanup: (() => void) | null = null;
  private magneticCleanup: (() => void) | null = null;

  // ── Custom cursor & magnetic elements ─────
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

    // Cache bounding rects on hover to avoid expensive layout thrashing in mousemove
    let activeGlassRect: DOMRect | null = null;
    let activeGlassEl: HTMLElement | null = null;
    let activeMagRect: DOMRect | null = null;
    let activeMagEl: HTMLElement | null = null;

    // Event delegation: one pair of listeners on document, not N per element.
    const HOVER = 'a, button, [role="button"], .project-case, .interactive, .glass';
    const onOver = (e: Event) => {
      const target = e.target as Element | null;
      if (target && target.closest('.case-visual')) {
        ring.classList.add('is-project');
      } else if (target && target.closest('a, button, [role="button"], .interactive')) {
        ring.classList.add('is-hover');
      } else if (target && target.closest('.glass')) {
        ring.classList.add('is-glass');
      }

      // Cache rects
      const hTarget = target as HTMLElement;
      if (hTarget) {
        const glass = hTarget.closest('.glass') as HTMLElement;
        if (glass && activeGlassEl !== glass) {
          activeGlassEl = glass;
          activeGlassRect = glass.getBoundingClientRect();
        }
        const mag = hTarget.closest('.magnetic') as HTMLElement;
        if (mag && activeMagEl !== mag) {
          activeMagEl = mag;
          activeMagRect = mag.getBoundingClientRect();
        }
      }
    };
    const onOut = (e: Event) => {
      ring.classList.remove('is-hover');
      ring.classList.remove('is-project');
      ring.classList.remove('is-glass');

      const hTarget = e.target as HTMLElement;
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;

      if (activeGlassEl && (!related || !activeGlassEl.contains(related))) {
        activeGlassEl = null;
        activeGlassRect = null;
      }
      if (activeMagEl && (!related || !activeMagEl.contains(related))) {
        activeMagEl.style.transform = `translate3d(0, 0, 0)`;
        activeMagEl = null;
        activeMagRect = null;
      }
    };
    document.addEventListener('mouseover', onOver, { passive: true });
    document.addEventListener('mouseout', onOut, { passive: true });

    // Magnetic & Glass hover (delegated)
    const onMouseMoveDelegate = (e: MouseEvent) => {
      // Liquid Glass Pointer Tracking
      if (activeGlassEl && activeGlassRect) {
        const x = e.clientX - activeGlassRect.left;
        const y = e.clientY - activeGlassRect.top;
        activeGlassEl.style.setProperty('--pointer-x', String(x));
        activeGlassEl.style.setProperty('--pointer-y', String(y));
      }

      // Magnetic Physics
      if (activeMagEl && activeMagRect) {
        const x = e.clientX - activeMagRect.left - activeMagRect.width / 2;
        const y = e.clientY - activeMagRect.top - activeMagRect.height / 2;
        activeMagEl.style.transform = `translate3d(${x * 0.3}px, ${y * 0.3}px, 0)`;
      }
    };
    
    document.addEventListener('mousemove', onMouseMoveDelegate, { passive: true });

    this.cursorHoverCleanup = () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
    };
    this.magneticCleanup = () => {
      document.removeEventListener('mousemove', onMouseMoveDelegate);
    };
  }
  private cursorHoverCleanup_field: (() => void) | null = null; // Replaced by cursorHoverCleanup above

  ngOnDestroy(): void {
    this.revealObserver?.disconnect();
    if (this.atmRafId !== null) cancelAnimationFrame(this.atmRafId);
    if (this.atmScrollHandler) {
      window.removeEventListener('scroll', this.atmScrollHandler);
    }
    if (this.cursorEnabled) {
      if (this.cursorRafId !== null) cancelAnimationFrame(this.cursorRafId);
      this.cursorHoverCleanup?.();
      this.magneticCleanup?.();
    }
  }
}
