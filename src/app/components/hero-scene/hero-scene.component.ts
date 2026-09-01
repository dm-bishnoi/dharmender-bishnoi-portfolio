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
  /** Core icosahedron + edge wireframe. */
  private core: {
    mesh: any;
    line: any;
    edgeMat: any;
    fillMat: any;
  } | null = null;
  /** Module/architecture nodes (orbit around core). */
  private innerNodes: any[] = [];
  /** Connection lines (core → each module node). */
  private innerLines: any[] = [];
  /** Architecture torus rings at different radii. */
  private archRings: any[] = [];
  private pointsObj: any = null;
  private pointsVelocities: Float32Array | null = null;
  /** Per-line flowing data particles. */
  private flowParticles: Array<{
    obj: any;
    positions: Float32Array;
    progress: Float32Array;
    speed: Float32Array;
    fromVec: any;
    toVec: any;
  }> = [];
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
    const blue2Hex = parseInt(palette.blue2.replace('#', '0x'));
    const blueHex = parseInt(palette.blue.replace('#', '0x'));
    const blueDeepHex = parseInt(palette.blueD.replace('#', '0x'));
    const traceHex = parseInt(palette.trace.replace('#', '0x'));

    const scene = new THREE.Scene();
    scene.background = null;
    scene.fog = new THREE.Fog(0x05080f, 5, 13);
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
    const ambient = new THREE.AmbientLight(0x0a1224, 0.5);
    scene.add(ambient);

    const keyLight = new THREE.PointLight(blue2Hex, 1.2, 12);
    keyLight.position.set(2.5, 2.5, 2);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(blueDeepHex, 0.7, 14);
    fillLight.position.set(-3, -1.5, -1);
    scene.add(fillLight);

    // ── Core: icosahedron with edge highlights (architectural feel) ──
    const coreGeom = new THREE.IcosahedronGeometry(1.0, 1);
    const coreFillMat = new THREE.MeshStandardMaterial({
      color: 0x060a1a,
      transparent: true,
      opacity: 0.65,
      metalness: 0.4,
      roughness: 0.5,
    });
    const coreMesh = new THREE.Mesh(coreGeom, coreFillMat);
    coreMesh.scale.setScalar(0);
    scene.add(coreMesh);

    // Edge lines on the icosahedron — the architectural wireframe
    const coreEdges = new THREE.EdgesGeometry(coreGeom);
    const coreLineMat = new THREE.LineBasicMaterial({
      color: blue2Hex,
      transparent: true,
      opacity: 0,
    });
    const coreLines = new THREE.LineSegments(coreEdges, coreLineMat);
    coreLines.scale.setScalar(0);
    scene.add(coreLines);

    this.core = { mesh: coreMesh, line: coreLines, edgeMat: coreLineMat, fillMat: coreFillMat };

    // ── Architecture torus rings ────────────────────────
    // 3 tori at increasing radii, slightly tilted, slow rotation.
    const torusSpecs = [
      { radius: 1.6, tube: 0.012, tilt: 0.4,  spin: 0.0008, peakOp: 0.30 },
      { radius: 2.5, tube: 0.010, tilt: -0.3, spin: -0.0006, peakOp: 0.18 },
      { radius: 3.5, tube: 0.008, tilt: 0.6,  spin: 0.0004, peakOp: 0.10 },
    ];
    for (let i = 0; i < torusSpecs.length; i++) {
      const spec = torusSpecs[i];
      const geom = new THREE.TorusGeometry(spec.radius, spec.tube, 8, 128);
      const mat = new THREE.MeshBasicMaterial({
        color: blueHex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(geom, mat);
      ring.rotation.x = Math.PI / 2 + spec.tilt;
      ring.rotation.z = i * 0.4;
      ring.userData.spinSpeed = spec.spin;
      ring.userData.peakOpacity = spec.peakOp;
      scene.add(ring);
      this.archRings.push(ring);
    }

    // ── Module nodes — abstract geometric shapes ─────────
    // 6 desktop / 4 mobile. Different geometries (box, oct, tetra) for visual variety.
    const moduleCount = this.isMobile ? 4 : 6;
    const moduleRadius = 2.3;
    const moduleGeoms = [
      new THREE.BoxGeometry(0.22, 0.22, 0.22),
      new THREE.OctahedronGeometry(0.18),
      new THREE.TetrahedronGeometry(0.2),
    ];
    for (let i = 0; i < moduleCount; i++) {
      const angle = (i / moduleCount) * Math.PI * 2;
      const r = moduleRadius + (i % 2 === 0 ? 0 : 0.35);
      const geom = moduleGeoms[i % moduleGeoms.length];
      const mat = new THREE.MeshStandardMaterial({
        color: blue2Hex,
        emissive: blueHex,
        emissiveIntensity: 0.35,
        metalness: 0.5,
        roughness: 0.4,
        transparent: true,
        opacity: 0,
      });
      const node = new THREE.Mesh(geom, mat);
      node.position.set(
        Math.cos(angle) * r,
        Math.sin(angle * 0.7) * 0.5,
        Math.sin(angle) * r
      );
      node.userData.orbitAngle = angle;
      node.userData.orbitSpeed = 0.00006 + (i % 3) * 0.00004;
      node.userData.floatPhase = i * 1.1;
      node.scale.setScalar(0);
      scene.add(node);
      this.innerNodes.push(node);
    }

    // ── Connection lines: core → each module ────────────
    const lineMaterialBase = new THREE.LineBasicMaterial({
      color: traceHex,
      transparent: true,
      opacity: 0.0,
    });
    const buildLine = (from: any, to: any) => {
      const geom = new THREE.BufferGeometry().setFromPoints([
        from.position.clone(),
        to.position.clone(),
      ]);
      const mat = lineMaterialBase.clone();
      mat.opacity = 0;
      const line = new THREE.Line(geom, mat);
      scene.add(line);
      return line;
    };
    for (const node of this.innerNodes) {
      this.innerLines.push(buildLine(coreMesh, node));
    }

    // ── Per-line flowing data particles ────────────────
    // Particles travel core → module, reading as data flow.
    const flowMat = new THREE.PointsMaterial({
      color: blue2Hex,
      size: this.isMobile ? 0.07 : 0.055,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const buildFlowForLine = (lineObj: any, from: any, to: any, perLine: number) => {
      const positions = new Float32Array(perLine * 3);
      const progress = new Float32Array(perLine);
      const speed = new Float32Array(perLine);
      for (let i = 0; i < perLine; i++) {
        progress[i] = i / perLine + (Math.random() - 0.5) * 0.1;
        speed[i] = 0.0009 + Math.random() * 0.0008;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const points = new THREE.Points(geom, flowMat);
      points.frustumCulled = false;
      scene.add(points);
      this.flowParticles.push({
        obj: points,
        positions,
        progress,
        speed,
        fromVec: from.position.clone(),
        toVec: to.position.clone(),
      });
    };
    const flowPerLine = this.isMobile ? 1 : 2;
    for (const line of this.innerLines) {
      const node = this.innerNodes[this.innerLines.indexOf(line)];
      buildFlowForLine(line, coreMesh, node, flowPerLine);
    }

    // ── Ambient drift particles ─────────────────────────
    const particleCount = this.isMobile ? 14 : this.hostWidth < 1024 ? 20 : 32;
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
      color: blue2Hex,
      size: 0.04,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true,
      depthWrite: false,
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
    this.updateFlowParticles(now);
    this.updatePointer();
    this.updateScrollCamera();
    this.updateParticles();
    this.renderer.render(this.scene, this.camera);
  }

  private updateEntrance(now: number): void {
    if (this.revealStart === null) return;
    const t = now - this.revealStart;

    // 150ms: core (mesh + edge lines) scales 0 → 1
    if (t >= 150) {
      const ct = Math.min(1, (t - 150) / 700);
      const eased = this.easeOutCubic(ct);
      if (this.core?.mesh) this.core.mesh.scale.setScalar(eased);
      if (this.core?.line) this.core.line.scale.setScalar(eased);
      if (this.core?.edgeMat) this.core.edgeMat.opacity = eased * 0.7;
    }

    // 350ms: architecture tori begin appearing (staggered 100ms each)
    for (let i = 0; i < this.archRings.length; i++) {
      const start = 350 + i * 100;
      if (t >= start) {
        const ct = Math.min(1, (t - start) / 800);
        const peak = this.archRings[i].userData.peakOpacity ?? 0.2;
        this.archRings[i].material.opacity = ct * peak;
      }
    }

    // 500ms: module nodes appear (staggered 100ms each)
    for (let i = 0; i < this.innerNodes.length; i++) {
      const start = 500 + i * 100;
      if (t >= start) {
        const ct = Math.min(1, (t - start) / 300);
        const eased = this.easeOutBack(ct);
        this.innerNodes[i].scale.setScalar(eased);
        this.innerNodes[i].material.opacity = eased;
      }
    }

    // 700ms: connection lines reveal (staggered 80ms)
    for (let i = 0; i < this.innerLines.length; i++) {
      const start = 700 + i * 80;
      if (t >= start) {
        const ct = Math.min(1, (t - start) / 600);
        this.innerLines[i].material.opacity = ct * 0.5;
      }
    }

    // 1100ms: flow particles fade in
    for (const fp of this.flowParticles) {
      fp.obj.material.opacity = 0;
    }
    if (t >= 1100) {
      const ct = Math.min(1, (t - 1100) / 600);
      for (const fp of this.flowParticles) {
        fp.obj.material.opacity = ct * 0.9;
      }
    }

    // 1500ms: camera pull-in z 7 → 6
    if (t >= 1500 && t < 1500 + 1500) {
      const ct = (t - 1500) / 1500;
      this.camera.position.z = 7 + (6 - 7) * this.easeInOutCubic(ct);
    } else if (t >= 3000) {
      this.camera.position.z = 6;
    }

    // 2400ms: transition to idle-loop
    if (t >= 2400 && this.state === 'revealing') {
      this.state = 'idle-loop';
      this.cdr.markForCheck();
      this.attachPointerListeners();
    }
  }

  private updateIdle(now: number): void {
    if (this.state !== 'idle-loop') return;
    // Core (icosahedron): oscillate ±2° on Y axis (12s period).
    if (this.core?.mesh) {
      const phase = (now / 12000) * Math.PI * 2;
      this.core.mesh.rotation.y = Math.sin(phase) * 0.034;
      if (this.core.line) this.core.line.rotation.y = Math.sin(phase) * 0.034;
    }
    // Torus rings: slow spin around z axis, each at its own speed.
    for (const ring of this.archRings) {
      const speed = ring.userData.spinSpeed ?? 0.001;
      ring.rotation.z += speed;
    }
    // Module nodes: slow orbit + gentle Y float.
    for (const node of this.innerNodes) {
      const angle = (node.userData.orbitAngle ?? 0) + now * (node.userData.orbitSpeed ?? 0.0001);
      const baseR = 2.3 + (Math.sin(node.userData.floatPhase ?? 0) > 0 ? 0.35 : 0);
      node.position.x = Math.cos(angle) * baseR;
      node.position.z = Math.sin(angle) * baseR;
      node.position.y = Math.sin(angle * 0.7) * 0.5 + Math.sin(now * 0.0008 + (node.userData.floatPhase ?? 0)) * 0.15;
    }
  }

  private updateFlowParticles(now: number): void {
    if (this.state !== 'idle-loop' && this.state !== 'revealing') return;
    for (const fp of this.flowParticles) {
      const { obj, positions, progress, speed, fromVec, toVec } = fp;
      const dt = 0.016; // ~60fps nominal; speed is already per-frame
      for (let i = 0; i < progress.length; i++) {
        progress[i] += speed[i] * 60 * dt; // normalize to 60fps
        if (progress[i] > 1) progress[i] -= 1;
        if (progress[i] < 0) progress[i] += 1;
        const p = progress[i];
        const i3 = i * 3;
        positions[i3] = fromVec.x + (toVec.x - fromVec.x) * p;
        positions[i3 + 1] = fromVec.y + (toVec.y - fromVec.y) * p;
        positions[i3 + 2] = fromVec.z + (toVec.z - fromVec.z) * p;
      }
      obj.geometry.attributes.position.needsUpdate = true;
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
    // Re-detect viewport on resize so the mobile class follows reality.
    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth < 768;
    if (wasMobile !== this.isMobile) {
      this.cdr.markForCheck();
      this.cdr.detectChanges();
    }
  }

  private renderOnce(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    if (this.core?.mesh) this.core.mesh.scale.setScalar(1);
    if (this.core?.line) this.core.line.scale.setScalar(1);
    if (this.core?.edgeMat) this.core.edgeMat.opacity = 0.7;
    for (const n of this.innerNodes) {
      n.scale.setScalar(1);
      if (n.material) n.material.opacity = 1;
    }
    for (const l of this.innerLines) {
      if (l.material) (l.material as any).opacity = 0.5;
    }
    for (const ring of this.archRings) {
      ring.material.opacity = ring.userData.peakOpacity ?? 0.2;
    }
    for (const fp of this.flowParticles) {
      fp.obj.material.opacity = 0.9;
    }
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
    this.innerLines = [];
    this.archRings = [];
    this.flowParticles = [];
    this.pointsObj = null;
    this.pointsVelocities = null;
  }
}
