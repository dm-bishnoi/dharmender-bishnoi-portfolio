import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-hero-visual',
  standalone: true,
  templateUrl: './hero-visual.component.html',
  styleUrl: './hero-visual.component.css'
})
export class HeroVisualComponent implements AfterViewInit, OnDestroy {
  isMobile = false;
  prefersReducedMotion = false;

  private host: HTMLElement;
  private scene: HTMLElement | null = null;
  private animationFrameId: number | null = null;
  private observer: IntersectionObserver | null = null;
  private mediaQuery: MediaQueryList;
  private isVisible = false;

  // Parallax & interactive state
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;
  private currentScale = 1;
  private targetScale = 1;
  private lastFrame = 0;

  private onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    this.prefersReducedMotion = event.matches;
    if (this.prefersReducedMotion) {
      this.stopAnimation();
      this.resetScene();
    } else if (this.isVisible) {
      this.startAnimation();
    }
  };

  constructor(private elementRef: ElementRef<HTMLElement>, private ngZone: NgZone) {
    this.host = this.elementRef.nativeElement;
    this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  }

  private resizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    this.prefersReducedMotion = this.mediaQuery.matches;
    this.isMobile = window.innerWidth <= 767;
    this.scene = this.host.querySelector<HTMLElement>('.hero-visual-scene');

    this.mediaQuery.addEventListener('change', this.onMotionPreferenceChange);
    this.host.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    this.host.addEventListener('pointerleave', this.handlePointerLeave, { passive: true });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          this.isMobile = entry.contentRect.width <= 480;
        }
      });
      this.resizeObserver.observe(this.host);
    }

    this.observer = new IntersectionObserver(([entry]) => {
      this.isVisible = entry.isIntersecting;
      if (this.isVisible && !this.prefersReducedMotion) {
        this.startAnimation();
      } else {
        this.stopAnimation();
      }
    }, { threshold: 0.05 });

    this.observer.observe(this.host);
  }

  ngOnDestroy(): void {
    this.stopAnimation();
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.mediaQuery.removeEventListener('change', this.onMotionPreferenceChange);
    this.host.removeEventListener('pointermove', this.handlePointerMove);
    this.host.removeEventListener('pointerleave', this.handlePointerLeave);
  }

  onNodeHover(_label: string): void {
    // Micro-interaction
  }

  onNodeLeave(): void {
    // Micro-interaction reset
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.prefersReducedMotion || this.isMobile) return;

    const rect = this.host.getBoundingClientRect();
    const normalizedX = (event.clientX - rect.left) / rect.width - 0.5;
    const normalizedY = (event.clientY - rect.top) / rect.height - 0.5;

    this.targetX = normalizedY * -7.5;
    this.targetY = normalizedX * 9.5;
    this.targetScale = 1.015;
  };

  private handlePointerLeave = (): void => {
    this.targetX = 0;
    this.targetY = 0;
    this.targetScale = 1;
  };

  private startAnimation(): void {
    if (this.animationFrameId || !this.scene) return;

    this.ngZone.runOutsideAngular(() => {
      const animate = (timestamp: number): void => {
        if (!this.isVisible || this.prefersReducedMotion || !this.scene) {
          this.animationFrameId = null;
          return;
        }

        const frameInterval = this.isMobile ? 33 : 16;
        if (timestamp - this.lastFrame < frameInterval) {
          this.animationFrameId = requestAnimationFrame(animate);
          return;
        }
        this.lastFrame = timestamp;

        // Smooth damping towards pointer target
        this.currentX += (this.targetX - this.currentX) * 0.06;
        this.currentY += (this.targetY - this.currentY) * 0.06;
        this.currentScale += (this.targetScale - this.currentScale) * 0.06;

        // Multi-frequency continuous subtle idle physics (always alive when mouse is stationary)
        const t = timestamp * 0.00045;
        const idleRotX = Math.sin(t) * 2.2 + Math.sin(t * 1.7) * 0.7;
        const idleRotY = Math.cos(t * 0.8) * 2.5 + Math.cos(t * 1.5) * 0.8;
        const idleLift = Math.sin(t * 0.6) * 2.2;
        const idleZ = Math.cos(t * 0.45) * 3.0;

        const totalRotX = (this.currentX + idleRotX).toFixed(2);
        const totalRotY = (this.currentY + idleRotY).toFixed(2);
        const totalLift = idleLift.toFixed(2);
        const totalZ = idleZ.toFixed(2);

        const persp = this.isMobile ? 850 : 1200;
        this.scene.style.transform = `perspective(${persp}px) rotateX(${totalRotX}deg) rotateY(${totalRotY}deg) translateY(${totalLift}px) translateZ(${totalZ}px) scale(${this.currentScale.toFixed(3)})`;

        this.animationFrameId = requestAnimationFrame(animate);
      };

      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  private stopAnimation(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private resetScene(): void {
    this.currentX = 0;
    this.currentY = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.currentScale = 1;
    this.targetScale = 1;
    if (this.scene) {
      this.scene.style.transform = 'none';
    }
  }
}