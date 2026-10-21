import * as THREE from 'three';
import {
  RACE_CONFIG,
  TRACK,
  TRACK_DEFINITION,
  TRACK_LENGTH,
  sampleAt,
  worldPositionAt,
} from '../../shared/track.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a3e45';
  ctx.fillRect(0, 0, 128, 128);
  const rng = mulberry32(42);
  for (let i = 0; i < 1800; i++) {
    const shade = 45 + Math.floor(rng() * 35);
    ctx.fillStyle = `rgba(${shade},${shade + 2},${shade + 5},0.55)`;
    ctx.fillRect(rng() * 128, rng() * 128, 1 + rng() * 2, 1 + rng() * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createRibbonGeometry(lateralStart, lateralEnd, yOffset = 0, stride = 1) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const step = Math.max(1, stride);
  const sections = [];
  for (let i = 0; i < TRACK.count; i += step) sections.push(i);
  for (const index of sections) {
    const p = TRACK.points[index];
    const r = TRACK.rights[index];
    const d = TRACK.distances[index];
    for (const lateral of [lateralStart, lateralEnd]) {
      positions.push(p.x + r.x * lateral, p.y + yOffset, p.z + r.z * lateral);
      uvs.push(lateral === lateralStart ? 0 : 1, d / 10);
    }
  }
  const ringCount = sections.length;
  for (let i = 0; i < ringCount; i++) {
    const next = (i + 1) % ringCount;
    const a = i * 2;
    const b = a + 1;
    const c = next * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createDashGeometry(lateral, yOffset, dashLength = 5, gap = 8, width = 0.16) {
  const positions = [];
  const indices = [];
  let quad = 0;
  for (let d = 0; d < TRACK_LENGTH; d += dashLength + gap) {
    const start = sampleAt(d);
    const end = sampleAt(d + dashLength);
    const a = start.point;
    const ar = start.right;
    const b = end.point;
    const br = end.right;
    const half = width / 2;
    const verts = [
      [a.x + ar.x * (lateral - half), a.y + yOffset, a.z + ar.z * (lateral - half)],
      [a.x + ar.x * (lateral + half), a.y + yOffset, a.z + ar.z * (lateral + half)],
      [b.x + br.x * (lateral - half), b.y + yOffset, b.z + br.z * (lateral - half)],
      [b.x + br.x * (lateral + half), b.y + yOffset, b.z + br.z * (lateral + half)],
    ];
    for (const v of verts) positions.push(...v);
    const base = quad * 4;
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    quad++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function hillNoise(x, z) {
  return (
    Math.sin(x * 0.012) * Math.cos(z * 0.014) * 2.1
    + Math.sin(x * 0.031 + z * 0.017) * 0.75
    + Math.cos(x * 0.006 - z * 0.009) * 2.6
  );
}

function nearestSample(x, z, stride = 3) {
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < TRACK.count; i += stride) {
    const p = TRACK.points[i];
    const dx = p.x - x;
    const dz = p.z - z;
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return { point: best, dist: Math.sqrt(bestDist) };
}

function terrainHeightAt(x, z, nearest) {
  if (!nearest) nearest = nearestSample(x, z);
  if (nearest.dist < 11) return nearest.point.y - 0.2;
  const blend = Math.min(1, (nearest.dist - 11) / 55);
  const rise = Math.min(5.5, (nearest.dist - 11) * 0.055);
  return nearest.point.y - 0.2 + blend * (hillNoise(x, z) + rise);
}

function createTerrain() {
  const size = 1600;
  const segments = 108;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const grassA = new THREE.Color('#557a3d');
  const grassB = new THREE.Color('#6f8c4a');
  const dry = new THREE.Color('#8d8756');
  const dirt = new THREE.Color('#7d6c4f');
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const near = nearestSample(x, z);
    const y = terrainHeightAt(x, z, near);
    position.setY(i, y);
    const n = (Math.sin(x * 0.07) + Math.cos(z * 0.05) + 2) / 4;
    color.copy(grassA).lerp(grassB, n);
    if (near.dist < 24) color.lerp(dirt, 1 - near.dist / 24);
    if (y > 3.5) color.lerp(dry, Math.min(0.55, (y - 3.5) / 8));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = false;
  mesh.name = 'terrain';
  return mesh;
}

function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color('#4f8fca') },
      horizonColor: { value: new THREE.Color('#ffd7a8') },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        float mixValue = pow(max(h, 0.0), 0.55);
        gl_FragColor = vec4(mix(horizonColor, topColor, mixValue), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 20, 14), material);
  mesh.name = 'sky';
  return mesh;
}

function makeSignTexture(title, subtitle) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#20303a';
  ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = '#e8c15a';
  ctx.lineWidth = 10;
  ctx.strokeRect(9, 9, 494, 174);
  ctx.fillStyle = '#f4f1e8';
  ctx.font = 'bold 56px Segoe UI, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 88);
  ctx.fillStyle = '#e8c15a';
  ctx.font = 'bold 30px Segoe UI, Arial, sans-serif';
  ctx.fillText(subtitle, 256, 144);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeBannerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101a24';
  ctx.fillRect(0, 0, 1024, 256);
  const cell = 32;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 32; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#f2f2ea' : '#15181d';
      ctx.fillRect(col * cell, row * cell, cell, cell);
      ctx.fillRect(col * cell, 256 - (row + 1) * cell, cell, cell);
    }
  }
  ctx.fillStyle = '#e63946';
  ctx.font = 'bold 74px Segoe UI, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ROAD RUSH', 512, 126);
  ctx.fillStyle = '#f4f1e8';
  ctx.font = 'bold 30px Segoe UI, Arial, sans-serif';
  ctx.fillText('START  /  FINISH', 512, 174);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStartGantry() {
  const group = new THREE.Group();
  const sample = sampleAt(0);
  const p = sample.point;
  const heading = sample.heading;
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x2b333d });
  const pillarGeo = new THREE.BoxGeometry(0.65, 7.6, 0.65);
  for (const lateral of [-9.6, 9.6]) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(
      p.x + sample.right.x * lateral,
      p.y + 3.8,
      p.z + sample.right.z * lateral,
    );
    pillar.rotation.y = heading;
    group.add(pillar);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(20.5, 0.55, 0.55), pillarMat);
  bar.position.set(p.x, p.y + 7.35, p.z);
  bar.rotation.y = heading;
  group.add(bar);

  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(19.5, 4.4),
    new THREE.MeshBasicMaterial({ map: makeBannerTexture(), side: THREE.DoubleSide }),
  );
  banner.position.set(p.x, p.y + 5.1, p.z);
  // A plane faces +Z by default; turn it to face riders coming down the track so the text isn't mirrored.
  banner.rotation.y = heading + Math.PI;
  group.add(banner);
  return group;
}

