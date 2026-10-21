import * as THREE from 'three';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.desiredLook = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.shake = 0;
    this.fov = 58;
    this.initialized = false;
    this.time = 0;
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  reset(target, heading) {
    this.forward.set(Math.sin(heading), 0, Math.cos(heading));
    this.position.copy(target).addScaledVector(this.forward, -7.4);
    this.position.y += 2.6;
    this.lookAt.copy(target).addScaledVector(this.forward, 6);
    this.lookAt.y += 1.1;
    this.initialized = true;
  }

  update(dt, target, heading, speedRatio, options = {}) {
    this.time += dt;
    this.forward.set(Math.sin(heading), 0, Math.cos(heading));
    this.right.set(Math.cos(heading), 0, -Math.sin(heading));

    const crash = options.crashTimer > 0;
    const distance = 6.9 + speedRatio * 1.5 + (crash ? 2.6 : 0);
    this.desired.copy(target).addScaledVector(this.forward, -distance);
    this.desired.y += 2.35 + speedRatio * 0.35 + (crash ? 1.1 : 0);
    if (options.lean) this.desired.addScaledVector(this.right, options.lean * 0.55);

    this.desiredLook.copy(target).addScaledVector(this.forward, 5.5 + speedRatio * 4.5);
    this.desiredLook.y += 1.15;

    const follow = this.initialized ? 1 - Math.exp(-11 * dt) : 1;
    const lookFollow = this.initialized ? 1 - Math.exp(-14 * dt) : 1;
    this.position.lerp(this.desired, follow);
    this.lookAt.lerp(this.desiredLook, lookFollow);
    this.initialized = true;

    this.shake = Math.max(0, this.shake - dt * 2.6);
    if (this.shake > 0) {
      const amplitude = this.shake * 0.28;
      this.camera.position.set(
        this.position.x + Math.sin(this.time * 71) * amplitude,
        this.position.y + Math.sin(this.time * 93) * amplitude,
        this.position.z + Math.cos(this.time * 83) * amplitude,
      );
    } else {
      this.camera.position.copy(this.position);
    }
    this.camera.lookAt(this.lookAt);

    const targetFov = 58 + speedRatio * 9 + (options.boosting ? 2.5 : 0);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-4 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
