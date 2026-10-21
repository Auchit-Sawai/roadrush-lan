function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function norm2(x, z) {
  const len = Math.hypot(x, z);
  if (len < 1e-9) return { x: 0, z: 0, len: 0 };
  return { x: x / len, z: z / len, len };
}

export function buildTrackSamples(controlPoints, samplesPerSegment = 90) {
  const count = controlPoints.length;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const p0 = controlPoints[(i - 1 + count) % count];
    const p1 = controlPoints[i];
    const p2 = controlPoints[(i + 1) % count];
    const p3 = controlPoints[(i + 2) % count];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      pts.push({
        x: catmullRom(p0[0], p1[0], p2[0], p3[0], t),
        y: catmullRom(p0[1], p1[1], p2[1], p3[1], t),
        z: catmullRom(p0[2], p1[2], p2[2], p3[2], t),
      });
    }
  }

  const n = pts.length;
  const points = new Array(n);
  const tangents = new Array(n);
  const rights = new Array(n);
  const curvatures = new Array(n);
  const turns = new Array(n);
  const distances = new Float64Array(n + 1);

  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    tangents[i] = { x: dx / len, y: 0, z: dz / len };
    const right = norm2(tangents[i].z, -tangents[i].x);
    rights[i] = { x: right.x, z: right.z };
    points[i] = { x: pts[i].x, y: pts[i].y, z: pts[i].z };
  }

  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    distances[i] = total;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  distances[n] = total;
  const ds = total / n;

  for (let i = 0; i < n; i++) {
    const t1 = tangents[(i - 1 + n) % n];
    const t2 = tangents[(i + 1) % n];
    const dot = Math.max(-1, Math.min(1, t1.x * t2.x + t1.z * t2.z));
    const angle = Math.acos(dot);
    const crossY = t1.z * t2.x - t1.x * t2.z;
    curvatures[i] = angle / (2 * ds);
    turns[i] = crossY >= 0 ? 1 : -1;
  }

  const smooth = new Float64Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      smooth[i] = (curvatures[(i - 1 + n) % n] + curvatures[i] * 2 + curvatures[(i + 1) % n]) / 4;
    }
    for (let i = 0; i < n; i++) curvatures[i] = smooth[i];
  }

  return { points, tangents, rights, curvatures, turns, distances, count: n, length: total, ds };
}