function createScenery(settings) {
  const quality = settings.graphics === 'quality';
  const rng = mulberry32(90210);
  const group = new THREE.Group();
  group.name = 'scenery';

  const treeCount = quality ? 420 : 240;
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.42, 2.6, 5);
  const canopyGeo = new THREE.ConeGeometry(2.25, 6.6, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4630, flatShading: true });
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3f6b34, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  let placed = 0;
  let attempts = 0;
  while (placed < treeCount && attempts < treeCount * 12) {
    attempts++;
    const d = rng() * TRACK_LENGTH;
    const side = rng() < 0.5 ? -1 : 1;
    const lateral = side * (11.8 + rng() * rng() * 34);
    const pos = worldPositionAt(d, lateral, { x: 0, y: 0, z: 0 });
    const near = nearestSample(pos.x, pos.z, 2);
    if (near.dist < 11.2) continue;
    const ground = terrainHeightAt(pos.x, pos.z, near);
    const scale = 0.65 + rng() * 1.0;
    matrix.makeTranslation(pos.x, ground + 1.3 * scale, pos.z);
    matrix.scale(new THREE.Vector3(scale, scale, scale));
    trunks.setMatrixAt(placed, matrix);
    matrix.makeTranslation(pos.x, ground + 5.5 * scale, pos.z);
    matrix.scale(new THREE.Vector3(scale, scale, scale));
    canopies.setMatrixAt(placed, matrix);
    color.setHSL(0.26 + rng() * 0.06, 0.34 + rng() * 0.2, 0.24 + rng() * 0.12);
    canopies.setColorAt(placed, color);
    placed++;
  }
  trunks.count = placed;
  canopies.count = placed;
  group.add(trunks, canopies);

  const rockCount = quality ? 110 : 70;
  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1.4, 0),
    new THREE.MeshLambertMaterial({ color: 0x7b7f78, flatShading: true }),
    rockCount,
  );
  let rockPlaced = 0;
  attempts = 0;
  while (rockPlaced < rockCount && attempts < rockCount * 8) {
    attempts++;
    const d = rng() * TRACK_LENGTH;
    const side = rng() < 0.5 ? -1 : 1;
    const pos = worldPositionAt(d, side * (12 + rng() * 40), { x: 0, y: 0, z: 0 });
    const near = nearestSample(pos.x, pos.z, 3);
    if (near.dist < 11.5) continue;
    const ground = terrainHeightAt(pos.x, pos.z, near);
    const scale = 0.5 + rng() * 1.7;
    matrix.makeTranslation(pos.x, ground + 0.4 * scale, pos.z);
    matrix.scale(new THREE.Vector3(scale, scale * 0.7, scale));
    rocks.setMatrixAt(rockPlaced, matrix);
    rockPlaced++;
  }
  rocks.count = rockPlaced;
  group.add(rocks);

  const buildingColors = ['#c9b79a', '#b9a58c', '#a8b3ac', '#c7a58e', '#9ca9b0'];
  const buildingCount = quality ? 16 : 11;
  for (let i = 0; i < buildingCount; i++) {
    const d = rng() * TRACK_LENGTH;
    const side = rng() < 0.5 ? -1 : 1;
    const lateral = side * (27 + rng() * 34);
    const pos = worldPositionAt(d, lateral, { x: 0, y: 0, z: 0 });
    const near = nearestSample(pos.x, pos.z, 3);
    if (near.dist < 22) continue;
    const ground = terrainHeightAt(pos.x, pos.z, near);
    const width = 7 + rng() * 8;
    const depth = 7 + rng() * 8;
    const height = 5 + rng() * 9;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshLambertMaterial({ color: buildingColors[i % buildingColors.length] }),
    );
    box.position.set(pos.x, ground + height / 2, pos.z);
    box.rotation.y = sampleAt(d).heading + (rng() - 0.5) * 0.5;
    group.add(box);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(width, depth) * 0.72, 2.2, 4),
      new THREE.MeshLambertMaterial({ color: 0x6a4c3c, flatShading: true }),
    );
    roof.position.set(pos.x, ground + height + 1.1, pos.z);
    roof.rotation.y = box.rotation.y + Math.PI / 4;
    group.add(roof);
  }

  const mountainCount = 14;
  const mountains = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1, 1, 5),
    new THREE.MeshLambertMaterial({ color: 0x93a7ad, flatShading: true }),
    mountainCount,
  );
  for (let i = 0; i < mountainCount; i++) {
    const angle = (i / mountainCount) * Math.PI * 2 + rng() * 0.2;
    const distance = 520 + rng() * 260;
    const radius = 90 + rng() * 110;
    const height = 80 + rng() * 120;
    matrix.makeTranslation(Math.cos(angle) * distance, height / 2 - 8, Math.sin(angle) * distance);
    matrix.scale(new THREE.Vector3(radius, height, radius));
    mountains.setMatrixAt(i, matrix);
    color.setHSL(0.54, 0.13, 0.52 + rng() * 0.12);
    mountains.setColorAt(i, color);
  }
  group.add(mountains);

  const signData = [
    ['SUNSET RIDGE', 'SCENIC LOOP'],
    ['RIDGE PASS', 'ELEV 240 M'],
    ['COAST ROAD', '12 KM'],
  ];
  signData.forEach((data, i) => {
    const d = 320 + i * 430;
    const side = i % 2 === 0 ? -1 : 1;
    const pos = worldPositionAt(d, side * 11.3, { x: 0, y: 0, z: 0 });
    const near = nearestSample(pos.x, pos.z, 3);
    const ground = terrainHeightAt(pos.x, pos.z, near);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(5.4, 2.0),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(data[0], data[1]), side: THREE.DoubleSide }),
    );
    sign.position.set(pos.x, ground + 3.2, pos.z);
    sign.rotation.y = sampleAt(d).heading + Math.PI;
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 2.6, 0.18),
      new THREE.MeshLambertMaterial({ color: 0x3a3f45 }),
    );
    post.position.set(pos.x, ground + 1.3, pos.z);
    group.add(sign, post);
  });

  return group;
}

