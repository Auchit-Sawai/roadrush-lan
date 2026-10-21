import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHEEL_RADIUS = 0.46;

function mergeStaticByMaterial(parent, excluded) {
  const buckets = new Map();
  for (const child of [...parent.children]) {
    if (!child.isMesh || excluded.has(child)) continue;
    if (!buckets.has(child.material)) buckets.set(child.material, []);
    buckets.get(child.material).push(child);
  }
  for (const [material, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      return mesh.geometry.clone().applyMatrix4(mesh.matrix);
    });
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    parent.add(mesh);
    for (const old of meshes) {
      parent.remove(old);
      old.geometry.dispose();
    }
  }
}

function makeMaterial(color, options = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...options });
}

function makeLabelTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(10,16,24,0.72)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 48, 10);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#f4f7fb';
  ctx.font = 'bold 28px Segoe UI, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 16), 128, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function wheelGeometry() {
  const tire = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.16, 12);
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.24, 0.24, 0.18, 8);
  rim.rotateZ(Math.PI / 2);
  return { tire, rim };
}

export function createMotorcycle(options = {}) {
  const wheel = wheelGeometry();
  const headlightGeometry = new THREE.SphereGeometry(0.09, 6, 6);
  const color = options.color ?? '#e63946';
  const showLabel = Boolean(options.label);

  const group = new THREE.Group();
  const lean = new THREE.Group();
  group.add(lean);

  const bodyMat = makeMaterial(color);
  const darkMat = makeMaterial(0x1c1f24);
  const metalMat = makeMaterial(0x9aa4b2);
  const riderMat = makeMaterial(0x242b36);
  const helmetMat = makeMaterial(0xe9edf2);
  const visorMat = makeMaterial(0x121a24);
  const seatMat = makeMaterial(0x14171c);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });

  const addBox = (parent, w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  addBox(lean, 0.46, 0.34, 1.55, 0, 0.82, 0.05, darkMat);
  addBox(lean, 0.52, 0.44, 0.92, 0, 1.08, 0.18, bodyMat);
  addBox(lean, 0.42, 0.22, 0.72, 0, 0.92, 0.62, bodyMat);
  addBox(lean, 0.5, 0.18, 0.58, 0, 1.2, -0.42, seatMat);

  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.3, 0.5), bodyMat);
  tank.position.set(0, 1.24, 0.08);
  lean.add(tank);

  const fairing = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.62, 4), bodyMat);
  fairing.rotation.x = Math.PI / 2;
  fairing.position.set(0, 1.04, 1.06);
  lean.add(fairing);

  addBox(lean, 0.08, 0.08, 0.8, 0.24, 0.6, 0.42, metalMat);
  addBox(lean, 0.08, 0.08, 0.8, -0.24, 0.6, 0.42, metalMat);

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.72, 6), metalMat);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.3, 0.62, -0.6);
  lean.add(exhaust);

  const rearWheel = new THREE.Mesh(wheel.tire, darkMat);
  rearWheel.position.set(0, WHEEL_RADIUS, -0.92);
  const rearRim = new THREE.Mesh(wheel.rim, metalMat);
  rearRim.position.copy(rearWheel.position);
  lean.add(rearWheel, rearRim);

  const frontPivot = new THREE.Group();
  frontPivot.position.set(0, WHEEL_RADIUS, 0.92);
  lean.add(frontPivot);
  const frontWheel = new THREE.Mesh(wheel.tire, darkMat);
  const frontRim = new THREE.Mesh(wheel.rim, metalMat);
  frontPivot.add(frontWheel, frontRim);

  addBox(lean, 0.09, 0.82, 0.09, 0.27, 0.86, 0.78, metalMat);
  addBox(lean, 0.09, 0.82, 0.09, -0.27, 0.86, 0.78, metalMat);

  const handlebar = addBox(lean, 0.72, 0.07, 0.07, 0, 1.35, 0.7, darkMat);
  handlebar.rotation.z = 0;

  const headlight = new THREE.Mesh(headlightGeometry, lightMat);
  headlight.position.set(0, 1.18, 1.3);
  lean.add(headlight);
  const tail = addBox(lean, 0.24, 0.1, 0.06, 0, 1.02, -1.05, tailMat);

  const rider = new THREE.Group();
  rider.position.set(0, 1.16, -0.08);
  lean.add(rider);
  addBox(rider, 0.52, 0.62, 0.4, 0, 0.36, 0, riderMat);
  addBox(rider, 0.3, 0.36, 0.3, 0, 0.12, 0.36, riderMat);
  addBox(rider, 0.14, 0.44, 0.14, 0.32, 0.26, 0.3, riderMat);
  addBox(rider, 0.14, 0.44, 0.14, -0.32, 0.26, 0.3, riderMat);
  addBox(rider, 0.2, 0.48, 0.2, 0.3, -0.1, -0.08, riderMat);
  addBox(rider, 0.2, 0.48, 0.2, -0.3, -0.1, -0.08, riderMat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), helmetMat);
  head.position.set(0, 0.86, 0.05);
  rider.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.08), visorMat);
  visor.position.set(0, 0.87, 0.28);
  rider.add(visor);

  // Punch arms are kept out of the merge so they can swing independently.
  const fistMat = makeMaterial(0xd9a679);
  const makeArm = (direction) => {
    const pivot = new THREE.Group();
    pivot.position.set(direction * 0.3, 0.5, 0.12);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 0.15), riderMat);
    sleeve.position.x = direction * 0.35;
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.2), fistMat);
    fist.position.x = direction * 0.78;
    pivot.add(sleeve, fist);
    pivot.visible = false;
    rider.add(pivot);
    return pivot;
  };
  const armLeft = makeArm(1);
  const armRight = makeArm(-1);

  let sirenRed = null;
  let sirenBlue = null;
  if (options.police) {
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    const blueMat = new THREE.MeshBasicMaterial({ color: 0x2a6bff });
    sirenRed = addBox(lean, 0.2, 0.12, 0.2, 0.14, 1.86, -0.5, redMat);
    sirenBlue = addBox(lean, 0.2, 0.12, 0.2, -0.14, 1.86, -0.5, blueMat);
    addBox(lean, 0.5, 0.08, 0.28, 0, 1.78, -0.5, darkMat);
    addBox(lean, 0.62, 0.34, 0.12, 0, 1.0, -0.98, makeMaterial(0xf4f6fa));
  }

  mergeStaticByMaterial(lean, new Set([rearWheel, rearRim, frontPivot, tail, headlight, sirenRed, sirenBlue].filter(Boolean)));
  mergeStaticByMaterial(rider, new Set([head, visor, armLeft, armRight]));

  let label = null;
  if (showLabel) {
    const texture = makeLabelTexture(options.label, color);
    const [labelWidth, labelHeight] = options.labelScale ?? [2.8, 0.7];
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(labelWidth, labelHeight),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: !options.labelOnTop,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    plate.position.set(0, 2.75, 0);
    plate.renderOrder = 5;
    group.add(plate);
    label = plate;
  }

  const motorcycle = {
    group,
    lean,
    frontPivot,
    rearWheel,
    frontRim,
    bodyMat,
    tail,
    nameLabel: label,
    spin: 0,
    crashBlend: 0,
    setColor(nextColor) {
      bodyMat.color.set(nextColor);
    },
    setVisible(visible) {
      group.visible = visible;
    },
    update(dt, visual = {}) {
      const speed = visual.speed ?? 0;
      this.spin += (speed / WHEEL_RADIUS) * dt;
      rearWheel.rotation.x = this.spin;
      frontRim.rotation.x = this.spin;
      frontPivot.rotation.y = -(visual.steer ?? 0) * 0.42;

      const crashed = (visual.crashTimer ?? 0) > 0;
      const targetBlend = crashed ? 1 : 0;
      this.crashBlend += (targetBlend - this.crashBlend) * (1 - Math.exp(-(crashed ? 7 : 5) * dt));
      const wobble = crashed ? Math.sin(performance.now() * 0.018) * 0.18 : 0;
      this.lean.rotation.z = (visual.lean ?? 0) * (1 - this.crashBlend) + this.crashBlend * (1.0 + wobble);
      this.lean.rotation.x = this.crashBlend * -0.62;
      this.lean.position.y = this.crashBlend * -0.16;
      tail.material.color.setHex(visual.boosting ? 0xff2a1f : 0x9b1c1c);
      if (label) label.position.y = 2.75 + this.crashBlend * -0.4;

      const punch = visual.punch ?? 0;
      armLeft.visible = punch > 0 && visual.punchSide > 0;
      armRight.visible = punch > 0 && visual.punchSide < 0;
      if (punch > 0) {
        const arm = visual.punchSide > 0 ? armLeft : armRight;
        arm.scale.x = 0.25 + Math.sin(Math.PI * (1 - punch)) * 1.05;
      }

      if (sirenRed) {
        const phase = Math.floor(performance.now() / 110) % 2 === 0;
        sirenRed.visible = phase;
        sirenBlue.visible = !phase;
      }
    },
  };

  return motorcycle;
}
