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

    // Global reveal observer for elements using .reveal* classes.
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

    if (!this.prefersReducedMotion) {
      this.setupScrollMotion();
      // Wait for Angular to fully render all children before wiring cursor/ storyteller
      setTimeout(() => {
        this.setupCursor();
        this.setupScrollStorytelling();
      }, 100);
    }
  }

  // ── Atmospheric parallax on scroll ───────────────────
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
          lastY = y;

          if (atmLight) {
            atmLight.style.transform = `translate3d(0, ${y * -0.06}px, 0)`;
          }
          if (atmLight2) {
            atmLight2.style.transform = `translate3d(0, ${y * 0.04}px, 0)`;
          }
        });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      this.scrollHandler = onScroll;
    });
  }

  // ── Custom cursor ──────────────────────────────────
  private cursorRafId: number | null = null;
  private setupCursor(): void {
    // Check for touch device (hover: none = no mouse)
    if (window.matchMedia('(hover: none)').matches) return;

    const dot = document.getElementById('cursor-dot');
    const ring = document.getElementById('cursor-ring');
    if (!dot || !ring) return;

    // Fade in cursor on first mouse move
    let cursorShown = false;
    const showCursor = () => {
      if (!cursorShown) {
        dot.style.opacity = '1';
        ring.classList.add('is-active');
        cursorShown = true;
      }
    };

    // Smooth ring follow — ring lerps to mouse position
    let mouseX = 0, mouseY = 0;
    let ringX = 0, ringY = 0;
    const LERP = 0.12;

    document.addEventListener('mousemove', (e) => {
      showCursor();
      mouseX = e.clientX;
      mouseY = e.clientY;
      dot.style.left = mouseX + 'px';
      dot.style.top = mouseY + 'px';
    }, { passive: true });

    this.ngZone.runOutsideAngular(() => {
      const animate = () => {
        this.cursorRafId = requestAnimationFrame(animate);
        ringX += (mouseX - ringX) * LERP;
        ringY += (mouseY - ringY) * LERP;
        ring.style.left = ringX + 'px';
        ring.style.top = ringY + 'px';
      };
      this.cursorRafId = requestAnimationFrame(animate);
    });

    // Hover state: interactive elements expand the ring
    const HOVER_SELECTORS = 'a, button, [role="button"], .case-visual, .case-title, .exp-evidence li, .spec-item';
    const attachHovers = () => {
      document.querySelectorAll(HOVER_SELECTORS).forEach(el => {
        el.addEventListener('mouseenter', () => ring.classList.add('is-active'), { passive: true });
        el.addEventListener('mouseleave', () => ring.classList.remove('is-active'), { passive: true });
      });
    };
    attachHovers();
    // Re-attach after dynamic content renders
    setTimeout(attachHovers, 500);
  }

  // ── Scroll storytelling — 3D scene fades per section ─
  private setupScrollStorytelling(): void {
    const SECTION_OPACITY: Record<string, number> = {
      home: 1,
      about: 0.85,
      experience: 0.7,
      skills: 0.5,
      projects: 0.3,
      contact: 0.1,
    };

    window.addEventListener('scroll', () => {
      const sceneCanvas = document.querySelector<HTMLElement>('app-hero-scene canvas');
      if (!sceneCanvas) return;

      const winH = window.innerHeight;
      for (const [id, opacity] of Object.entries(SECTION_OPACITY)) {
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        // Section is the dominant visible section when its top is in the upper half
        if (rect.top < winH * 0.5 && rect.bottom > winH * 0.5) {
          sceneCanvas.style.opacity = String(opacity);
          break;
        }
      }
    }, { passive: true });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.cursorRafId !== null) cancelAnimationFrame(this.cursorRafId);
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
    }
  }
}