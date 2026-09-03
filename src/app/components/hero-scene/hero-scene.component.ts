import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';

type SceneState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'revealing'
  | 'idle-loop'
  | 'paused'
  | 'fallback'
  | 'reduced-motion';

@Component({
  selector: 'app-hero-scene',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hero-scene-host" #host>
      <div class="hero-scene-fallback" *ngIf="state === 'fallback'">
        <svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" class="fallback-svg">
          <defs>
            <radialGradient id="fbGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="rgba(37, 99, 235, 0.15)"/>
              <stop offset="100%" stop-color="rgba(37, 99, 235, 0)"/>
            </radialGradient>
            <pattern id="fbDots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="rgba(168, 179, 207, 0.15)"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#fbDots)" />
          <ellipse cx="70%" cy="40%" rx="400" ry="400" fill="url(#fbGlow)" />
          <ellipse cx="30%" cy="70%" rx="300" ry="300" fill="url(#fbGlow)" opacity="0.6"/>
        </svg>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      overflow: hidden;
      background: var(--bg);
    }
    .hero-scene-host {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    .hero-scene-fallback, .fallback-svg {
      width: 100%;
      height: 100%;
    }
    ::ng-deep .canvas-ready {
      transition: opacity 1.5s ease-out;
      opacity: 1 !important;
    }
    ::ng-deep canvas {
      opacity: 0;
    }
  `]
})
export class HeroSceneComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;

  state: SceneState = 'idle';
  isMobile = false;

  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  private renderer: any = null;
  private scene: any = null;
  private camera: any = null;
  
  private particles: any = null;
  private linesMesh: any = null;
  private particlePositions: Float32Array | null = null;
  private particleVelocities: Float32Array | null = null;
  
  private hostWidth = 0;
  private hostHeight = 0;

  private revealStart: number | null = null;
  private reducedMotion = false;
  private motionQuery: MediaQueryList | null = null;
  private motionListener = (e: MediaQueryListEvent) => {
    this.reducedMotion = e.matches;
    if (this.reducedMotion && this.renderer) {
      this.state = 'reduced-motion';
      this.renderOnce();
    }
  };

  private visibilityObserver: IntersectionObserver | null = null;
  private rafScrollId: number | null = null;
  private scrollProgress = 0;

  /**
   * Per-section fade for this component's particle plexus canvas only.
   * The Hero storytelling wrapper now drives the laptop + tech nodes
   * independently, so the per-section opacity logic is owned here.
   * Desktop only — on mobile the particle plexus renders once and stays.
   */
  private static readonly SECTION_OPACITY: ReadonlyArray<{ id: string; opacity: number }> = [
    { id: 'home',       opacity: 1.00 },
    { id: 'about',      opacity: 0.85 },
    { id: 'experience', opacity: 0.70 },
    { id: 'skills',     opacity: 0.50 },
    { id: 'projects',   opacity: 0.30 },
    { id: 'contact',    opacity: 0.10 },
  ];
  private sectionFadeObserver: IntersectionObserver | null = null;
  private currentSectionOpacity: number | null = null;

  private pointerHandler = (e: PointerEvent) => this.onPointerMove(e);
  private pointerLeaveHandler = () => this.resetPointer();
  private pointerActive = false;
  private pointerNormX = 0;
  private pointerNormY = 0;
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;

  private resizeObserver: ResizeObserver | null = null;
  private canvasEl: HTMLCanvasElement | null = null;

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    this.detectViewport();
    this.setupReducedMotion();
    this.setupVisibilityObserver();
    this.setupResizeObserver();
    this.setupSectionFade();
  }

  private detectViewport(): void {
    const w = window.innerWidth;
    this.isMobile = w < 768;
  }

  private setupReducedMotion(): void {
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener('change', this.motionListener);
  }

  private setupVisibilityObserver(): void {
    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            this.pause();
            continue;
          }
          if (this.state === 'idle') {
            this.state = 'loading';
            this.cdr.markForCheck();
            void this.init();
          } else if (this.state === 'paused') {
            this.resume();
          }
        }
      },
      { threshold: 0.05, rootMargin: '0px 0px -8% 0px' }
    );
    this.visibilityObserver.observe(this.hostRef.nativeElement);
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.onResize();
    });
    this.resizeObserver.observe(this.hostRef.nativeElement);
  }

  /**
   * Per-section opacity fade for *this component's* particle canvas only.
   * Each section gets a target opacity; when the section is centered in the
   * viewport, the canvas is faded accordingly. No scroll listener, no
   * getBoundingClientRect — pure IntersectionObserver, scoped to this canvas.
   */
  private setupSectionFade(): void {
    if (this.isMobile) return;

    const sectionIds = HeroSceneComponent.SECTION_OPACITY.map((s) => s.id);
    const sectionEls: HTMLElement[] = [];
    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (el) sectionEls.push(el);
    }
    if (sectionEls.length === 0) return;

    const applyOpacity = (opacity: number) => {
      if (this.currentSectionOpacity === opacity) return;
      this.currentSectionOpacity = opacity;
      if (this.canvasEl) this.canvasEl.style.opacity = String(opacity);
    };

    for (const el of sectionEls) {
      const entry = HeroSceneComponent.SECTION_OPACITY.find((s) => s.id === el.id);
      if (!entry) continue;
      const target = entry.opacity;
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) applyOpacity(target);
          }
        },
        { threshold: 0, rootMargin: '-30% 0px -55% 0px' }
      );
      obs.observe(el);
    }
  }

  private async init(): Promise<void> {
    try {
      const THREE: any = await import('three');
      if (!this.canCreateWebGLContext()) {
        this.state = 'fallback';
        this.cdr.markForCheck();
        return;
      }
      this.buildRenderer(THREE);
      this.buildScene(THREE);
      this.state = 'ready';
      this.cdr.markForCheck();

      if (this.reducedMotion) {
        this.state = 'reduced-motion';
        this.renderOnce();
        return;
      }

      this.startEntrance();
    } catch (err) {
      console.info('[hero-scene] WebGL unavailable, using SVG fallback', err);
      this.state = 'fallback';
      this.cdr.markForCheck();
    }
  }

  private canCreateWebGLContext(): boolean {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl'));
  }

  private buildRenderer(THREE: any): void {
    const host = this.hostRef.nativeElement;
    const rect = host.getBoundingClientRect();
    this.hostWidth = rect.width;
    this.hostHeight = rect.height;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(this.hostWidth, this.hostHeight, false);
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.classList.add('hero-3d-canvas');
    host.appendChild(canvas);
    this.canvasEl = canvas;
    this.renderer = renderer;
  }

  private buildScene(THREE: any): void {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02040a, 0.05);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(60, this.hostWidth / Math.max(1, this.hostHeight), 0.1, 100);
    camera.position.set(0, 0, 15);
    this.camera = camera;

    // Cinematic Particle Plexus
    const particleCount = this.isMobile ? 50 : 100;
    const maxRadius = 22;
    
    this.particlePositions = new Float32Array(particleCount * 3);
    this.particleVelocities = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      // Spread particles in a wide volume, slightly biased to the right
      this.particlePositions[i3] = (Math.random() - 0.3) * maxRadius * 2;
      this.particlePositions[i3 + 1] = (Math.random() - 0.5) * maxRadius;
      this.particlePositions[i3 + 2] = (Math.random() - 0.5) * maxRadius;
      
      this.particleVelocities[i3] = (Math.random() - 0.5) * 0.02;
      this.particleVelocities[i3 + 1] = (Math.random() - 0.5) * 0.02;
      this.particleVelocities[i3 + 2] = (Math.random() - 0.5) * 0.02;
    }

    const pGeom = new THREE.BufferGeometry();
    pGeom.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    
    // Electric blue points
    const pMat = new THREE.PointsMaterial({
      color: 0x3b82f6,
      size: 0.15,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending
    });
    
    this.particles = new THREE.Points(pGeom, pMat);
    scene.add(this.particles);

    // Lines for plexus
    const maxConnections = particleCount * 4;
    const linePositions = new Float32Array(maxConnections * 3 * 2);
    const lineColors = new Float32Array(maxConnections * 3 * 2);
    
    const lGeom = new THREE.BufferGeometry();
    lGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lGeom.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    
    const lMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending
    });
    
    this.linesMesh = new THREE.LineSegments(lGeom, lMat);
    scene.add(this.linesMesh);
  }

  private startEntrance(): void {
    this.revealStart = performance.now();
    this.state = 'revealing';
    this.cdr.markForCheck();
    this.ngZone.runOutsideAngular(() => {
      this.renderer.setAnimationLoop((t: number) => this.tick(t));
    });
    requestAnimationFrame(() => {
      this.canvasEl?.classList.add('canvas-ready');
    });
  }

  private tick(time: number): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    const now = time || performance.now();
    
    this.updateEntrance(now);
    this.updateParticles();
    this.updatePointer();
    this.updateScrollCamera();
    
    this.renderer.render(this.scene, this.camera);
  }

  private updateEntrance(now: number): void {
    if (this.revealStart === null) return;
    const t = now - this.revealStart;
    
    if (t > 500 && this.particles?.material) {
      const p = Math.min(1, (t - 500) / 2000);
      this.particles.material.opacity = p * 0.4;
      if (this.linesMesh?.material) {
        this.linesMesh.material.opacity = p * 0.15;
      }
    }
    
    if (t >= 2500 && this.state === 'revealing') {
      this.state = 'idle-loop';
      this.cdr.markForCheck();
      this.attachPointerListeners();
    }
  }

  private updateParticles(): void {
    if (!this.particlePositions || !this.particleVelocities || !this.particles || !this.linesMesh) return;
    
    const positions = this.particlePositions;
    const velocities = this.particleVelocities;
    const count = positions.length / 3;
    const range = 18;
    
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] += velocities[i3];
      positions[i3 + 1] += velocities[i3 + 1];
      positions[i3 + 2] += velocities[i3 + 2];
      
      // Wrap
      if (positions[i3] > range) positions[i3] = -range;
      if (positions[i3] < -range) positions[i3] = range;
      if (positions[i3+1] > range) positions[i3+1] = -range;
      if (positions[i3+1] < -range) positions[i3+1] = range;
      if (positions[i3+2] > range) positions[i3+2] = -range;
      if (positions[i3+2] < -range) positions[i3+2] = range;
    }
    
    this.particles.geometry.attributes.position.needsUpdate = true;
    
    // Rebuild lines
    const linePositions = this.linesMesh.geometry.attributes.position.array as Float32Array;
    const lineColors = this.linesMesh.geometry.attributes.color.array as Float32Array;
    
    let vertexpos = 0;
    let colorpos = 0;
    const connectDistance = this.isMobile ? 3.0 : 4.5;
    
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      for (let j = i + 1; j < count; j++) {
        const j3 = j * 3;
        const dx = positions[i3] - positions[j3];
        const dy = positions[i3+1] - positions[j3+1];
        const dz = positions[i3+2] - positions[j3+2];
        const distSq = dx*dx + dy*dy + dz*dz;
        
        if (distSq < connectDistance * connectDistance) {
          const alpha = 1.0 - Math.sqrt(distSq) / connectDistance;
          
          linePositions[vertexpos++] = positions[i3];
          linePositions[vertexpos++] = positions[i3+1];
          linePositions[vertexpos++] = positions[i3+2];
          
          linePositions[vertexpos++] = positions[j3];
          linePositions[vertexpos++] = positions[j3+1];
          linePositions[vertexpos++] = positions[j3+2];
          
          // Color 0x3b82f6 -> r: 0.23, g: 0.51, b: 0.96
          lineColors[colorpos++] = 0.23; lineColors[colorpos++] = 0.51; lineColors[colorpos++] = 0.96;
          lineColors[colorpos++] = 0.23; lineColors[colorpos++] = 0.51; lineColors[colorpos++] = 0.96;
        }
      }
    }
    
    this.linesMesh.geometry.setDrawRange(0, vertexpos / 3);
    this.linesMesh.geometry.attributes.position.needsUpdate = true;
    this.linesMesh.geometry.attributes.color.needsUpdate = true;
    
    // Scene subtle rotation
    this.scene.rotation.y += 0.001;
    this.scene.rotation.x += 0.0005;
  }

  private updatePointer(): void {
    if (!this.camera) return;
    const pointerK = this.state === 'idle-loop' ? 1 : 0;
    this.targetX = this.pointerNormX * 2.0 * pointerK;
    this.targetY = this.pointerNormY * 2.0 * pointerK;
    
    this.currentX += (this.targetX - this.currentX) * 0.05;
    this.currentY += (this.targetY - this.currentY) * 0.05;
    
    this.camera.position.x = this.currentX;
    this.camera.position.y = this.currentY;
    this.camera.lookAt(0, 0, 0);
  }

  private updateScrollCamera(): void {
    if (!this.camera) return;
    const z = 15 + this.scrollProgress * 10;
    if (this.state === 'idle-loop' || this.state === 'paused') {
      this.camera.position.z = z;
    }
  }

  private pause(): void {
    if (this.state !== 'revealing' && this.state !== 'idle-loop') return;
    this.state = 'paused';
    this.renderer?.setAnimationLoop(null);
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'idle-loop';
    this.cdr.markForCheck();
    this.ngZone.runOutsideAngular(() => {
      this.renderer.setAnimationLoop((t: number) => this.tick(t));
    });
  }

  private attachPointerListeners(): void {
    if (this.pointerActive) return;
    document.addEventListener('pointermove', this.pointerHandler, { passive: true });
    document.addEventListener('pointerleave', this.pointerLeaveHandler, { passive: true });
    window.addEventListener('scroll', () => {
       if (this.rafScrollId === null) {
         this.rafScrollId = requestAnimationFrame(() => {
           this.rafScrollId = null;
           const docH = document.documentElement.scrollHeight;
           const winH = window.innerHeight;
           const max = Math.max(1, docH - winH);
           this.scrollProgress = Math.max(0, Math.min(1, window.scrollY / max));
         });
       }
    }, { passive: true });
    this.pointerActive = true;
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.hostRef) return;
    const rect = this.hostRef.nativeElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    this.pointerNormX = (nx - 0.5) * 2;
    this.pointerNormY = (ny - 0.5) * 2;
  }

  private resetPointer(): void {
    this.pointerNormX = 0;
    this.pointerNormY = 0;
  }

  private onResize(): void {
    if (!this.renderer || !this.camera) return;
    const rect = this.hostRef.nativeElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.hostWidth = rect.width;
    this.hostHeight = rect.height;
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  private renderOnce(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    if (this.particles?.material) this.particles.material.opacity = 0.4;
    if (this.linesMesh?.material) this.linesMesh.material.opacity = 0.15;
    this.canvasEl?.classList.add('canvas-ready');
    this.renderer.render(this.scene, this.camera);
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;
    this.motionQuery?.removeEventListener('change', this.motionListener);
    this.visibilityObserver?.disconnect();
    this.resizeObserver?.disconnect();
    document.removeEventListener('pointermove', this.pointerHandler);
    document.removeEventListener('pointerleave', this.pointerLeaveHandler);
    if (this.rafScrollId !== null) cancelAnimationFrame(this.rafScrollId);

    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    if (this.particles) {
      this.particles.geometry.dispose();
      this.particles.material.dispose();
    }
    if (this.linesMesh) {
      this.linesMesh.geometry.dispose();
      this.linesMesh.material.dispose();
    }
  }
}
