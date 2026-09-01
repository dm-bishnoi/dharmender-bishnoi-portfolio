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
import { HeroVisualComponent } from '../hero-visual/hero-visual.component';

/**
 * Three.js Angular architecture visualization.
 *
 * Renders a 5×7-style network: a glowing core surrounded by orbital
 * "component" nodes, connected by thin lines, with subtle data
 * particles drifting in the volume. Lives as a background layer
 * behind the hero's editorial typography.
 *
 * Lifecycle (state machine):
 *   idle → loading → ready → revealing → idle-loop
 *                              ↓         ↓
 *                           paused    (off-screen, or 1-frame
 *                            ↓         reduced-motion render)
 *                          fallback (WebGL fail / low-power)
 *
 * Trigger: the hero's `IntersectionObserver` flips `isIntersecting`
 * to true on first paint. The component:
 *   1. dynamically imports `three` (no main-bundle cost);
 *   2. probes WebGL availability;
 *   3. builds the scene + camera + lights + geometry;
 *   4. starts the entrance timeline driven by `performance.now()`.
 *
 * The entrance runs **without** any user pointer activity — the hero
 * is animated on its own the moment it becomes visible.
 *
 * Pointer interaction is **additive**, not required: after the
 * entrance completes, a `document`-level (passive) pointermove
 * listener applies a small camera delta. The scene host has
 * `pointer-events: none` so it never blocks the hero's text/CTA.
 *
 * Cleanup (`ngOnDestroy`) disposes geometries, materials, the renderer,
 * and the WebGL context to prevent GPU memory leaks.
 */
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
  imports: [CommonModule, HeroVisualComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hero-scene.component.html',
  styleUrl: './hero-scene.component.css',
})
export class HeroSceneComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;

  /** Public state used by the template to show the fallback. */
  state: SceneState = 'idle';
  /** Mobile viewport flag — read once at init. */
  isMobile = false;

  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  // ── Three.js handles (set on successful init) ──────────
  private renderer: any = null;
  private scene: any = null;
  private camera: any = null;
  private core: any = null;
  private innerNodes: any[] = [];
  private outerNodes: any[] = [];
  private innerLines: any[] = [];
  private outerLines: any[] = [];
  private pointsObj: any = null;
  private pointsVelocities: Float32Array | null = null;
  private hostWidth = 0;
  private hostHeight = 0;

  // ── Animation timing ───────────────────────────────────
  /** performance.now() of the entrance start, or null. */
  private revealStart: number | null = null;
  /** Has the entrance ever run? Prevents re-entrance on re-visibility. */
  private entranceStarted = false;
  /** Reduced motion preference. */
  private reducedMotion = false;
  private motionQuery: MediaQueryList | null = null;
  private motionListener = (e: MediaQueryListEvent) => {
    this.reducedMotion = e.matches;
    if (this.reducedMotion && this.renderer) {
      this.state = 'reduced-motion';
      this.renderOnce();
    }
  };

  // ── Visibility & scroll ────────────────────────────────
  private visibilityObserver: IntersectionObserver | null = null;
  private scrollHandler = () => this.scheduleScrollUpdate();
  private rafScrollId: number | null = null;
  private scrollProgress = 0;

  // ── Pointer (document-level, passive) ──────────────────
  private pointerHandler = (e: PointerEvent) => this.onPointerMove(e);
  private pointerLeaveHandler = () => this.resetPointer();
  private pointerActive = false;
  private pointerNormX = 0;
  private pointerNormY = 0;
  /** Camera target offset (interpolated). */
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;

  // ── Resize ─────────────────────────────────────────────
  private resizeObserver: ResizeObserver | null = null;

  // ── Reference to the rendered canvas (for opacity class) ─
  private canvasEl: HTMLCanvasElement | null = null;

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    this.detectViewport();
    this.setupReducedMotion();
    this.setupVisibilityObserver();
    this.setupResizeObserver();
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
          // First entry: kick off the lazy import + init.
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

  // ── Init: lazy import + build ──────────────────────────
  private async init(): Promise<void> {
    // Force-fallback via query string (used by QA).
    const search = new URLSearchParams(window.location.search);
    if (search.get('noWebGL') === '1') {
      this.state = 'fallback';
      this.cdr.markForCheck();
      return;
    }

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
    const ctx =
      probe.getContext('webgl2') ||
      probe.getContext('webgl') ||
      probe.getContext('experimental-webgl');
    return !!ctx;
  }

  private buildRenderer(THREE: any): void {
    const host = this.hostRef.nativeElement;
    const rect = host.getBoundingClientRect();
    this.hostWidth = rect.width;
    this.hostHeight = rect.height;

    const renderer = new THREE.WebGLRenderer({
      antialias: !this.isMobile,
      alpha: true,
      powerPreference: this.isMobile ? 'low-power' : 'high-performance',
    });
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.isMobile ? 1.25 : 2)
    );
    renderer.setSize(this.hostWidth, this.hostHeight, false);
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.appendChild(canvas);
    this.canvasEl = canvas;
    this.renderer = renderer;
  }

  private buildScene(THREE: any): void {
    const palette = this.readPalette();

    const scene = new THREE.Scene();
    scene.background = null;
    scene.fog = new THREE.Fog(0x06080f, 6, 14);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      this.hostWidth / Math.max(1, this.hostHeight),
      0.1,
      100
    );
    camera.position.set(0, 0, 7);
    camera.lookAt(0, 0, 0);
    this.camera = camera;

    // ── Lights ──────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0x1a2238, 0.6);
    scene.add(ambient);

    const keyLight = new THREE.PointLight(parseInt(palette.blue2.replace('#', '0x')), 1.4, 12);
    keyLight.position.set(2, 2, 2);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(parseInt(palette.blueD.replace('#', '0x')), 0.8, 14);
    fillLight.position.set(-3, -1, -1);
    scene.add(fillLight);

    // ── Core: glowing icosahedron ───────────────────────
    const coreGeom = new THREE.IcosahedronGeometry(1.0, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x1a2238,
      emissive: parseInt(palette.blueD.replace('#', '0x')),
      emissiveIntensity: 0.5,
      metalness: 0.2,
      roughness: 0.4,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    core.scale.setScalar(0); // start at 0; entrance scales it up
    scene.add(core);
    this.core = core;

    // ── Inner ring nodes (4) ────────────────────────────
    const innerCount = 4;
    const innerRadius = 2.4;
    const innerNodeGeom = new THREE.OctahedronGeometry(0.18);
    const innerNodeMat = new THREE.MeshStandardMaterial({
      color: parseInt(palette.blue2.replace('#', '0x')),
      emissive: parseInt(palette.blueD.replace('#', '0x')),
      emissiveIntensity: 0.4,
      metalness: 0.4,
      roughness: 0.5,
    });
    for (let i = 0; i < innerCount; i++) {
      const angle = (i / innerCount) * Math.PI * 2;
      const node = new THREE.Mesh(innerNodeGeom, innerNodeMat);
      node.position.set(
        Math.cos(angle) * innerRadius,
        Math.sin(angle * 0.7) * 0.5,
        Math.sin(angle) * innerRadius
      );
      node.scale.setScalar(0);
      scene.add(node);
      this.innerNodes.push(node);
    }

    // ── Outer ring nodes (4) — desktop/tablet only ──────
    const outerCount = 4;
    const outerRadius = 3.6;
    const outerNodeGeom = new THREE.OctahedronGeometry(0.14);
    const outerNodeMat = new THREE.MeshStandardMaterial({
      color: parseInt(palette.blue2.replace('#', '0x')),
      emissive: parseInt(palette.blueD.replace('#', '0x')),
      emissiveIntensity: 0.3,
      metalness: 0.4,
      roughness: 0.5,
    });
    if (!this.isMobile) {
      for (let i = 0; i < outerCount; i++) {
        const angle = (i / outerCount) * Math.PI * 2 + Math.PI / 4;
        const node = new THREE.Mesh(outerNodeGeom, outerNodeMat);
        node.position.set(
          Math.cos(angle) * outerRadius,
          Math.sin(angle * 0.5 + 1.2) * 0.7,
          Math.sin(angle) * outerRadius
        );
        node.scale.setScalar(0);
        scene.add(node);
        this.outerNodes.push(node);
      }
    }

    // ── Connection lines (core → each node) ─────────────
    const lineColor = parseInt(palette.trace.replace('#', '0x'));
    const lineMaterialBase = new THREE.LineBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.0, // animated in during entrance
    });

    const buildLine = (from: any, to: any, baseMat: any) => {
      const geom = new THREE.BufferGeometry().setFromPoints([
        from.position.clone(),
        to.position.clone(),
      ]);
      const mat = baseMat.clone();
      mat.opacity = 0;
      const line = new THREE.Line(geom, mat);
      this.scene.add(line);
      return line;
    };

    // We need separate materials per line so opacity can be animated
    // independently.
    for (const node of this.innerNodes) {
      this.innerLines.push(buildLine(this.core, node, lineMaterialBase));
    }
    for (const node of this.outerNodes) {
      this.outerLines.push(buildLine(this.core, node, lineMaterialBase));
    }

    // ── Data particles ──────────────────────────────────
    const particleCount = this.isMobile ? 28 : this.hostWidth < 1024 ? 40 : 80;
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const range = 4.5;
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * range * 2;
      positions[i3 + 1] = (Math.random() - 0.5) * range * 1.2;
      positions[i3 + 2] = (Math.random() - 0.5) * range * 2;
      velocities[i3] = (Math.random() - 0.5) * 0.0008;
      velocities[i3 + 1] = (Math.random() - 0.5) * 0.0006;
      velocities[i3 + 2] = (Math.random() - 0.5) * 0.0008;
    }
    this.pointsVelocities = velocities;

    const pointsGeom = new THREE.BufferGeometry();
    pointsGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pointsMat = new THREE.PointsMaterial({
      color: parseInt(palette.blue2.replace('#', '0x')),
      size: 0.04,
      transparent: true,
      opacity: 0.5,
      sizeAttenuation: true,
    });
    this.pointsObj = new THREE.Points(pointsGeom, pointsMat);
    scene.add(this.pointsObj);
  }

  private readPalette(): { ink: string; blue: string; blue2: string; blueD: string; trace: string } {
    const css = getComputedStyle(document.documentElement);
    const get = (name: string, fallback: string) => {
      const v = css.getPropertyValue(name).trim();
      return v || fallback;
    };
    return {
      ink: get('--ink', '#e6ecf5'),
      blue: get('--blue', '#569cff'),
      blue2: get('--blue-2', '#7eb1ff'),
      blueD: get('--blue-deep', '#2b6cff'),
      trace: get('--trace', '#3d5a8c'),
    };
  }

  // ── Entrance ──────────────────────────────────────────
  private startEntrance(): void {
    this.entranceStarted = true;
    this.revealStart = performance.now();
    this.state = 'revealing';
    this.cdr.markForCheck();
    this.scheduleScrollUpdate();
    this.ngZone.runOutsideAngular(() => {
      this.renderer.setAnimationLoop((t: number) => this.tick(t));
    });
    // Reveal the canvas as it begins painting.
    requestAnimationFrame(() => {
      this.canvasEl?.classList.add('canvas-ready');
    });
  }

  private tick(time: number): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    const now = time || performance.now();
    this.updateEntrance(now);
    this.updateIdle(now);
    this.updatePointer();
    this.updateScrollCamera();
    this.updateParticles();
    this.renderer.render(this.scene, this.camera);
  }

  private updateEntrance(now: number): void {
    if (this.revealStart === null) return;
    const t = now - this.revealStart;
    const dur = this.revealDuration();

    // 0ms: canvas opacity 0 → 1 (handled by CSS, but we read it as "ready")

    // 150ms: core scales 0 → 1 over 700ms
    if (t >= 150) {
      const ct = Math.min(1, (t - 150) / 700);
      const eased = this.easeOutCubic(ct);
      this.core.scale.setScalar(eased);
    }

    // 350ms: first inner node, then 500/580/660ms remaining (80ms stagger)
    for (let i = 0; i < this.innerNodes.length; i++) {
      const start = 350 + i * 80;
      if (t >= start) {
        const ct = Math.min(1, (t - start) / 300);
        const eased = this.easeOutBack(ct);
        this.innerNodes[i].scale.setScalar(eased);
      }
    }

    // 700ms: inner lines reveal (staggered 80ms), opacity 0 → 0.6 over 600ms
    for (let i = 0; i < this.innerLines.length; i++) {
      const start = 700 + i * 80;
      if (t >= start) {
        const ct = Math.min(1, (t - start) / 600);
        this.innerLines[i].material.opacity = ct * 0.6;
      }
    }

    // 1050ms: outer nodes + outer lines (staggered 80ms each)
    for (let i = 0; i < this.outerNodes.length; i++) {
      const start = 1050 + i * 80;
      if (t >= start) {
        const ct = Math.min(1, (t - start) / 300);
        const eased = this.easeOutBack(ct);
        this.outerNodes[i].scale.setScalar(eased);
      }
    }
    for (let i = 0; i < this.outerLines.length; i++) {
      const start = 1050 + i * 80;
      if (t >= start) {
        const ct = Math.min(1, (t - start) / 600);
        this.outerLines[i].material.opacity = ct * 0.55;
      }
    }

    // 1700ms: camera pull-in z 7 → 6 over 1500ms
    if (t >= 1700 && t < 1700 + 1500) {
      const ct = (t - 1700) / 1500;
      this.camera.position.z = 7 + (6 - 7) * this.easeInOutCubic(ct);
    } else if (t >= 3200) {
      // Stay at 6 (the idle camera will continue to drift on top of this)
      this.camera.position.z = 6;
    }

    // 2600ms: transition to idle-loop
    if (t >= 2600 && this.state === 'revealing') {
      this.state = 'idle-loop';
      this.cdr.markForCheck();
      // Once entrance is complete, enable pointer listening.
      this.attachPointerListeners();
    }
  }

  private updateIdle(now: number): void {
    if (this.state !== 'idle-loop') return;
    // Core oscillates ±2° on Y axis (12s period).
    if (this.core) {
      const phase = (now / 12000) * Math.PI * 2;
      this.core.rotation.y = Math.sin(phase) * 0.034; // ~2°
    }
  }

  private updatePointer(): void {
    if (!this.camera) return;
    // Subtle camera deltas (5 overlapping sine waves, RMS ≤ 0.3).
    const now = performance.now();
    const t = now / 1000;
    const idleX =
      Math.sin(t * 0.31) * 0.08 +
      Math.sin(t * 0.17 + 1.2) * 0.06 +
      Math.sin(t * 0.07 + 2.4) * 0.05;
    const idleY =
      Math.cos(t * 0.27) * 0.06 +
      Math.cos(t * 0.13 + 0.7) * 0.05 +
      Math.sin(t * 0.05 + 1.8) * 0.04;
    // Pointer contribution only after entrance completes.
    const pointerK = this.state === 'idle-loop' ? 1 : 0;
    const targetX = idleX + this.pointerNormX * 0.25 * pointerK;
    const targetY = idleY + this.pointerNormY * 0.18 * pointerK;
    this.targetX = targetX;
    this.targetY = targetY;
    // Smooth interpolation.
    this.currentX += (this.targetX - this.currentX) * 0.04;
    this.currentY += (this.targetY - this.currentY) * 0.04;
    this.camera.position.x = this.currentX;
    this.camera.position.y = this.currentY;
    this.camera.lookAt(0, 0, 0);
  }

  private updateScrollCamera(): void {
    if (!this.camera) return;
    // Scroll lerp: z 6 → 8 as scroll progress 0 → 1 (added on top of
    // any entrance z value). Entrance sets z to 6 at t≥3200.
    const z = 6 + this.scrollProgress * 2;
    // Only override if entrance is complete.
    if (this.state === 'idle-loop' || this.state === 'paused') {
      this.camera.position.z = z;
    }
  }

  private updateParticles(): void {
    if (!this.pointsObj || !this.pointsVelocities) return;
    const positions: Float32Array = this.pointsObj.geometry.attributes.position.array;
    const v = this.pointsVelocities;
    for (let i = 0; i < v.length; i++) {
      positions[i] += v[i];
    }
    // Wrap particles around the volume.
    for (let i = 0; i < positions.length; i += 3) {
      const range = 4.5;
      if (positions[i] > range) positions[i] = -range;
      if (positions[i] < -range) positions[i] = range;
      if (positions[i + 1] > range * 0.6) positions[i + 1] = -range * 0.6;
      if (positions[i + 1] < -range * 0.6) positions[i + 1] = range * 0.6;
      if (positions[i + 2] > range) positions[i + 2] = -range;
      if (positions[i + 2] < -range) positions[i + 2] = range;
    }
    this.pointsObj.geometry.attributes.position.needsUpdate = true;
  }

  // ── Lifecycle helpers ─────────────────────────────────
  private revealDuration(): number {
    // We don't actually use this constant — timings are inlined per element.
    return 2600;
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }
  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  private easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
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
    window.addEventListener('scroll', this.scrollHandler, { passive: true });
    this.pointerActive = true;
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.hostRef) return;
    const rect = this.hostRef.nativeElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.pointerNormX = 0;
      this.pointerNormY = 0;
      return;
    }
    const nx = (e.clientX - rect.left) / rect.width; // 0..1
    const ny = (e.clientY - rect.top) / rect.height; // 0..1
    this.pointerNormX = (nx - 0.5) * 2; // -1..1
    this.pointerNormY = (ny - 0.5) * 2;
  }

  private resetPointer(): void {
    this.pointerNormX = 0;
    this.pointerNormY = 0;
  }

  private scheduleScrollUpdate(): void {
    if (this.rafScrollId !== null) return;
    this.rafScrollId = requestAnimationFrame(() => {
      this.rafScrollId = null;
      this.computeScrollProgress();
    });
  }

  private computeScrollProgress(): void {
    const docH = document.documentElement.scrollHeight;
    const winH = window.innerHeight;
    const max = Math.max(1, docH - winH);
    const p = Math.max(0, Math.min(1, window.scrollY / max));
    this.scrollProgress = p;
  }

  private onResize(): void {
    if (!this.renderer || !this.camera) return;
    const rect = this.hostRef.nativeElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w === 0 || h === 0) return;
    this.hostWidth = w;
    this.hostHeight = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private renderOnce(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    // For reduced motion: render one static frame at the "final"
    // composition, then stop the loop.
    this.core?.scale.setScalar(1);
    for (const n of this.innerNodes) n.scale.setScalar(1);
    for (const n of this.outerNodes) n.scale.setScalar(1);
    for (const l of this.innerLines) (l.material as any).opacity = 0.6;
    for (const l of this.outerLines) (l.material as any).opacity = 0.55;
    this.camera.position.set(0, 0, 6);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setAnimationLoop(null);
  }

  ngOnDestroy(): void {
    this.visibilityObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.motionQuery?.removeEventListener('change', this.motionListener);
    document.removeEventListener('pointermove', this.pointerHandler);
    document.removeEventListener('pointerleave', this.pointerLeaveHandler);
    window.removeEventListener('scroll', this.scrollHandler);
    if (this.rafScrollId !== null) {
      cancelAnimationFrame(this.rafScrollId);
      this.rafScrollId = null;
    }
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      const scene: any = this.scene;
      scene?.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose?.();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m: any) => m?.dispose?.());
        else if (mat?.dispose) mat.dispose?.();
      });
      this.renderer.dispose();
      try {
        this.renderer.forceContextLoss?.();
      } catch {
        // Some Three.js builds may not expose forceContextLoss; safe to ignore.
      }
      if (this.canvasEl?.parentNode) {
        this.canvasEl.parentNode.removeChild(this.canvasEl);
      }
      this.canvasEl = null;
      this.renderer = null;
      this.scene = null;
      this.camera = null;
    }
    this.core = null;
    this.innerNodes = [];
    this.outerNodes = [];
    this.innerLines = [];
    this.outerLines = [];
    this.pointsObj = null;
    this.pointsVelocities = null;
  }
}
