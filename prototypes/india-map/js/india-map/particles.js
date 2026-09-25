// js/india-map/particles.js
// Particle burst system for cinematic state-drill transitions.
// Creates 60-80 small particles that emanate from a click point,
// fade out over 400ms with slight gravity.

const COLORS = [
  'rgba(34, 211, 238, 0.8)',   // cyan
  'rgba(34, 211, 238, 0.6)',
  'rgba(167, 139, 250, 0.7)',  // purple
  'rgba(165, 243, 252, 0.5)',  // light cyan
  'rgba(248, 250, 252, 0.6)',  // near-white
];

export class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.running = false;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  }

  burst(x, y, count = 70) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 80 + Math.random() * 200;
      const size = 1.5 + Math.random() * 3;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40, // slight upward bias
        size,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
        decay: 0.6 + Math.random() * 0.8, // lifespan in seconds
        gravity: 60 + Math.random() * 40,
      });
    }
    if (!this.running) {
      this.running = true;
      this._lastTime = performance.now();
      this._loop();
    }
  }

  _loop() {
    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.05);
    this._lastTime = now;

    this.ctx.clearRect(0, 0, this.w, this.h);

    this.particles = this.particles.filter(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.life -= dt / p.decay;

      if (p.life <= 0) return false;

      const alpha = Math.max(0, p.life);
      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      this.ctx.fill();

      return true;
    });

    this.ctx.globalAlpha = 1;

    if (this.particles.length > 0) {
      requestAnimationFrame(() => this._loop());
    } else {
      this.running = false;
      this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }
}
