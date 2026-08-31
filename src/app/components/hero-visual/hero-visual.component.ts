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

  ngAfterViewInit(): void {
    this.prefersReducedMotion = this.mediaQuery.matches;
    this.isMobile = window.matchMedia('(max-width: 767px)').matches;
    this.scene = this.host.querySelector<HTMLElement>('.hero-visual-scene');

    this.mediaQuery.addEventListener('change', this.onMotionPreferenceChange);
    this.host.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    this.host.addEventListener('pointerleave', this.handlePointerLeave, { passive: true });

    this.observer = new IntersectionObserver(([entry]) => {
      this.isVisible = entry.isIntersecting;
      if (this.isVisible && !this.prefersReducedMotion) {
        this.startAnimation();
      } else {
        this.stopAnimation();
      }
    }, { threshold: 0.1 });

    this.observer.observe(this.host);
  }

  ngOnDestroy(): void {
    this.stopAnimation();
    this.observer?.disconnect();
    this.mediaQuery.removeEventListener('change', this.onMotionPreferenceChange);
    this.host.removeEventListener('pointermove', this.handlePointerMove);
    this.host.removeEventListener('pointerleave', this.handlePointerLeave);
  }

  onNodeHover(_label: string): void {
    // Micro-interaction trigger if needed
  }

  onNodeLeave(): void {
    // Micro-interaction reset
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.prefersReducedMotion || this.isMobile) return;

    const rect = this.host.getBoundingClientRect();
    const normalizedX = (event.clientX - rect.left) / rect.width - 0.5;
    const normalizedY = (event.clientY - rect.top) / rect.height - 0.5;

    this.targetX = normalizedY * -6.5;
    this.targetY = normalizedX * 8.5;
    this.targetScale = 1.01;
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

        // Smooth interpolation
        this.currentX += (this.targetX - this.currentX) * 0.08;
        this.currentY += (this.targetY - this.currentY) * 0.08;
        this.currentScale += (this.targetScale - this.currentScale) * 0.08;

        // Continuous subtle idle motion (alive when mouse is completely still)
        const time = timestamp * 0.0004;
        const idleX = Math.sin(time) * 1.8;
        const idleY = Math.cos(time * 0.85) * 1.4;
        const idleLift = Math.sin(time * 0.6) * 1.5;

        const rotX = this.currentX + idleX;
        const rotY = this.currentY + idleY;

        this.scene.style.transform = `perspective(${this.isMobile ? 800 : 1200}px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateY(${idleLift}px) scale(${this.currentScale})`;

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