function createBarriers() {
  const group = new THREE.Group();
  const spacing = 8.5;
  const total = Math.floor(TRACK_LENGTH / spacing);
  const rails = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.14, 0.58, spacing - 0.35),
    new THREE.MeshLambertMaterial({ color: 0xc6ccd2 }),
    total * 2,
  );
  const posts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.18, 1.05, 0.18),
    new THREE.MeshLambertMaterial({ color: 0x5a626d }),
    total * 2,
  );
  const matrix = new THREE.Matrix4();
  let index = 0;
  for (let i = 0; i < total; i++) {
    const d = i * spacing + spacing / 2;
    const sample = sampleAt(d);
    for (const side of [-1, 1]) {
      const lateral = side * 8.0;
      const x = sample.point.x + sample.right.x * lateral;
      const z = sample.point.z + sample.right.z * lateral;
      matrix.makeTranslation(x, sample.point.y + 0.58, z);
      matrix.multiply(new THREE.Matrix4().makeRotationY(sample.heading));
      rails.setMatrixAt(index, matrix);
      matrix.makeTranslation(x, sample.point.y + 0.52, z);
      posts.setMatrixAt(index, matrix);
      index++;
    }
  }
  group.add(rails, posts);
  return group;
}

export function createTrackWorld(scene, settings = {}) {
  const group = new THREE.Group();
  group.name = 'track-world';

  const asphaltTexture = createAsphaltTexture();
  const road = new THREE.Mesh(
    createRibbonGeometry(-RACE_CONFIG.roadHalfWidth, RACE_CONFIG.roadHalfWidth, 0.12),
    new THREE.MeshLambertMaterial({ map: asphaltTexture }),
  );
  const shoulders = new THREE.Mesh(
    createRibbonGeometry(-10.4, -6.9, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x8a7a5a }),
  );
  const shouldersRight = new THREE.Mesh(
    createRibbonGeometry(6.9, 10.4, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x8a7a5a }),
  );
  const edgeLeft = new THREE.Mesh(
    createRibbonGeometry(-6.72, -6.5, 0.135, 2),
    new THREE.MeshBasicMaterial({ color: 0xe9e9df }),
  );
  const edgeRight = new THREE.Mesh(
    createRibbonGeometry(6.5, 6.72, 0.135, 2),
    new THREE.MeshBasicMaterial({ color: 0xe9e9df }),
  );
  const centerDash = new THREE.Mesh(
    createDashGeometry(0, 0.14),
    new THREE.MeshBasicMaterial({ color: 0xe9e9df }),
  );
  group.add(shoulders, shouldersRight, road, edgeLeft, edgeRight, centerDash);

  const startLineCanvas = document.createElement('canvas');
  startLineCanvas.width = 256;
  startLineCanvas.height = 64;
  const startCtx = startLineCanvas.getContext('2d');
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 16; col++) {
      startCtx.fillStyle = (row + col) % 2 === 0 ? '#f0f0e8' : '#1c1f24';
      startCtx.fillRect(col * 16, row * 16, 16, 16);
    }
  }
  const startTexture = new THREE.CanvasTexture(startLineCanvas);
  startTexture.colorSpace = THREE.SRGBColorSpace;
  const startGeometry = new THREE.PlaneGeometry(13.8, 3.2);
  startGeometry.rotateX(-Math.PI / 2);
  const startLine = new THREE.Mesh(
    startGeometry,
    new THREE.MeshBasicMaterial({ map: startTexture }),
  );
  const startSample = sampleAt(0);
  startLine.rotation.y = startSample.heading;
  startLine.position.set(startSample.point.x, startSample.point.y + 0.155, startSample.point.z);
  group.add(startLine);

  group.add(createTerrain());
  group.add(createScenery(settings));
  group.add(createBarriers());
  group.add(createStartGantry());

  scene.add(group);
  scene.add(createSky());
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(24, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }),
  );
  sun.position.set(-420, 240, -720);
  scene.add(sun);

  const dispose = () => {
    scene.remove(group);
    scene.remove(sun);
    group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material.map) material.map.dispose();
          material.dispose();
        }
      }
    });
  };

  return {
    group,
    road,
    trackName: TRACK_DEFINITION.name,
    startLine: startSample,
    dispose,
  };
}
