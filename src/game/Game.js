import * as THREE from 'three';
import {
  RACE_CONFIG,
  TRACK_DEFINITION,
  TRACK_LENGTH,
  sampleAt,
  worldPositionAt,
} from '../../shared/track.js';
import { sanitizeNickname } from '../../shared/protocol.js';
import { createTrackWorld } from './Track.js';
import { createMotorcycle } from './Motorcycle.js';
import { TrafficManager } from './Traffic.js';
import { BIKE, bumpRacer, createRacerState, stepRacer, triggerCrash } from './Physics.js';
import { computeAIInput } from './AIController.js';
import { RaceManager } from './RaceManager.js';
import { CameraController } from './CameraController.js';
import { resolutionHeight } from '../storage/Settings.js';
import { canPunch, difficultyFor, findTarget, punch } from './Combat.js';
import { Particles } from './Particles.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;

const AI_DEFINITIONS = [
  { id: 'ai-rex', name: 'Rex', color: '#4d96ff', skill: 0.92, lane: -4.6 },
  { id: 'ai-mika', name: 'Mika', color: '#f4a261', skill: 0.78, lane: 4.6 },
  { id: 'ai-juno', name: 'Juno', color: '#59c26b', skill: 0.66, lane: -2.3 },
  { id: 'ai-vex', name: 'Vex', color: '#c77dff', skill: 0.54, lane: 2.3 },
  { id: 'ai-nova', name: 'Nova', color: '#f1f1f1', skill: 0.42, lane: 5.35 },
];

const START_LANES = [-5.1, 5.1, -3.2, 3.2, -1.3, 1.3, -4.3, 4.3];

