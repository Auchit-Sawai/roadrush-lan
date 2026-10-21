import * as THREE from 'three';

const VERTEX = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * uScale / max(0.5, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.12, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

/** One pooled point-sprite system for smoke, sparks and dust. */
export class Particles {
  constructor(scene, max = 420) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.lift = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 } },
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'particles';
    scene.add(this.points);
  }

  setViewport(drawingHeight, fovDegrees) {
    this.material.uniforms.uScale.value = drawingHeight / (2 * Math.tan((fovDegrees * Math.PI) / 360));
  }

  emit(o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const k = i * 3;
    this.pos[k] = o.x;
    this.pos[k + 1] = o.y;
    this.pos[k + 2] = o.z;
    this.vel[k] = o.vx ?? 0;
    this.vel[k + 1] = o.vy ?? 0;
    this.vel[k + 2] = o.vz ?? 0;
    this.col[k] = o.r ?? 1;
    this.col[k + 1] = o.g ?? 1;
    this.col[k + 2] = o.b ?? 1;
    this.size[i] = o.size ?? 0.4;
    this.baseAlpha[i] = o.alpha ?? 0.8;
    this.alpha[i] = this.baseAlpha[i];
    this.life[i] = this.maxLife[i] = o.life ?? 0.6;
    this.grow[i] = o.grow ?? 0;
    this.drag[i] = o.drag ?? 1.5;
    this.lift[i] = o.lift ?? 0;
  }

  burst(x, y, z, count, options = {}) {
    const spread = options.spread ?? 6;
    for (let n = 0; n < count; n++) {
      this.emit({
        x, y, z,
        vx: (Math.random() - 0.5) * spread + (options.vx ?? 0),
        vy: Math.random() * spread * 0.7 + (options.vy ?? 1),
        vz: (Math.random() - 0.5) * spread + (options.vz ?? 0),
        r: options.r ?? 1, g: options.g ?? 0.8, b: options.b ?? 0.35,
        size: options.size ?? 0.22,
        life: (options.life ?? 0.45) * (0.6 + Math.random() * 0.8),
        alpha: options.alpha ?? 1,
        grow: options.grow ?? 0,
        drag: options.drag ?? 0.8,
        lift: options.lift ?? -14,
      });
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= damp;
      this.vel[k + 1] = this.vel[k + 1] * damp + this.lift[i] * dt;
      this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = this.baseAlpha[i] * t;
    }
    const attributes = this.points.geometry.attributes;
    attributes.position.needsUpdate = true;
    attributes.aColor.needsUpdate = true;
    attributes.aSize.needsUpdate = true;
    attributes.aAlpha.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
