// js/india-map/particles.js
// Particle burst system for cinematic state-click transitions.
// Vanilla canvas — no animation library. Designed for ~70 particles per click.

// ====== PUBLIC API ======

/**
 * Initialize the particle canvas overlay.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container — the parent that sizes the canvas
 */
export function initParticles(canvas, container) {
  const ctx = canvas.getContext('2d');
  let particles = [];
  let raf = null;
  let running = false;

  function resize() {
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  function spawn(x, y, count = 100) {
    resize();
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
      const speed = 2.0 + Math.random() * 4.5;
      const life = 1.2 + Math.random() * 0.6;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.8,
        life,
        maxLife: life,
        radius: 2.0 + Math.random() * 3.0,
        hue: 38 + Math.random() * 15
      });
    }
    if (!running) {
      running = true;
      tick();
    }
  }

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dt = 1 / 60;
    particles = particles.filter(p => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.vx *= 0.985;
      const alpha = Math.max(0, p.life / p.maxLife);
      const r = p.radius * (0.6 + 0.4 * alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 90%, 65%, ${alpha * 0.15})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 85%, 72%, ${alpha})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 60%, 90%, ${alpha})`;
      ctx.fill();
      return true;
    });

    if (particles.length > 0) {
      raf = requestAnimationFrame(tick);
    } else {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    particles = [];
    running = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  window.addEventListener('resize', () => { if (running) resize(); });

  return { spawn, stop };
}

// ParticleSystem class — wraps initParticles for map-view.js
// Usage: const ps = new ParticleSystem(canvas); ps.burst(x, y, count);
export class ParticleSystem {
  constructor(canvas) {
    const container = canvas.parentElement;
    const api = initParticles(canvas, container);
    this.spawn = api.spawn;
    this.stop = api.stop;
  }
  burst(x, y, count = 70) {
    this.spawn(x, y, count);
  }
}