function disposeObject(root) {
  root.traverse((object) => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material.map) material.map.dispose();
        if (material.isSpriteMaterial && material.map) material.map.dispose();
        material.dispose();
      }
    }
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class Game {
  constructor(options) {
    this.canvas = options.canvas;
    this.settings = options.settings;
    this.hud = options.hud;
    this.sound = options.sound;
    this.callbacks = options.callbacks ?? {};
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.settings.graphics === 'quality',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setClearColor(0x0b1420, 1);

    this.scene = null;
    this.camera = null;
    this.cameraController = null;
    this.world = null;
    this.traffic = null;
    this.playerBike = null;
    this.aiBikes = [];
    this.aiRacers = [];
    this.cops = [];
    this.copBikes = [];
    this.copTimer = 0;
    this.particles = null;
    this.punchQueue = 0;
    this.difficulty = difficultyFor('pro');
    this.remotes = new Map();
    this.player = null;
    this.race = null;
    this.mode = 'offline';
    this.session = null;
    this.sessionUnsubs = [];
    this.lanInfo = null;
    this.running = false;
    this.paused = false;
    this.localFinished = false;
    this.raf = null;
    this.lastFrame = 0;
    this.accumulator = 0;
    this.hudAccumulator = 0;
    this.netAccumulator = 0;
    this.fpsAccumulator = 0;
    this.fpsFrames = 0;
    this.fps = 0;
    this.stats = { calls: 0, triangles: 0 };
    this.tmp = { x: 0, y: 0, z: 0 };
    this.cameraTarget = new THREE.Vector3();
    this.resolutionScale = 1;
    this.performanceTimer = 0;
    this.upscaleStreak = 0;
    this.keys = new Set();
    this.debugInput = null;
    this.manualSim = new URLSearchParams(location.search).get('manual') === '1';
    this.clockOffset = 0;
    this.startAtEpoch = 0;
    this.finishRetryTimer = null;
    this.builtGraphics = null;
    this.ready = false;

    this.resize = this.resize.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    this.ensureScene();
    this.resize();
    this.renderer.render(this.scene, this.camera);
    this.ready = true;
  }

  ensureScene() {
    if (this.scene) return;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#a8c9dd');
    this.scene.fog = new THREE.Fog(0xd2e0e2, 190, 900);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2200);

    const hemisphere = new THREE.HemisphereLight(0xd8ecff, 0x5e6a48, 1.45);
    const sunLight = new THREE.DirectionalLight(0xfff0cf, 2.1);
    sunLight.position.set(220, 320, 140);
    this.scene.add(hemisphere, sunLight);

    this.world = createTrackWorld(this.scene, this.settings);
    this.traffic = new TrafficManager(this.scene, {
      count: this.settings.graphics === 'quality' ? 16 : 12,
    });
    this.playerBike = createMotorcycle({
      color: this.settings.color,
      label: 'YOU',
      labelScale: [2.25, 0.56],
      labelOnTop: true,
    });
    this.scene.add(this.playerBike.group);
    this.aiBikes = AI_DEFINITIONS.map((definition) => {
      const bike = createMotorcycle({ color: definition.color });
      bike.setVisible(false);
      this.scene.add(bike.group);
      return bike;
    });
    this.copBikes = [0, 1].map(() => {
      const bike = createMotorcycle({ color: '#1d3f8f', police: true });
      bike.setVisible(false);
      this.scene.add(bike.group);
      return bike;
    });
    this.particles = new Particles(this.scene, this.settings.graphics === 'quality' ? 520 : 320);
    this.cameraController = new CameraController(this.camera);
    this.builtGraphics = this.settings.graphics;
    this.resetMenuPose();
  }

  disposeScene() {
    this.stopLoop();
    this.stopFinishRetry();
    this.unbindSession();
    if (!this.scene) return;
    for (const child of [...this.scene.children]) {
      this.scene.remove(child);
      disposeObject(child);
    }
    this.scene = null;
    this.camera = null;
    this.world = null;
    this.traffic = null;
    this.playerBike = null;
    this.aiBikes = [];
    this.copBikes = [];
    this.cops = [];
    this.particles = null;
    this.remotes.clear();
    this.aiRacers = [];
    this.cameraController = null;
    this.builtGraphics = null;
  }

  resetMenuPose() {
    if (!this.playerBike) return;
    const sample = sampleAt(0);
    const pos = worldPositionAt(0, 0, this.tmp);
    this.playerBike.group.position.set(pos.x, pos.y + 0.14, pos.z);
    this.playerBike.group.rotation.y = sample.heading;
    this.playerBike.setVisible(true);
    this.playerBike.update(0, { speed: 0, steer: 0, lean: 0 });
    this.cameraController?.reset(new THREE.Vector3(pos.x, pos.y + 0.6, pos.z), sample.heading);
    if (this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  }

  resize() {
    if (!this.renderer) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const base = clamp(resolutionHeight(this.settings.resolution) / height, 0.5, 1.5);
    const qualityScale = this.settings.graphics === 'quality'
      ? clamp(window.devicePixelRatio || 1, 1, 1.5)
      : 1;
    this.renderer.setPixelRatio(clamp(base * qualityScale * this.resolutionScale, 0.45, 2));
    this.renderer.setSize(width, height, false);
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  setGraphicsPreset(preset) {
    this.settings.graphics = preset;
    if (this.builtGraphics === preset) {
      this.resize();
      return false;
    }
    if (this.running) return false;
    this.disposeScene();
    this.ensureScene();
    this.resize();
    this.resetMenuPose();
    return true;
  }

  setPlayerColor(color) {
    this.playerBike?.setColor(color);
  }

  startRace(options = {}) {
    this.ensureScene();
    this.stopLoop();
    this.stopFinishRetry();
    this.paused = false;
    this.localFinished = false;
    this.mode = options.mode ?? 'offline';
    this.session = options.session ?? null;
    this.lanInfo = options.info ?? null;
    this.clockOffset = this.mode === 'lan'
      ? (this.lanInfo?.serverTime ?? Date.now()) - Date.now()
      : 0;
    this.startAtEpoch = this.mode === 'lan'
      ? (this.lanInfo?.startAt ?? Date.now() + 3600)
      : 0;
    this.debugInput = null;
    this.keys.clear();

    this.playerBike.setColor(this.settings.color);
    this.playerBike.setVisible(true);
    this.playerBike.crashBlend = 0;

    const laneIndex = this.mode === 'lan'
      ? Math.max(0, this.lanInfo?.players?.findIndex((player) => player.id === this.session?.playerId) ?? 0)
      : 0;
    const startLateral = this.mode === 'lan' ? (START_LANES[laneIndex] ?? 0) : 0;
    this.player = {
      name: sanitizeNickname(this.settings.nickname),
      color: this.settings.color,
      state: createRacerState({ lateral: startLateral }),
      bike: this.playerBike,
    };

    this.clearRemotes();
    this.difficulty = difficultyFor(this.settings.difficulty);
    this.punchQueue = 0;
    this.copTimer = 0;
    this.cops = [];
    this.particles?.clear();
    for (const bike of this.copBikes) bike.setVisible(false);
    if (this.mode === 'offline') {
      this.setupAI();
    } else {
      this.setupRemotes();
    }

    this.traffic.reset(0);
    this.race = new RaceManager({ mode: this.mode });
    let countdown = 3.6;
    if (this.mode === 'lan') {
      countdown = (this.startAtEpoch - this.clockNow()) / 1000;
      countdown = clamp(countdown, 0.05, 6);
    }
    this.race.startCountdown(countdown);
    this.hud.reset();
    this.hud.show();
    this.hud.setRivals(this.mode === 'lan'
      ? `${this.lanInfo?.players?.length ?? 1} RIDERS`
      : `${AI_DEFINITIONS.length} RIVALS`);
    this.syncEntities(0);
    this.sound?.startRace();
    this.bindSession();
    this.running = true;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.hudAccumulator = 0;
    this.netAccumulator = 0;
    if (this.manualSim) {
      this.render();
      this.updateHud(performance.now());
    }
    this.startLoop();
  }

  setupAI() {
    this.aiRacers = AI_DEFINITIONS.map((definition, index) => {
      const state = createRacerState({ lateral: definition.lane });
      const bike = this.aiBikes[index];
      bike.setColor(definition.color);
      bike.setVisible(true);
      bike.crashBlend = 0;
      return {
        id: definition.id,
        name: definition.name,
        color: definition.color,
        skill: definition.skill,
        preferredLane: definition.lane,
        laneTarget: definition.lane,
        thinkTimer: Math.random() * 0.2,
        punchTimer: 2 + Math.random() * 3,
        state,
        bike,
      };
    });
  }

  setupRemotes() {
    const players = this.lanInfo?.players ?? [];
    for (const [index, info] of players.entries()) {
      if (info.id === this.session?.playerId) continue;
      this.ensureRemote(info, index);
    }
  }

  ensureRemote(info, indexHint = 0) {
    if (this.remotes.has(info.id)) return this.remotes.get(info.id);
    const lane = START_LANES[indexHint % START_LANES.length] ?? 0;
    const bike = createMotorcycle({ color: info.color, label: info.name });
    this.scene.add(bike.group);
    const remote = {
      id: info.id,
      name: info.name,
      color: info.color,
      bike,
      state: createRacerState({ lateral: lane }),
      currentProgress: 0,
      targetProgress: 0,
      currentLateral: lane,
      targetLateral: lane,
      targetSpeed: 0,
      finished: false,
      lastLateral: lane,
      lastLean: 0,
    };
    this.remotes.set(info.id, remote);
    return remote;
  }

  removeRemote(id) {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.scene.remove(remote.bike.group);
    disposeObject(remote.bike.group);
    this.remotes.delete(id);
  }

  clearRemotes() {
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    for (const bike of this.aiBikes) bike.setVisible(false);
  }

  bindSession() {
    this.unbindSession();
    if (!this.session) return;
    const unsubs = [];
    unsubs.push(this.session.on('raceState', (message) => this.onServerRaceState(message)));
    unsubs.push(this.session.on('raceResults', (message) => this.onServerRaceResults(message)));
    unsubs.push(this.session.on('playerFinished', (message) => {
      if (message.playerId !== this.session?.playerId) return;
      if (this.localFinished) return;
    }));
    unsubs.push(this.session.on('roomState', (message) => this.onRoomStateDuringRace(message)));
    unsubs.push(this.session.on('disconnected', (message) => {
      this.stopFinishRetry();
      this.callbacks.onToast?.('LAN connection lost: ' + (message.reason || 'host unavailable'));
    }));
    this.sessionUnsubs = unsubs;
  }

  unbindSession() {
    for (const unsubscribe of this.sessionUnsubs) unsubscribe();
    this.sessionUnsubs = [];
  }

  onRoomStateDuringRace(message) {
    if (this.mode !== 'lan' || !message.room) return;
    const active = new Set(message.room.players.map((player) => player.id));
    for (const id of [...this.remotes.keys()]) {
      if (!active.has(id)) this.removeRemote(id);
    }
    message.room.players.forEach((player, index) => {
      if (player.id !== this.session?.playerId) this.ensureRemote(player, index);
    });
  }

  onServerRaceState(message) {
    if (this.mode !== 'lan' || !Array.isArray(message.players)) return;
    for (const snapshot of message.players) {
      if (snapshot.id === this.session?.playerId) continue;
      let remote = this.remotes.get(snapshot.id);
      if (!remote) {
        const info = this.lanInfo?.players?.find((player) => player.id === snapshot.id) ?? {
          id: snapshot.id,
          name: snapshot.name || 'Rider',
          color: snapshot.color || '#93a4b6',
        };
        remote = this.ensureRemote(info, this.remotes.size + 1);
      }
      remote.targetProgress = snapshot.progress;
      remote.targetLateral = snapshot.lateral;
      remote.targetSpeed = snapshot.speed;
      remote.finished = Boolean(snapshot.finished);
      if (remote.targetProgress - remote.currentProgress > 60 || remote.currentProgress - remote.targetProgress > 30) {
        remote.currentProgress = remote.targetProgress;
        remote.currentLateral = remote.targetLateral;
      }
    }
  }

  onServerRaceResults(message) {
    if (this.mode !== 'lan') return;
    const raw = Array.isArray(message.results) ? message.results : [];
    if (raw.length === 0) return;
    this.stopFinishRetry();
    const standings = raw.map((entry) => ({
      position: entry.position,
      name: entry.name,
      color: entry.color || '#93a4b6',
      finishTime: entry.finishTime,
      status: entry.status,
      isPlayer: entry.playerId === this.session?.playerId,
    }));
    const me = standings.find((entry) => entry.isPlayer);
    this.stopLoop();
    this.callbacks.onFinish?.({
      placement: me?.position ?? null,
      totalRacers: standings.length,
      totalTime: me?.finishTime ?? null,
      bestLap: this.player?.state?.bestLap ?? null,
      topSpeed: this.player?.state?.topSpeed ?? 0,
      crashes: this.player?.state?.crashCount ?? 0,
      standings,
    }, {
      lan: true,
      waiting: false,
      note: 'Validated and recorded by the host server.',
    });
    this.running = false;
  }

  clockNow() {
    return Date.now() + this.clockOffset;
  }

  raceElapsed() {
    if (this.mode === 'lan') {
      return Math.max(0, (this.clockNow() - this.startAtEpoch) / 1000);
    }
    return this.race?.elapsed ?? 0;
  }

  startLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    const frame = (now) => {
      if (!this.running) {
        this.raf = null;
        return;
      }
      this.raf = requestAnimationFrame(frame);
      const rawDt = Math.min(0.2, (now - this.lastFrame) / 1000 || 0);
      this.lastFrame = now;
      this.fpsAccumulator += rawDt;
      this.fpsFrames += 1;
      if (this.fpsAccumulator >= 0.5) {
        this.fps = Math.round(this.fpsFrames / this.fpsAccumulator);
        this.fpsAccumulator = 0;
        this.fpsFrames = 0;
      }
      this.performanceTimer += rawDt;
      if (this.performanceTimer >= 2 && this.fps > 0) {
        this.performanceTimer = 0;
        if (this.fps < 45 && this.resolutionScale > 0.6) {
          this.resolutionScale = Math.max(0.6, this.resolutionScale - 0.1);
          this.upscaleStreak = 0;
          this.resize();
        } else if (this.fps > 58 && this.resolutionScale < 1) {
          this.upscaleStreak += 1;
          if (this.upscaleStreak >= 3) {
            this.upscaleStreak = 0;
            this.resolutionScale = Math.min(1, this.resolutionScale + 0.05);
            this.resize();
          }
        }
      }

      if (!this.manualSim && !this.paused) {
        this.accumulator += rawDt;
        let steps = 0;
        while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
          this.update(FIXED_DT);
          this.accumulator -= FIXED_DT;
          steps += 1;
        }
        this.render();
      } else if (!this.manualSim) {
        this.render();
      }
      this.hudAccumulator += rawDt;
      if (this.hudAccumulator >= 0.1) {
        this.hudAccumulator = 0;
        this.updateHud(now);
      }
    };
    this.raf = requestAnimationFrame(frame);
  }

  stopLoop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  update(dt) {
    if (!this.race || this.paused) return;
    this.particles?.update(dt);
    const events = this.race.update(dt);
    for (const event of events) {
      if (event.type === 'countdown') {
        this.hud.setCountdown(String(event.value));
        this.sound?.beep(520, 0.1, 0.14);
      } else if (event.type === 'go') {
        this.hud.setCountdown('GO!', 'go');
        this.sound?.beep(880, 0.2, 0.18);
        this.lastFrame = performance.now();
      }
    }

    if (this.race.phase === 'countdown') {
      this.syncEntities(dt);
      return;
    }
    if (this.race.phase !== 'racing') {
      this.syncEntities(dt);
      return;
    }

    this.updatePlayer(dt);
    if (this.localFinished) return;

    if (this.mode === 'offline') {
      this.updateAI(dt);
      this.updateCops(dt);
      this.updateCombat(dt);
    } else this.updateRemotes(dt);

    this.traffic.update(dt, this.player.state.progress);
    this.syncEntities(dt);
    this.updateCollisions(dt);
    this.sendNetworkState(dt);
    this.checkFinish();
  }

  updatePlayer(dt) {
    const state = this.player.state;
    const input = this.readInput();
    const previousProgress = state.progress;
    const sample = sampleAt(state.progress);
    const events = stepRacer(state, input, dt, sample);

    if (events.barrier) {
      const bp = this.player.bike.group.position;
      if (events.impactSpeed > 12) this.particles.burst(bp.x, bp.y + 0.7, bp.z, 10, { r: 1, g: 0.85, b: 0.4, spread: 7 });
      this.cameraController.addShake(clamp(events.impactSpeed / 100, 0.12, 0.75));
      if (events.impactSpeed > 8) this.sound?.crash(clamp(events.impactSpeed / 80, 0.2, 0.65));
      if (events.impactSpeed > 46 && state.invuln <= 0) {
        this.crashPlayer();
      }
    }

    if (state.crashTimer > 0) {
      this.hud.setCrash(true);
    } else {
      this.hud.setCrash(false);
    }

    if (this.punchQueue) {
      const side = this.punchQueue;
      this.punchQueue = 0;
      if (this.mode === 'offline') this.resolvePunch(state, side);
    }
    this.emitBikeEffects(dt);

    const lapTime = this.race.recordLap(state);
    if (lapTime && state.progress < this.race.finishDistance) {
      this.sound?.beep(760, 0.12, 0.1);
    }

    if (state.progress < previousProgress) state.progress = previousProgress;
  }

  emitBikeEffects(dt) {
    const state = this.player.state;
    const group = this.player.bike.group;
    const fx = Math.sin(group.rotation.y);
    const fz = Math.cos(group.rotation.y);
    const rx = group.position.x - fx * 1.25;
    const rz = group.position.z - fz * 1.25;
    if (state.boosting && state.speed > 20) {
      for (let n = 0; n < 2; n++) {
        this.particles.emit({
          x: rx, y: group.position.y + 0.65, z: rz,
          vx: -fx * 9 + (Math.random() - 0.5) * 1.5, vy: 0.4 + Math.random(), vz: -fz * 9 + (Math.random() - 0.5) * 1.5,
          r: 1, g: 0.55 + Math.random() * 0.3, b: 0.15, size: 0.55, alpha: 0.9, life: 0.28, grow: -1.1, drag: 2.2, lift: 0,
        });
      }
    }
    if (state.crashTimer > 0 && Math.random() < dt * 22) {
      this.particles.emit({
        x: group.position.x, y: group.position.y + 0.4, z: group.position.z,
        vx: (Math.random() - 0.5) * 4, vy: 1.5 + Math.random() * 2, vz: (Math.random() - 0.5) * 4,
        r: 0.55, g: 0.5, b: 0.45, size: 1.3, alpha: 0.6, life: 0.9, grow: 1.8, drag: 1.2, lift: 0.5,
      });
    }
    this.hud.setHealth(state.health);
  }

  crashPlayer() {
    if (this.player.state.crashTimer > 0 || this.player.state.invuln > 0) return;
    triggerCrash(this.player.state);
    this.hud.setCrash(true);
    this.cameraController.addShake(1.0);
    this.sound?.crash(1);
  }

  updateCollisions(dt) {
    const state = this.player.state;
    if (state.invuln > 0 || state.crashTimer > 0) return;

    for (const car of this.traffic.all) {
      const delta = car.progress - state.progress;
      if (Math.abs(delta) > 2.6) continue;
      if (Math.abs(car.lateral - state.lateral) > 1.55) continue;
      const closing = state.speed - car.speed;
      const side = Math.sign(state.lateral - car.lateral) || 1;
      if (closing > 20) {
        this.crashPlayer();
      } else if (bumpRacer(state, car, side)) {
        this.sound?.crash(0.35);
        this.cameraController.addShake(0.3);
      }
      break;
    }

    if (this.mode === 'offline') {
      for (const ai of this.aiRacers) {
        const delta = ai.state.progress - state.progress;
        if (Math.abs(delta) > 1.9) continue;
        if (Math.abs(ai.state.lateral - state.lateral) > 1.25) continue;
        const side = Math.sign(state.lateral - ai.state.lateral) || 1;
        if (bumpRacer(state, { speed: ai.state.speed }, side)) {
          ai.state.speed *= 0.82;
          ai.state.lateral = clamp(ai.state.lateral - side * 0.4, -5.4, 5.4);
          this.cameraController.addShake(0.22);
        }
        break;
      }
    }
  }

  updateAI(dt) {
    for (const ai of this.aiRacers) {
      const sample = sampleAt(ai.state.progress);
      const input = computeAIInput(ai, {
        traffic: this.traffic,
        playerProgress: this.player.state.progress,
        playerLateral: this.player.state.lateral,
        elapsed: this.race.elapsed,
        difficulty: this.difficulty,
      }, dt);
      stepRacer(ai.state, input, dt, sample);
      this.race.recordLap(ai.state);
      if (!ai.state.finished && ai.state.progress >= this.race.finishDistance) {
        ai.state.finished = true;
        ai.state.finishTime = this.race.elapsed;
      }
    }
  }

  allFighters() {
    return [this.player.state, ...this.aiRacers.map((ai) => ai.state), ...this.cops.map((cop) => cop.state)];
  }

  fighterPosition(state) {
    return worldPositionAt(state.progress, state.lateral, { x: 0, y: 0, z: 0 });
  }

  resolvePunch(attacker, side, options = {}) {
    const result = punch(attacker, side, this.allFighters(), options);
    if (!result.thrown) return result;
    this.sound?.whoosh();
    if (result.hit) {
      const victim = result.hit;
      const at = this.fighterPosition(victim);
      this.particles.burst(at.x, at.y + 1.6, at.z, result.ko ? 26 : 12, { r: 1, g: 0.78, b: 0.3, spread: 9, life: 0.5 });
      this.sound?.hit(result.ko ? 1 : 0.6);
      if (victim === this.player.state) {
        this.cameraController.addShake(result.ko ? 1 : 0.55);
        this.hud.flashDamage();
      } else if (attacker === this.player.state) {
        this.cameraController.addShake(0.22);
        this.hud.announce(result.ko ? (victim.isCop ? 'COP DOWN!' : 'TAKEDOWN!') : 'HIT!', result.ko ? 'big' : 'small');
      }
      if (result.ko) {
        this.particles.burst(at.x, at.y + 0.6, at.z, 18, { r: 0.7, g: 0.62, b: 0.5, size: 1.1, grow: 2.4, spread: 5, lift: 1, drag: 1.2, life: 0.9, alpha: 0.7 });
      }
    }
    return result;
  }

  updateCombat(dt) {
    const diff = this.difficulty;
    for (const ai of this.aiRacers) {
      ai.punchTimer -= dt;
      if (ai.punchTimer > 0 || !canPunch(ai.state)) continue;
      for (const side of [1, -1]) {
        if (findTarget(ai.state, side, this.allFighters())) {
          this.resolvePunch(ai.state, side, { scale: diff.damage, credit: false });
          ai.punchTimer = (1.7 - diff.aggression * 1.0) + Math.random() * 1.4;
          break;
        }
      }
    }
  }

  updateCops(dt) {
    const player = this.player.state;
    const diff = this.difficulty;
    this.copTimer += dt;
    if (this.cops.length === 0 && this.copTimer > 14 && player.progress > 160) {
      this.cops = this.copBikes.map((bike, index) => {
        const state = createRacerState({ progress: player.progress - 110 - index * 40, lateral: index ? 2 : -2 });
        state.isCop = true;
        state.speed = player.speed;
        bike.setVisible(true);
        bike.crashBlend = 0;
        return { state, bike, bias: index ? -1 : 1, punchTimer: 1.2 + index * 0.9 };
      });
      this.hud.announce('POLICE ON YOUR TAIL!', 'big');
      this.sound?.siren();
    }
    for (const cop of this.cops) {
      const s = cop.state;
      const gap = player.progress - s.progress;
      if (gap > 420 || gap < -260) {
        s.progress = player.progress - 120;
        s.speed = player.speed;
      }
      let target;
      if (gap > 6) target = Math.min(BIKE.maxSpeed * 0.98 * diff.speed, player.speed + 6 + gap * 0.55);
      else if (gap < -10) target = Math.max(20, player.speed * 0.82);
      else target = player.speed + 1;
      const sample = sampleAt(s.progress + 30);
      target = Math.min(target, Math.max(26, sample.safeSpeed * 0.97));
      const laneTarget = clamp(player.lateral + cop.bias * 2.1, -5.2, 5.2);
      const steer = clamp((laneTarget - s.lateral) * 0.6, -1, 1);
      const brake = target < s.speed - 3 ? 1 : 0;
      const throttle = brake ? 0 : target > s.speed ? 1 : 0.2;
      stepRacer(s, { throttle, brake, steer, boost: false }, dt, sampleAt(s.progress));

      cop.punchTimer -= dt;
      if (cop.punchTimer <= 0 && canPunch(s) && Math.abs(gap) < 2.6) {
        const side = Math.sign(player.lateral - s.lateral) || 1;
        if (findTarget(s, side, [player])) {
          this.resolvePunch(s, side, { scale: diff.damage });
          cop.punchTimer = 1.9 - diff.aggression * 0.7 + Math.random();
        }
      }
    }
  }

  queuePunch(side) {
    if (this.mode !== 'offline' || !this.running || this.paused || this.race?.phase !== 'racing') return;
    this.punchQueue = side;
  }

  updateRemotes(dt) {
    const alpha = 1 - Math.exp(-11 * dt);
    for (const remote of this.remotes.values()) {
      const previous = remote.currentLateral;
      remote.currentProgress += (remote.targetProgress - remote.currentProgress) * alpha;
      remote.currentLateral += (remote.targetLateral - remote.currentLateral) * alpha;
      remote.state.progress = remote.currentProgress;
      remote.state.lateral = remote.currentLateral;
      remote.state.speed = remote.targetSpeed;
      remote.state.lean = Math.max(-0.5, Math.min(0.5, (remote.currentLateral - previous) / Math.max(dt, 0.001) * -0.09));
      remote.lastLean = remote.state.lean;
      remote.state.finished = remote.finished;
    }
  }

  sendNetworkState(dt) {
    if (this.mode !== 'lan' || !this.session?.connected) return;
    this.netAccumulator += dt;
    if (this.netAccumulator < 1 / 12) return;
    this.netAccumulator = 0;
    this.session.sendState({
      progress: this.player.state.progress,
      lateral: this.player.state.lateral,
      speed: this.player.state.speed,
      lap: Math.min(this.race.laps, Math.floor(this.player.state.progress / TRACK_LENGTH) + 1),
      finished: this.localFinished,
    });
  }

  checkFinish() {
    if (this.localFinished) return;
    const state = this.player.state;
    if (state.progress >= this.race.finishDistance) this.finishLocal();
  }

  startFinishRetry() {
    this.stopFinishRetry();
    const state = this.player.state;
    const payload = {
      progress: state.progress,
      lateral: state.lateral,
      speed: state.speed,
      lap: this.race.laps,
      finished: true,
    };
    const send = () => {
      if (!this.localFinished || !this.session?.connected) return;
      this.session.sendState(payload);
    };
    send();
    this.finishRetryTimer = setInterval(send, 750);
  }

  stopFinishRetry() {
    if (this.finishRetryTimer) clearInterval(this.finishRetryTimer);
    this.finishRetryTimer = null;
  }

  finishLocal() {
    const state = this.player.state;
    state.finished = true;
    state.finishTime = this.raceElapsed();
    this.localFinished = true;
    this.stopLoop();
    this.sound?.finish();

    if (this.mode === 'lan') {
      this.startFinishRetry();
      const provisional = this.provisionalStandings();
      this.callbacks.onFinish?.({
        placement: provisional.find((entry) => entry.isPlayer)?.position ?? null,
        totalRacers: provisional.length,
        totalTime: state.finishTime,
        bestLap: state.bestLap,
        topSpeed: state.topSpeed,
        crashes: state.crashCount,
        standings: provisional,
      }, {
        lan: true,
        waiting: true,
        note: 'Waiting for the host server to validate the finish and record the result…',
      });
      this.running = false;
      return;
    }

    const results = this.race.standOfflineResults(this.player, this.aiRacers, state.finishTime);
    this.running = false;
    this.callbacks.onFinish?.(results, { lan: false, waiting: false });
  }

  provisionalStandings() {
    const entries = [
      {
        id: this.session?.playerId ?? 'player',
        name: this.player.name,
        color: this.player.color,
        progress: this.player.state.progress,
        finished: true,
        finishTime: this.player.state.finishTime,
        isPlayer: true,
      },
      ...[...this.remotes.values()].map((remote) => ({
        id: remote.id,
        name: remote.name,
        color: remote.color,
        progress: remote.currentProgress,
        finished: remote.finished,
        finishTime: remote.state.finishTime,
        isPlayer: false,
      })),
    ];
    entries.sort((a, b) => {
      if (a.finished && b.finished) return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    return entries.map((entry, index) => ({
      position: index + 1,
      name: entry.name,
      color: entry.color,
      finishTime: entry.finishTime,
      status: entry.finished ? 'completed' : 'racing',
      isPlayer: entry.isPlayer,
    }));
  }

  syncEntities(dt) {
    if (!this.player) return;
    const playerState = this.player.state;
    const sample = sampleAt(playerState.progress);
    const pos = worldPositionAt(playerState.progress, playerState.lateral, this.tmp);
    this.player.bike.group.position.set(pos.x, pos.y + 0.14, pos.z);
    this.player.bike.group.rotation.y = sample.heading + playerState.steerValue * 0.06;
    this.player.bike.update(dt, {
      speed: playerState.speed,
      lean: playerState.lean,
      steer: playerState.steerValue,
      crashTimer: playerState.crashTimer,
      boosting: playerState.boosting && playerState.speed > 20,
      punch: playerState.punchAnim,
      punchSide: playerState.punchSide,
    });
    this.cameraTarget.set(pos.x, pos.y + 0.6, pos.z);

    for (const ai of this.aiRacers) {
      const aiSample = sampleAt(ai.state.progress);
      const aiPos = worldPositionAt(ai.state.progress, ai.state.lateral, this.tmp);
      ai.bike.group.position.set(aiPos.x, aiPos.y + 0.14, aiPos.z);
      ai.bike.group.rotation.y = aiSample.heading + ai.state.steerValue * 0.06;
      ai.bike.update(dt, {
        speed: ai.state.speed,
        lean: ai.state.lean,
        steer: ai.state.steerValue,
        crashTimer: ai.state.crashTimer,
        boosting: false,
        punch: ai.state.punchAnim,
        punchSide: ai.state.punchSide,
      });
    }

    for (const cop of this.cops) {
      const copSample = sampleAt(cop.state.progress);
      const copPos = worldPositionAt(cop.state.progress, cop.state.lateral, this.tmp);
      cop.bike.group.position.set(copPos.x, copPos.y + 0.14, copPos.z);
      cop.bike.group.rotation.y = copSample.heading + cop.state.steerValue * 0.06;
      cop.bike.update(dt, {
        speed: cop.state.speed,
        lean: cop.state.lean,
        steer: cop.state.steerValue,
        crashTimer: cop.state.crashTimer,
        punch: cop.state.punchAnim,
        punchSide: cop.state.punchSide,
      });
    }

    for (const remote of this.remotes.values()) {
      const remoteSample = sampleAt(remote.currentProgress);
      const remotePos = worldPositionAt(remote.currentProgress, remote.currentLateral, this.tmp);
      remote.bike.group.position.set(remotePos.x, remotePos.y + 0.14, remotePos.z);
      remote.bike.group.rotation.y = remoteSample.heading;
      remote.bike.update(dt, {
        speed: remote.targetSpeed,
        lean: remote.state.lean,
        steer: 0,
        crashTimer: 0,
        boosting: false,
      });
    }

    const speedRatio = Math.min(1, playerState.speed / BIKE.maxSpeed);
    this.cameraController.update(
      dt,
      this.cameraTarget,
      sample.heading,
      speedRatio,
      {
        crashTimer: playerState.crashTimer,
        lean: playerState.lean,
        boosting: playerState.boosting,
      },
    );

    this.faceLabel(this.playerBike);
    for (const ai of this.aiRacers) this.faceLabel(ai.bike);
    for (const remote of this.remotes.values()) this.faceLabel(remote.bike);
  }

  faceLabel(bike) {
    const label = bike?.nameLabel;
    if (label && this.camera) label.lookAt(this.camera.position);
  }

  render() {
    if (!this.scene || !this.camera) return;
    if (this.particles) this.particles.setViewport(this.renderer.domElement.height, this.camera.fov);
    this.renderer.render(this.scene, this.camera);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
  }

  updateHud() {
    if (!this.player || !this.race || !this.hud) return;
    const state = this.player.state;
    const elapsed = this.mode === 'lan' ? this.raceElapsed() : this.race.elapsed;
    const lapTime = Math.max(0, elapsed - state.lapStartTime);
    let position = 1;
    let total = 1;
    if (this.mode === 'offline') {
      position += this.aiRacers.filter((ai) => ai.state.progress > state.progress).length;
      total += this.aiRacers.length;
    } else {
      position += [...this.remotes.values()].filter((remote) => remote.currentProgress > state.progress).length;
      total += this.remotes.size;
    }
    this.hud.update({
      position,
      total,
      lap: this.race.lapNumber(state.progress),
      laps: this.race.laps,
      elapsed,
      speedKph: state.speed * 3.6,
      bestLap: state.bestLap,
      lapTime,
      progress: this.race.progressFraction(state.progress),
      boost: state.boost,
      fps: this.fps,
    });
    this.sound?.update(
      Math.min(1, state.speed / BIKE.maxSpeed),
      this.readInput().throttle,
      state.boosting,
    );
  }

  readInput() {
    if (this.debugInput) return { ...this.debugInput };
    if (!this.race || this.race.phase !== 'racing' || this.paused) {
      return { throttle: 0, brake: 0, steer: 0, boost: false };
    }
    const up = this.keys.has('w') || this.keys.has('arrowup');
    const down = this.keys.has('s') || this.keys.has('arrowdown');
    const left = this.keys.has('a') || this.keys.has('arrowleft');
    const right = this.keys.has('d') || this.keys.has('arrowright');
    return {
      throttle: up ? 1 : 0,
      brake: down ? 1 : 0,
      steer: (left ? 1 : 0) - (right ? 1 : 0),
      boost: this.keys.has('shift'),
    };
  }

  pause() {
    if (!this.running || this.paused || !this.race) return;
    if (this.race.phase === 'finished') return;
    this.paused = true;
    this.keys.clear();
    this.sound?.stopRace();
    this.callbacks.onPauseChange?.(true);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.sound?.startRace();
    this.callbacks.onPauseChange?.(false);
  }

  stopRace() {
    this.stopLoop();
    this.stopFinishRetry();
    this.running = false;
    this.paused = false;
    this.localFinished = false;
    this.unbindSession();
    this.session = null;
    this.lanInfo = null;
    this.debugInput = null;
    this.keys.clear();
    this.sound?.stopRace();
    this.clearRemotes();
    this.aiRacers = [];
    this.cops = [];
    for (const bike of this.copBikes) bike.setVisible(false);
    this.particles?.clear();
    this.race = null;
    this.player = null;
    this.mode = 'offline';
    if (this.scene) {
      this.resetMenuPose();
      this.render();
    }
  }

  onKeyDown(event) {
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const key = event.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) {
      event.preventDefault();
    }
    if (key === 'escape') {
      if (this.callbacks.onEscape) this.callbacks.onEscape();
      return;
    }
    if (!event.repeat && (key === 'q' || key === 'z')) { this.queuePunch(1); return; }
    if (!event.repeat && (key === 'e' || key === 'x')) { this.queuePunch(-1); return; }
    if (key === 'r' && this.callbacks.onRestartKey) {
      this.callbacks.onRestartKey();
      return;
    }
    this.keys.add(key);
  }

  onKeyUp(event) {
    this.keys.delete(event.key.toLowerCase());
  }

  onBlur() {
    this.keys.clear();
  }

  getDebugState() {
    const state = this.player?.state;
    let screenLateral = 0;
    if (state && this.playerBike && this.camera) {
      const center = worldPositionAt(state.progress, 0);
      this.camera.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const horizontal = Math.hypot(right.x, right.z) || 1;
      screenLateral = (
        (this.playerBike.group.position.x - center.x) * right.x
        + (this.playerBike.group.position.z - center.z) * right.z
      ) / horizontal;
    }
    return {
      ready: this.ready,
      running: this.running,
      paused: this.paused,
      manualSim: this.manualSim,
      mode: this.mode,
      raceState: this.race?.phase ?? 'idle',
      phase: this.race?.phase ?? 'idle',
      speed: state?.speed ?? 0,
      speedKph: state ? state.speed * 3.6 : 0,
      lateral: state?.lateral ?? 0,
      screenLateral,
      progress: state?.progress ?? 0,
      finishDistance: this.race?.finishDistance ?? 0,
      lap: state ? this.race?.lapNumber(state.progress) ?? 1 : 0,
      laps: this.race?.laps ?? RACE_CONFIG.laps,
      elapsed: this.race ? this.raceElapsed() : 0,
      crashes: state?.crashCount ?? 0,
      boost: state?.boost ?? 0,
      position: document.getElementById('hud-position')?.textContent ?? '',
      hudSpeed: document.getElementById('hud-speed')?.textContent ?? '',
      resultsVisible: !document.getElementById('results-screen')?.classList.contains('hidden'),
      menuVisible: !document.getElementById('menu-screen')?.classList.contains('hidden'),
      aiCount: this.aiRacers.length,
      copCount: this.cops.length,
      health: state?.health ?? 100,
      takedowns: state?.takedowns ?? 0,
      remoteCount: this.remotes.size,
      trafficCount: this.traffic?.active?.length ?? 0,
      drawCalls: this.stats.calls,
      triangles: this.stats.triangles,
      fps: this.fps,
      drawSize: this.renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
      sceneChildren: this.scene?.children.length ?? 0,
      playerVisible: this.playerBike?.group.visible ?? false,
      playerColor: this.playerBike?.bodyMat?.color?.getHexString?.() ?? '',
      hasLabel: Boolean(this.playerBike?.nameLabel),
      cameraPosition: this.camera ? this.camera.position.toArray() : [],
      bikePosition: this.playerBike ? this.playerBike.group.position.toArray() : [],
    };
  }

  debugStep(seconds) {
    if (!this.race) return this.getDebugState();
    this.paused = false;
    const steps = Math.min(3600, Math.max(1, Math.round(seconds / FIXED_DT)));
    for (let i = 0; i < steps; i++) {
      this.update(FIXED_DT);
      if (this.localFinished) break;
    }
    this.syncEntities(FIXED_DT);
    this.render();
    this.updateHud();
    return this.getDebugState();
  }

  setDebugInput(input) {
    this.debugInput = input ? {
      throttle: input.throttle ?? 0,
      brake: input.brake ?? 0,
      steer: input.steer ?? 0,
      boost: Boolean(input.boost),
    } : null;
  }

  forceRaceStart() {
    if (this.race?.phase === 'countdown') {
      this.race.forceStart();
      this.hud.setCountdown(null);
    }
  }

  finishNow() {
    if (!this.race || this.race.phase !== 'racing') return;
    this.player.state.progress = Math.max(this.player.state.progress, this.race.finishDistance - 0.01);
    this.player.state.speed = Math.max(this.player.state.speed, 20);
    this.finishLocal();
  }
}
