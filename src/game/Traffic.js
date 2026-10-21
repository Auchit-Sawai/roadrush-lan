import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleAt } from '../../shared/track.js';

const CAR_COLORS = ['#3f6fb4', '#c9a13b', '#d8d4c8', '#4f8a5b', '#8a5a8f', '#b4503e'];

function colorGeometry(geometry, color) {
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    array[i * 3] = c.r;
    array[i * 3 + 1] = c.g;
    array[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
  return geometry;
}

function box(w, h, d, x, y, z, color) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return colorGeometry(geometry, color);
}

function buildCarGeometry(bodyColor) {
  const parts = [
    box(1.9, 0.56, 4.1, 0, 0.62, 0, bodyColor),
    box(1.62, 0.52, 1.9, 0, 1.14, -0.25, bodyColor),
    box(1.54, 0.3, 1.7, 0, 1.36, -0.25, '#1d2733'),
    box(1.98, 0.18, 4.16, 0, 0.34, 0, '#181c21'),
    box(0.3, 0.5, 0.62, -0.84, 0.5, 1.28, '#1a1e23'),
    box(0.3, 0.5, 0.62, 0.84, 0.5, 1.28, '#1a1e23'),
    box(0.3, 0.5, 0.62, -0.84, 0.5, -1.32, '#1a1e23'),
    box(0.3, 0.5, 0.62, 0.84, 0.5, -1.32, '#1a1e23'),
    box(0.44, 0.16, 0.08, -0.56, 0.72, 2.06, '#fff3c4'),
    box(0.44, 0.16, 0.08, 0.56, 0.72, 2.06, '#fff3c4'),
    box(0.34, 0.14, 0.08, -0.6, 0.72, -2.06, '#c43a2b'),
    box(0.34, 0.14, 0.08, 0.6, 0.72, -2.06, '#c43a2b'),
  ];
  return mergeGeometries(parts, false);
}

export class TrafficManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.targetCount = options.count ?? 14;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    scene.add(this.group);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.geometries = CAR_COLORS.map((color) => buildCarGeometry(color));
    this.pool = [];
    this.active = [];
    this.all = this.active;
    for (let i = 0; i < this.targetCount + 3; i++) {
      const mesh = new THREE.Mesh(this.geometries[i % this.geometries.length], this.material);
      mesh.visible = false;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.pool.push(mesh);
    }
    this.sequence = 0;
    this.laneSpeeds = [24.5, 21.0];
    this.lanes = [-3.55, 3.55];
  }

  reset(playerProgress = 0) {
    for (const car of this.active) {
      car.mesh.visible = false;
      this.pool.push(car.mesh);
    }
    this.active.length = 0;
    for (let i = 0; i < this.targetCount; i++) {
      this.spawn(playerProgress + 130 + i * 58 + Math.random() * 25, i % 2);
    }
  }

  spawn(progress, laneIndex) {
    if (this.pool.length === 0) return null;
    const mesh = this.pool.pop();
    const lane = laneIndex ?? (Math.random() < 0.5 ? 0 : 1);
    const car = {
      progress,
      lateral: this.lanes[lane],
      lane,
      speed: this.laneSpeeds[lane] + (Math.random() - 0.5) * 3,
      mesh,
      wobble: Math.random() * Math.PI * 2,
    };
    mesh.visible = true;
    mesh.rotation.set(0, 0, 0);
    this.active.push(car);
    return car;
  }

  removeAt(index) {
    const [car] = this.active.splice(index, 1);
    car.mesh.visible = false;
    this.pool.push(car.mesh);
  }

  furthestProgress() {
    let max = -Infinity;
    for (const car of this.active) max = Math.max(max, car.progress);
    return max;
  }

  update(dt, playerProgress) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const car = this.active[i];
      car.progress += car.speed * dt;
      if (car.progress < playerProgress - 140) this.removeAt(i);
    }

    let guard = 0;
    while (this.active.length < this.targetCount && guard++ < 4) {
      const ahead = Math.max(this.furthestProgress(), playerProgress + 160);
      this.spawn(ahead + 40 + Math.random() * 80, Math.random() < 0.5 ? 0 : 1);
    }

    const pos = new THREE.Vector3();
    for (const car of this.active) {
      const sample = sampleAt(car.progress);
      pos.set(
        sample.point.x + sample.right.x * car.lateral,
        sample.point.y + 0.14,
        sample.point.z + sample.right.z * car.lateral,
      );
      car.mesh.position.copy(pos);
      car.mesh.rotation.y = sample.heading;
    }
  }
}
