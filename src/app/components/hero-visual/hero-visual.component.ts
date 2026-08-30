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
  private onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    this.prefersReducedMotion = event.matches;
    if (this.prefersReducedMotion) {
      this.stopAnimation();
      this.resetScene();
    } else if (this.isVisible) {
      this.startAnimation();
    }
  };
  private isVisible = false;
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;
  private targetScale = 1;
  private currentScale = 1;
  private lastFrame = 0;
  private hoverX = 0; // Hover offset X
  private hoverY = 0; // Hover offset Y
  private hoverScale = 1; // Hover scale effect
  private hoveredElement: HTMLElement | null = null;

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
    this.host.addEventListener('pointerenter', this.handlePointerEnter, { passive: true });

    // Set up hover detection for individual panels
    this.setupPanelHoverDetection();

    this.observer = new IntersectionObserver(([entry]) => {
      this.isVisible = entry.isIntersecting;
      if (this.isVisible && !this.prefersReducedMotion) {
        this.startAnimation();
      } else {
        this.stopAnimation();
      }
    }, { threshold: 0.15 });

    this.observer.observe(this.host);
  }

  private setupPanelHoverDetection(): void {
    // Add mouseenter/mouseleave listeners to each panel for hover effects
    const panels = this.host.querySelectorAll<HTMLElement>('.panel');
    panels.forEach(panel => {
      panel.addEventListener('mouseenter', this.handlePanelHoverEnter);
      panel.addEventListener('mouseleave', this.handlePanelHoverLeave);
    });
  }

  private handlePanelHoverEnter = (event: MouseEvent): void => {
    if (this.prefersReducedMotion || this.isMobile) return;
    
    const target = event.currentTarget as HTMLElement;
    this.hoveredElement = target;
    // Add a subtle lift effect with CSS transition
    target.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    // Add lift to existing transform (preserving CSS animations)
    const currentTransform = target.style.transform || '';
    target.style.transform = currentTransform + ' translateZ(12px) scale(1.03)';
    
    // Also make the panel label and dot pulse slightly
    const label = target.querySelector('.panel-label') as HTMLElement | null;
    const dot = target.querySelector('.panel-dot') as HTMLElement | null;
    if (label) {
      label.style.transition = 'color 0.3s ease, transform 0.3s ease';
      label.style.color = 'var(--color-accent)';
      label.style.transform = 'scale(1.05)';
    }
    if (dot) {
      dot.style.transition = 'background-color 0.3s ease, transform 0.3s ease';
      dot.style.backgroundColor = 'var(--color-accent)';
      dot.style.transform = 'scale(1.2)';
    }
  };

  private handlePanelHoverLeave = (event: MouseEvent): void => {
    if (this.prefersReducedMotion || this.isMobile) return;
    
    const target = event.currentTarget as HTMLElement;
    this.hoveredElement = null;
    // Remove hover effects smoothly
    target.style.transition = 'transform 0.5s ease';
    target.style.transform = ''; // Reset to let CSS animations take over
    
    const label = target.querySelector('.panel-label') as HTMLElement | null;
    const dot = target.querySelector('.panel-dot') as HTMLElement | null;
    if (label) {
      label.style.transition = 'color 0.5s ease, transform 0.5s ease';
      label.style.color = '';
      label.style.transform = '';
    }
    if (dot) {
      dot.style.transition = 'background-color 0.5s ease, transform 0.5s ease';
      dot.style.backgroundColor = '';
      dot.style.transform = '';
    }
  };

  ngOnDestroy(): void {
    this.stopAnimation();
    this.observer?.disconnect();
    this.mediaQuery.removeEventListener('change', this.onMotionPreferenceChange);
    this.host.removeEventListener('pointermove', this.handlePointerMove);
    this.host.removeEventListener('pointerleave', this.handlePointerLeave);
    this.host.removeEventListener('pointerenter', this.handlePointerEnter);
    
    // Remove panel hover listeners
    const panels = this.host.querySelectorAll<HTMLElement>('.panel');
    panels.forEach(panel => {
      panel.removeEventListener('mouseenter', this.handlePanelHoverEnter);
      panel.removeEventListener('mouseleave', this.handlePanelHoverLeave);
    });
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.prefersReducedMotion || this.isMobile) return;

    const rect = this.host.getBoundingClientRect();
    const normalizedX = (event.clientX - rect.left) / rect.width - 0.5;
    const normalizedY = (event.clientY - rect.top) / rect.height - 0.5;

    // Mouse movement is ADDITIVE to idle animation
    this.targetX = normalizedY * -8; // Reduced from -10 for subtlety
    this.targetY = normalizedX * 10; // Reduced from 12 for subtlety
    this.targetScale = 1.01; // Reduced from 1.015
  };

  private handlePointerLeave = (): void => {
    // When pointer leaves, reset interactive targets to zero
    // but idle animation continues
    this.targetX = 0;
    this.targetY = 0;
    this.targetScale = 1;
  };

  private handlePointerEnter = (): void => {
    // Reset hover state when pointer enters
    this.hoverX = 0;
    this.hoverY = 0;
    this.hoverScale = 1;
    this.hoveredElement = null;
  };

  private startAnimation(): void {
    if (this.animationFrameId || !this.scene) return;

    this.ngZone.runOutsideAngular(() => {
      const animate = (timestamp: number): void => {
        if (!this.isVisible || this.prefersReducedMotion || !this.scene) {
          this.animationFrameId = null;
          return;
        }

        // Cap updates to roughly 30fps on small screens and avoid unnecessary work.
        const frameInterval = this.isMobile ? 33 : 16;
        if (timestamp - this.lastFrame < frameInterval) {
          this.animationFrameId = requestAnimationFrame(animate);
          return;
        }
        this.lastFrame = timestamp;

        this.currentX += (this.targetX - this.currentX) * 0.07;
        this.currentY += (this.targetY - this.currentY) * 0.07;
        this.currentScale += (this.targetScale - this.currentScale) * 0.08;

        const time = timestamp * 0.00035;
        const idleX = Math.sin(time) * 2.4;
        const idleY = Math.cos(time * 0.78) * 1.8;
        const lift = Math.sin(time * 0.6) * 2;

        this.scene.style.transform = `perspective(${this.isMobile ? 700 : 1200}px) rotateX(${this.currentX + idleX}deg) rotateY(${this.currentY + idleY}deg) translateY(${lift}px) scale(${this.currentScale})`;
        this.scene.style.setProperty('--scene-progress', `${(Math.sin(time) + 1) / 2}`);

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
      this.scene.style.removeProperty('--scene-progress');
    }
  }
}