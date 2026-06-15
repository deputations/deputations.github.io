/* ============================================================
   hero-wave.js — full-bleed WebGL "wavy pattern" background.

   Faithful port of the three.js particle wave field from
   fable-samples/sample-3 (initHero), adapted for the Deputations
   portal: viewport-sized fixed background, brand-hue palette,
   theme-aware (reads <html data-theme>), and driven by a lightweight
   passive scroll listener instead of GSAP ScrollTrigger + Lenis (so
   each page's own scrolling is untouched).

   Self-contained & drop-in: include it on any page with
     <script type="importmap">{ "imports": { "three": "/vendor/three.module.js" } }</script>
     <script type="module" src="/hero-wave.js"></script>
   It reuses an existing #heroWaveCanvas if the page already has one
   (homepage), otherwise it creates and positions its own canvas — no
   per-page CSS needed. Revert by deleting this file and the
   <!-- BEGIN/END hero-wave --> blocks in each page (+ style.css).
   ============================================================ */

import * as THREE from "three";

// Perf budget: skip entirely on phones (mirrors style.css disabling
// the .shape blobs at <=768px) and respect reduced-motion.
const smallScreen = window.matchMedia("(max-width: 768px)").matches;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!smallScreen) {
  initWave(ensureCanvas());
}

// Reuse the page's canvas if present, else create a fixed, full-bleed,
// behind-content canvas with inline styles so no stylesheet is required.
function ensureCanvas() {
  let c = document.getElementById("heroWaveCanvas");
  if (!c) {
    c = document.createElement("canvas");
    c.id = "heroWaveCanvas";
    c.className = "bg-wave";
    c.setAttribute("aria-hidden", "true");
    // append at end of <body> so it paints over any .bg-shapes blobs
    // (both sit at z-index -1, behind page content)
    document.body.appendChild(c);
    Object.assign(c.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      zIndex: "-1",
      pointerEvents: "none",
      display: "block",
    });
  }
  return c;
}

