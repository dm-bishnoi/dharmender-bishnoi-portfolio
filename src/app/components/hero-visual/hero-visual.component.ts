import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeroVisualFallbackComponent } from './hero-visual-fallback.component';
import { buildScreenTexture } from './laptop-screen';

@Component({
  selector: 'app-hero-visual',
  standalone: true,
  imports: [CommonModule, HeroVisualFallbackComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hero-visual.component.html',
  styleUrl: './hero-visual.component.css',
})
export class HeroVisualComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLElement>;

  isMobile = false;
  prefersReducedMotion = false;
  webglFailed = false;

  private host: HTMLElement | null = null;
  private sceneEl: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private animationFrameId: number | null = null;
  private observer: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private mediaQuery: MediaQueryList;
  private isVisible = false;

  // Three.js runtime objects (nullable — set lazily after dynamic import).
  private renderer: any = null;
  private scene: any = null;
  private camera: any = null;
  private laptopGroup: any = null;
  private screenMat: any = null;

  // Parallax & idle motion state (matches existing CSS pipeline).
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;
  private currentScale = 1;
  private targetScale = 1;
  private lastFrame = 0;
  private idlePhase = 0;

  // Scroll progress (0..1) over the parent .hero-stage. The 3D model
  // reads this each frame and applies scroll-driven rotation / scale /
  // position changes in addition to the pointer tilt and idle motion.
  // Updated from the parent HeroStorytellingComponent to ensure perfect sync.
  private scrollProgress = 0;

  public setScrollProgress(p: number): void {
    this.scrollProgress = p;
  }

  private onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    this.prefersReducedMotion = event.matches;
    if (this.prefersReducedMotion) {
      this.stopAnimation();
    } else if (this.isVisible) {
      this.startAnimation();
    }
  };

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    private ngZone: NgZone
  ) {
    this.host = this.elementRef.nativeElement;
    this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  }

  ngAfterViewInit(): void {
    this.prefersReducedMotion = this.mediaQuery.matches;
    this.isMobile = window.innerWidth <= 767;
    this.sceneEl = this.host!.querySelector<HTMLElement>('.hero-visual-scene');

    // Assume initially visible to eager load the WebGL canvas and prevent
    // any pop-in or missing laptop on load.
    this.isVisible = true;

    this.mediaQuery.addEventListener('change', this.onMotionPreferenceChange);
    this.host!.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    this.host!.addEventListener('pointerleave', this.handlePointerLeave, { passive: true });

    if (!this.prefersReducedMotion) {
      void this.startAnimation();
    }

    this.observer = new IntersectionObserver(
      ([entry]) => {
        this.isVisible = entry.isIntersecting;
        if (this.isVisible && !this.prefersReducedMotion) {
          void this.startAnimation();
        } else {
          this.stopAnimation();
        }
      },
      { threshold: 0.05 }
    );

    this.observer.observe(this.host!);

    // Re-render the WebGL framebuffer when the slot resizes
    // (orientation change, window resize, mobile breakpoint flip,
    // or layout settling after the visual becomes visible).
    if (typeof ResizeObserver !== 'undefined' && this.sceneEl) {
      this.resizeObserver = new ResizeObserver(() => this.resizeRenderer());
      this.resizeObserver.observe(this.sceneEl);
    }
    window.addEventListener('resize', this.onWindowResize, { passive: true });
  }

  /** Window resize fallback (older browsers without ResizeObserver). */
  private onWindowResize = (): void => {
    this.resizeRenderer();
  };

  /** Re-fit the WebGL renderer to the current size of the scene. */
  private resizeRenderer(): void {
    if (!this.renderer || !this.sceneEl || !this.camera) return;
    const rect = this.sceneEl.getBoundingClientRect();
    // Skip when the slot is collapsed (e.g. before the layout settles).
    if (rect.width < 2 || rect.height < 2) return;
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.prefersReducedMotion || this.isMobile) return;
    const rect = this.host!.getBoundingClientRect();
    const normalizedX = (event.clientX - rect.left) / rect.width - 0.5;
    const normalizedY = (event.clientY - rect.top) / rect.height - 0.5;
    // Pointer tilt is independent of scroll. Cap at ±4° per spec.
    this.targetX = normalizedY * -4;
    this.targetY = normalizedX * 4;
    this.targetScale = 1.012;
  };

  private handlePointerLeave = (): void => {
    this.targetX = 0;
    this.targetY = 0;
    this.targetScale = 1;
  };

  // NOTE: scroll-driven transforms are now owned by the surrounding
  // `<app-hero-storytelling>` component. This component only handles
  // pointer tilt + idle sine motion + the WebGL render loop.

  private async startAnimation(): Promise<void> {
    if (this.animationFrameId !== null) return;

    // Initialize Three.js on first visible frame.
    if (!this.renderer) {
      await this.initThree();
      // If WebGL failed, bail out — the SVG fallback is already showing.
      if (!this.renderer) return;
    }

    this.ngZone.runOutsideAngular(() => {
      const animate = (timestamp: number): void => {
        if (!this.isVisible || this.prefersReducedMotion || !this.sceneEl) {
          this.animationFrameId = null;
          return;
        }

        const frameInterval = this.isMobile ? 33 : 16;
        if (timestamp - this.lastFrame < frameInterval) {
          this.animationFrameId = requestAnimationFrame(animate);
          return;
        }
        this.lastFrame = timestamp;

        // Smooth damping toward pointer target.
        this.currentX += (this.targetX - this.currentX) * 0.055;
        this.currentY += (this.targetY - this.currentY) * 0.055;
        this.currentScale += (this.targetScale - this.currentScale) * 0.055;

        // Multi-frequency idle physics — organic continuous motion.
        this.idlePhase += 0.00035;
        const f1 = Math.sin(this.idlePhase * 1.00) * 1.8;
        const f2 = Math.sin(this.idlePhase * 1.65) * 0.9;
        const f3 = Math.sin(this.idlePhase * 0.78) * 1.4;
        const f4 = Math.cos(this.idlePhase * 1.30) * 0.6;
        const f5 = Math.sin(this.idlePhase * 2.10) * 0.3;
        const idleRotX = f1 + f2 + f3;
        const idleRotY = (f2 * 0.8) + f4 + f5;
        const idleLift = Math.sin(this.idlePhase * 0.62) * 2.4;
        const idleZ = Math.cos(this.idlePhase * 0.48) * 3.2;

        const totalRotX = (this.currentX + idleRotX).toFixed(3);
        const totalRotY = (this.currentY + idleRotY).toFixed(3);
        const totalLift = idleLift.toFixed(3);
        const totalZ = idleZ.toFixed(3);

        const persp = this.isMobile ? 800 : 1000;
        this.sceneEl!.style.transform =
          `perspective(${persp}px) ` +
          `rotateX(${totalRotX}deg) ` +
          `rotateY(${totalRotY}deg) ` +
          `translateY(${totalLift}px) ` +
          `translateZ(${totalZ}px) ` +
          `scale(${this.currentScale.toFixed(3)})`;

        if (this.laptopGroup) {
          // Map scroll progress to a 0..1 phase that only begins after 0.25,
          // keeping the laptop mostly stable during the "Hero presentation" phase.
          const sp = this.scrollProgress <= 0.25 ? 0 : (this.scrollProgress - 0.25) / 0.75;
          const t = this.idlePhase;
          // X rotation: tilts the screen away from the user as the
          // laptop recedes. Up to ~12° at sp=1.
          this.laptopGroup.rotation.x = -0.18 - sp * 0.21;
          // Y rotation: subtle turn toward the user as the screen
          // becomes the focal point. Up to ~10°.
          this.laptopGroup.rotation.y = Math.sin(t * 0.4) * 0.03 - sp * 0.18;
          // Z rotation: barely visible lean, adds physicality.
          this.laptopGroup.rotation.z = sp * 0.04;
          // Depth: drops the laptop slightly as it recedes.
          this.laptopGroup.position.y = 0.1 - sp * 0.4;
          // Scale: the laptop shrinks in the frame as the scroll
          // progresses.
          const scrollScale = 1 - sp * 0.08;
          this.laptopGroup.scale.setScalar(scrollScale);
        }

        this.renderer.render(this.scene, this.camera);
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

  private async initThree(): Promise<void> {
    try {
      const THREE = await import('three');
      if (!this.canCreateWebGLContext()) {
        this.webglFailed = true;
        return;
      }

      this.buildRenderer(THREE);
      this.buildScene(THREE);
      this.buildLaptop(THREE);

      if (this.canvasEl) {
        this.canvasEl.classList.add('canvas-ready');
      }
    } catch (err) {
      console.warn('[hero-visual] Three.js init failed, using SVG fallback', err);
      this.webglFailed = true;
    }
  }

  private canCreateWebGLContext(): boolean {
    const probe = document.createElement('canvas');
    return !!(
      probe.getContext('webgl2') ||
      probe.getContext('webgl') ||
      probe.getContext('experimental-webgl')
    );
  }

  private buildRenderer(THREE: any): void {
    if (!this.sceneEl) return;

    const rect = this.sceneEl.getBoundingClientRect();
    const w = rect.width || 600;
    const h = rect.height || 480;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0); // transparent background

    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.classList.add('hero-3d-canvas');
    this.sceneEl.appendChild(canvas);
    this.canvasEl = canvas;
    this.renderer = renderer;
  }

  private buildScene(THREE: any): void {
    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    this.camera = camera;

    // Key light from top-right.
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(3, 5, 6);
    scene.add(keyLight);

    // Fill light from bottom-left (cool).
    const fillLight = new THREE.DirectionalLight(0x7eb1ff, 0.6);
    fillLight.position.set(-4, -2, 4);
    scene.add(fillLight);

    // Ambient for base illumination.
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    // Rim light from behind (accent color).
    const rimLight = new THREE.DirectionalLight(0x7eb1ff, 0.4);
    rimLight.position.set(0, 2, -5);
    scene.add(rimLight);
  }

  private buildLaptop(THREE: any): void {
    if (!this.scene) return;

    const group = new THREE.Group();

    // ── Shared materials (one instance per type) ─────────
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1c,
      metalness: 0.6,
      roughness: 0.4,
    });
    const keyboardMat = new THREE.MeshStandardMaterial({
      color: 0x0d0d0f,
      metalness: 0.3,
      roughness: 0.7,
    });
    const bezelMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      metalness: 0.2,
      roughness: 0.5,
    });
    const hingeMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a2e,
      metalness: 0.8,
      roughness: 0.3,
    });

    // ── Base / keyboard body ──────────────────────────────
    // Open laptop: base is the bottom half, screen is the top half (rotated).
    // Coordinates in Three.js world units; 1 unit ≈ 80 px of the CSS frame.
    // Width: 5.2u, height: 3.6u, depth: 0.18u.
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 3.6, 0.18),
      bodyMat
    );
    base.position.y = -1.6; // lower half of the laptop
    group.add(base);

    // Keyboard inset (slightly darker, raised by a few px).
    const keyboard = new THREE.Mesh(
      new THREE.BoxGeometry(4.8, 2.6, 0.04),
      keyboardMat
    );
    keyboard.position.set(0, -1.55, 0.11);
    group.add(keyboard);

    // Trackpad.
    const trackpad = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.5, 0.03),
      keyboardMat
    );
    trackpad.position.set(0, -2.9, 0.11);
    group.add(trackpad);

    // ── Hinge ─────────────────────────────────────────────
    const hinge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 5.2, 16),
      hingeMat
    );
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(0, 0.18, 0);
    group.add(hinge);

    // ── Screen back (the part visible from the front) ─────
    // Slightly smaller than base, forms the back of the screen.
    const screenBack = new THREE.Mesh(
      new THREE.BoxGeometry(5.1, 3.5, 0.12),
      bodyMat
    );
    screenBack.position.set(0, 1.88, -0.15);
    group.add(screenBack);

    // ── Screen bezel ───────────────────────────────────────
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(4.9, 3.3, 0.06),
      bezelMat
    );
    bezel.position.set(0, 1.88, -0.04);
    group.add(bezel);

    // ── Screen content (the glowing display) ──────────────
    const screenTexture = buildScreenTexture(THREE);
    this.screenMat = new THREE.MeshBasicMaterial({
      map: screenTexture,
      transparent: true,
      opacity: 1.0,
    });

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(4.55, 2.95),
      this.screenMat
    );
    // The plane sits just in front of the bezel (z = -0.01 → 0).
    screen.position.set(0, 1.88, 0.01);
    group.add(screen);

    // Subtle emissive glow from the screen (blue tint).
    const screenGlow = new THREE.PointLight(0x7eb1ff, 0.6, 6);
    screenGlow.position.set(0, 1.88, 1.5);
    group.add(screenGlow);

    // ── Apply screen tilt ─────────────────────────────────
    // The base sits flat (rotY=0). The screen is rotated ~100° around X
    // so it leans back naturally.
    group.rotation.x = -0.18; // subtle forward tilt of entire group

    // ── Center in frame ────────────────────────────────────
    group.position.set(0, 0.1, 0);

    this.scene.add(group);
    this.laptopGroup = group;
  }

  ngOnDestroy(): void {
    // Stop animation loop.
    this.stopAnimation();

    // Disconnect observers.
    this.observer?.disconnect();
    this.mediaQuery.removeEventListener('change', this.onMotionPreferenceChange);
    this.host?.removeEventListener('pointermove', this.handlePointerMove);
    this.host?.removeEventListener('pointerleave', this.handlePointerLeave);

    // Remove resize listener.
    window.removeEventListener('resize', this.onWindowResize);

    // Disconnect observers.
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    // Dispose Three.js resources (matches hero-scene pattern).
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    if (this.screenMat) {
      if (this.screenMat.map) this.screenMat.map.dispose();
      this.screenMat.dispose();
    }
    // Dispose all child geometries/materials.
    if (this.laptopGroup) {
      this.laptopGroup.traverse((child: any) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m: any) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
    }
    this.scene = null;
    this.camera = null;
    this.laptopGroup = null;
    this.renderer = null;
  }
}