function initWave(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();

  // Two cameras render the SAME wave field in two passes so a dense, colourful
  // horizon band lands at BOTH ends of the viewport:
  //   • camTop looks DOWN  → horizon rides high → wave behind the header/KPIs
  //   • camBottom looks UP → horizon drops low  → wavy "sea" at the page bottom
  // The middle stays sparse and is covered by page content anyway.
  const camTop = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  const camBottom = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  const CAM = {
    top: { y: 7.0, lookY: -1.5, z: 14.0 },
    bottom: { y: 2.4, lookY: 6.0, z: 15.0 },
  };
  function placeCameras(mx, my) {
    camTop.position.set(mx * 0.5, CAM.top.y + my * 0.25, CAM.top.z);
    camTop.lookAt(0, CAM.top.lookY, 0);
    camBottom.position.set(mx * 0.5, CAM.bottom.y + my * 0.25, CAM.bottom.z);
    camBottom.lookAt(0, CAM.bottom.lookY, 0);
  }
  placeCameras(0, 0);
  // render the two passes onto one canvas without wiping the first
  renderer.autoClear = false;

  // grid of points displaced by layered sine waves in the vertex shader.
  // Deep/wide field + steep tilt so the wave plane fills the FULL viewport —
  // crests show at the top (behind the header) and at the bottom; the middle
  // is covered by the page content (data rows), which is fine.
  const COLS = 220;
  const ROWS = 230;
  const W = 46;
  const H = 40;
  const count = COLS * ROWS;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);

  let i = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      positions[i * 3 + 0] = (x / (COLS - 1) - 0.5) * W;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = (y / (ROWS - 1) - 0.5) * H;
      seeds[i] = Math.random();
      i++;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uScroll: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    uFlipY: { value: 1.0 }, // 1 = top cloud, -1 = bottom (clip-space mirror)
    // brand hues — ink base + cyan / purple / green gradient (matches the site)
    uColInk: { value: new THREE.Color("#02040b") },
    uColA: { value: new THREE.Color("#22d3ee") }, // cyan
    uColB: { value: new THREE.Color("#67e8f9") }, // light cyan
    uColC: { value: new THREE.Color("#a78bfa") }, // purple
    uColD: { value: new THREE.Color("#22c55e") }, // green
  };

  // Theme-aware ink: points read against --bg-main (#02040b dark / light slate).
  function applyTheme() {
    const light =
      document.documentElement.getAttribute("data-theme") === "light";
    uniforms.uColInk.value.set(light ? "#cbd5e1" : "#02040b");
  }
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  const VERT = /* glsl */ `
      uniform float uTime;
      uniform vec2 uMouse;
      uniform float uScroll;
      uniform float uPixelRatio;
      uniform float uFlipY;
      attribute float aSeed;
      varying float vElev;
      varying float vSeed;
      varying vec2 vUvPos;

      void main() {
        vec3 p = position;

        // layered travelling waves
        float t = uTime * 0.55;
        float e = 0.0;
        e += sin(p.x * 0.55 + t) * 0.75;
        e += sin(p.z * 0.85 + t * 1.4) * 0.5;
        e += sin((p.x + p.z) * 0.35 + t * 0.8) * 0.6;

        // gentle swell that follows the cursor
        float mDist = distance(p.xz, uMouse * vec2(${(W / 2).toFixed(1)}, ${(H / 2).toFixed(1)}));
        e += smoothstep(5.0, 0.0, mDist) * 1.2;

        // ease the waves down as the user scrolls past the hero, but keep the
        // sea clearly alive at the bottom of the page (never fully flat)
        e *= (1.0 - uScroll * 0.35);

        p.y = e;
        vElev = e;
        vSeed = aSeed;
        vUvPos = vec2(position.x / ${W.toFixed(1)} + 0.5, position.z / ${H.toFixed(1)} + 0.5);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.y *= uFlipY; // (legacy mirror hook — left at 1.0, unused)
        // cap the sprite size so near points don't blow up fill-rate
        gl_PointSize = min((1.8 + aSeed * 2.0) * uPixelRatio * (6.0 / -mv.z), 13.0 * uPixelRatio);
      }
    `;

  const FRAG = /* glsl */ `
      uniform vec3 uColInk;
      uniform vec3 uColA;
      uniform vec3 uColB;
      uniform vec3 uColC;
      uniform vec3 uColD;
      varying float vElev;
      varying float vSeed;
      varying vec2 vUvPos;

      void main() {
        // round points
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;

        // cyan gradient on the left, purple/green on the right; ink in calm zones
        vec3 warm = mix(uColA, uColB, vUvPos.y);
        vec3 cool = mix(uColC, uColD, vUvPos.y);
        vec3 hue = mix(warm, cool, smoothstep(0.25, 0.75, vUvPos.x));

        // colorize from the first hint of displacement so crests read across
        // the whole field (including the low foreground), not just tall peaks
        float energy = smoothstep(0.05, 0.75, abs(vElev));
        vec3 col = mix(uColInk, hue, energy);

        float alpha = (0.3 + energy * 0.6) * (0.55 + vSeed * 0.45);
        gl_FragColor = vec4(col, alpha);
      }
    `;

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: VERT,
    fragmentShader: FRAG,
  });

  // single wave plane — the looking-up camera lays its dense horizon across the
  // lower viewport, so the wavy "sea" reads at the bottom of the screen.
  const points = new THREE.Points(geometry, material);
  points.position.y = 0.0;
  points.rotation.x = 0.0;
  scene.add(points);

  // sizing — full viewport (this is a fixed background, not a hero element)
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camTop.aspect = aspect;
    camTop.updateProjectionMatrix();
    camBottom.aspect = aspect;
    camBottom.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  // one frame = two passes (top band, then bottom band) onto the same canvas
  function renderAll() {
    renderer.clear();
    renderer.render(scene, camTop);
    renderer.render(scene, camBottom);
  }

  // mouse → eased uniform + slight camera parallax
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener("pointermove", (e) => {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = -((e.clientY / window.innerHeight) * 2 - 1);
  });

  // scroll progress over the first viewport flattens the sea
  // (lightweight rAF-throttled listener — no GSAP/Lenis)
  let ticking = false;
  function readScroll() {
    const heroZone = window.innerHeight || 1;
    uniforms.uScroll.value = Math.min(Math.max(window.scrollY / heroZone, 0), 1);
    ticking = false;
  }
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(readScroll);
      }
    },
    { passive: true }
  );
  readScroll();

  const clock = new THREE.Clock();
  let visible = true;
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), {
    threshold: 0,
  }).observe(canvas);
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
  });

  // paint one frame immediately so there's no blank first paint (and so the
  // buffer is readable even before the animation loop starts ticking)
  renderAll();

  renderer.setAnimationLoop(() => {
    if (!visible) return;
    const t = clock.getElapsedTime();
    uniforms.uTime.value = reducedMotion ? 0 : t;

    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    uniforms.uMouse.value.set(mouse.x, mouse.y);

    placeCameras(mouse.x, mouse.y);
    renderAll();
  });
}
