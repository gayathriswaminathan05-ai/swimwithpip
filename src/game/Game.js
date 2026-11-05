import * as THREE from 'three';
import { Scheduler, isCancel } from './core/scheduler.js';
import { CameraRig } from './core/rig.js';
import { Ease, lerp, damp, smoothstep, clamp, TAU } from './core/util.js';
import { Ocean, ZONES } from './world/ocean.js';
import { CurrentStreaks } from './world/streaks.js';
import { CurrentBand } from './world/currentband.js';
import { Pip } from './actors/fish.js';
import { School } from './actors/school.js';
import { Whale } from './actors/creatures.js';
import { SeaLife } from './actors/sealife.js';
import { buildTreasure } from './actors/props.js';
import { ThoughtBubble } from './actors/thought.js';
import { FX } from './gfx/fx.js';
import { globalUniforms, GlowPoints } from './gfx/materials.js';
import { AudioFX } from './audio.js';
import { UI } from './ui/ui.js';
import { QuestionDeck } from './logic/quiz.js';
import { RunState } from './logic/run.js';
import { QUESTIONS } from '../data/questions.js';
import { createEncounters, HOME_S } from './encounters/index.js';
import { loadCoralKit } from './world/kit.js';

export const QUALITY = {
  low: { name: 'low', pixelRatio: 1, snow: 200, decor: 0.5, shafts: false, caustics: false, fogScale: 0.85, particles: 0.6, school: 12 },
  medium: { name: 'medium', pixelRatio: 1.5, snow: 420, decor: 0.75, shafts: true, caustics: true, fogScale: 1, particles: 0.8, school: 16 },
  high: { name: 'high', pixelRatio: 2, snow: 750, decor: 1, shafts: true, caustics: true, fogScale: 1, particles: 1, school: 20 },
};
const QUALITY_ORDER = ['low', 'medium', 'high'];
const SETTINGS_KEY = 'pip-way-home-settings';
const TITLE_S = -34;
const TITLE_S_INTRO = TITLE_S - 20;
const START_S = -8;
const CRUISE_SPEED = 6.4;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function loadSettings() {
  const defaults = { muted: false, quality: 'auto', motion: 'system', difficulty: 'medium', showSkip: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  constructor(canvas) {
    // (Hurdle count comes from createEncounters(); the HUD and run state follow it.)
    this.canvas = canvas;
    this.params = new URLSearchParams(location.search);
    this.timeScale = clamp(Number(this.params.get('speed')) || 1, 0.1, 8);
    this.seed = this.params.has('seed') ? Number(this.params.get('seed')) : undefined;
    this.settings = loadSettings();
    if (this.params.get('quality')) this.settings.quality = this.params.get('quality');
    this.state = 'loading';
    this.paused = false;
    this.clock = 0;
    this.drive = 'hover';
    this.s = 0;
    this.pipS = 0;
    this.speed = 0;
    this.cruiseSpeed = CRUISE_SPEED;
    this.cruiseOffset = new THREE.Vector3();
    this.hoverPoint = new THREE.Vector3();
    this.zone = 0;
    this.fpsWindow = { t: 0, frames: 0 };
    this.cruiseShotIndex = 0;
    this.cruiseShotTimer = 0;
    this.cameraMode = 'title';
  }

  // =====================================================================
  // Setup
  // =====================================================================
  async init(progress) {
    progress(0.55, 'Preparing the ocean…');
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('WebGL is not available');
    this.renderer = renderer;
    renderer.setClearColor(0x04182b);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 240);
    this.rig = new CameraRig(this.camera);
    this.sched = new Scheduler();
    this.qualityName = this._resolveQuality(this.settings.quality);
    this.quality = QUALITY[this.qualityName];
    // Low quality also drops the interface's live glass blur (near-solid panels instead).
    document.documentElement.classList.toggle('glass-lite', this.qualityName === 'low');
    this.ocean = new Ocean(this.scene, this.quality);
    await nextFrame();

    progress(0.68, 'Waking up Pip…');
    this.pip = new Pip();
    this.scene.add(this.pip.group);
    this.pip.light = this.ocean.pipLight;
    this.pip.lightBase = 4;
    // Pip's family: the same little lanternfish, without Pip's head light.
    this.school = new School(this.scene, 24, { haloOpacity: 0.4, scale: 0.6 });
    this.school.mesh.count = this.quality.school;
    this.fx = new FX(this.scene, this.quality);
    CurrentStreaks.camera = this.camera;
    // The intro's current: a big, bold stream of rushing water with ribbons whipping through it.
    this.introBand = new CurrentBand({ length: 56, width: 3.8, height: 2.2, wiggle: 0.7, flow: 3.6, boost: 0.3 });
    this.scene.add(this.introBand.group);
    this.streaks = new CurrentStreaks(34, { length: 52, radius: [0.3, 2.3], seed: 11, opacity: 0.6, width: 0.18 });
    this.streaks.flow = 24;
    this.streaks.spin = 0.35;
    this.introBand.group.add(this.streaks.mesh);
    // "?" thought bubble for when Pip realises it is lost.
    this.thought = new ThoughtBubble();
    this.scene.add(this.thought.sprite);
    this.currentPush = new THREE.Vector2();
    this.currentPushTarget = new THREE.Vector2();
    this.whale = new Whale();
    this.whale.group.visible = false;
    this.scene.add(this.whale.group);
    // The sunken treasure Pip explores in the opening story (stays on the sea floor afterwards).
    this._treasure = buildTreasure();
    this._treasure.visible = false;
    this.scene.add(this._treasure);
    this.seaLife = new SeaLife(this);
    await nextFrame();

    progress(0.76, 'Growing corals…');
    try {
      const kit = await loadCoralKit((p) => progress(0.76 + p * 0.08, 'Growing corals…'));
      this.ocean.setKit(kit);
    } catch (e) {
      // The reef still works with procedural corals only.
      console.warn('Coral models could not be loaded; using procedural corals.', e);
    }
    progress(0.85, 'Placing the hurdles…');
    this.audio = new AudioFX();
    this.audio.setMuted(this.settings.muted);
    this.ui = new UI(this._handlers());
    this.ui.setDifficulty(this.settings.difficulty);
    this.resetWorld();
    this.ui.buildTrack(this.encounters.map((e) => e.s / HOME_S));
    this._applyMotion();
    this._syncSettingsUI();
    await nextFrame();

    progress(0.9, 'Warming up shaders…');
    this.onResize();
    this.ocean.update(0.016, TITLE_S, this.camera);
    this.renderer.compile(this.scene, this.camera);
    await nextFrame();
    progress(1, 'Ready!');

    this._bindWindow();
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop((now) => this._loop(now));
    this.toTitle();
    window.__pip = this._debugApi();
  }

  _resolveQuality(pref) {
    if (QUALITY[pref]) return pref;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    return coarse || small ? 'medium' : 'high';
  }

  _handlers() {
    return {
      onStart: (d) => this.startGame(d),
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onQuit: () => this.quitToTitle(),
      onSkip: () => this.skipIntro(),
      onEscape: () => (this.paused ? this.resume() : this.pause()),
      onToggleSound: () => this.setMuted(!this.settings.muted),
      onToggleSkip: () => {
        this.settings.showSkip = !this.settings.showSkip;
        this._save();
        this._syncSettingsUI();
      },
      onQuality: (q) => this.setQuality(q),
      onMotion: (m) => this.setMotion(m),
      onDifficulty: (d) => {
        this.settings.difficulty = d;
        this._save();
      },
      onLayout: () => this.updateLayout(),
      onTap: () => this.audio.tap(),
      isPaused: () => this.paused,
    };
  }

  _bindWindow() {
    const onResize = () => {
      this.onResize();
      // Mobile browsers settle their toolbars a moment after rotating.
      setTimeout(() => this.onResize(), 250);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause();
        this.audio.suspend();
      } else if (!this.paused) {
        this.audio.resume();
      }
    });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => this.updateLayout());
      ro.observe(document.getElementById('quiz'));
      ro.observe(document.getElementById('hud'));
    }
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => this._applyMotion());
  }

  onResize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.renderer.setSize(w, h, false);
    this.rig.setSize(w, h);
    this.W = w;
    this.H = h;
    this.updateLayout();
    this.needsRender = true;
  }

  updateLayout() {
    if (!this.ui || !this.W) return;
    let rect;
    if (this.state === 'title' && !document.getElementById('title').hidden) {
      const top = document.querySelector('.title__top').getBoundingClientRect();
      const bottom = document.querySelector('.title__bottom').getBoundingClientRect();
      const landscape = this.W > this.H * 1.2 && this.H < 560;
      rect = landscape ? { x: 0, y: 0, w: this.W, h: this.H } : { x: 0, y: top.bottom, w: this.W, h: Math.max(120, bottom.top - top.bottom) };
    } else {
      rect = this.ui.freeRect(this.W, this.H);
    }
    this.rig.setFreeRegion(rect);
  }

  // =====================================================================
  // Settings
  // =====================================================================
  _save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode */
    }
  }

  setMuted(m) {
    this.settings.muted = m;
    this.audio.unlock();
    this.audio.setMuted(m);
    this._save();
    this._syncSettingsUI();
  }

  setQuality(pref) {
    this.settings.quality = pref;
    this._save();
    this._applyQuality(this._resolveQuality(pref));
    this._syncSettingsUI();
  }

  _applyQuality(name) {
    if (name === this.qualityName) return;
    this.qualityName = name;
    this.quality = QUALITY[name];
    document.documentElement.classList.toggle('glass-lite', name === 'low');
    this.school.mesh.count = this.quality.school;
    this.ocean.setQuality(this.quality);
    this.onResize();
  }

  setMotion(pref) {
    this.settings.motion = pref;
    this._save();
    this._applyMotion();
  }

  _applyMotion() {
    const m = this.settings.motion;
    const system = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.reduced = m === 'on' || (m === 'system' && system);
    this.rig.reducedMotion = this.reduced;
    document.documentElement.classList.toggle('reduced-motion', this.reduced);
    this._syncSettingsUI();
  }

  _syncSettingsUI() {
    if (!this.ui) return;
    const auto = this.settings.quality === 'auto';
    this.ui.syncSettings({
      muted: this.settings.muted,
      quality: this.settings.quality,
      motion: this.settings.motion,
      qualityNote: auto ? `Auto is using ${this.qualityName} quality on this device.` : '',
      showSkip: this.settings.showSkip,
    });
  }

  // =====================================================================
  // World & route
  // =====================================================================
  resetWorld() {
    this.sched.cancelAll();
    this.fx.clear();
    if (this.encounters) this.encounters.forEach((e) => e.dispose());
    this.encounters = createEncounters(this);
    this.spans = this.encounters.map((e) => [e.s - e.approachFrom, e.s + e.exit]);
    this.ocean.setClearZones(this.encounters.map((e) => ({ s0: e.s - 18, s1: e.s + e.exit + 6, halfWidth: e.clearHalfWidth })));
    this.ocean.reset();
    this.encounters.forEach((e) => e.build());
    this.run = new RunState(this.encounters.length);
    this.currentEnc = null;
    this.triggers = this._makeTriggers();
    this.zone = 0;
    this.audio.setZone(0);

    const pip = this.pip;
    pip.group.visible = true;
    pip.swimmer.extraRoll = 0;
    pip.swimmer.extraPitch = 0;
    pip.swimmer.effort = 0;
    pip.swimmer.faceDir = null;
    pip.squash = 0;
    pip.glowBoost = 1;
    pip.flash = 0;
    pip.group.scale.setScalar(1);
    pip.lookOverride = null;
    pip.shiver = 0;
    pip.swimmer.minSpeedForHeading = 0.6;
    pip.setExpression('neutral');
    this.thought.reset();
    this.rig.extraRoll = 0;

    this.school.setVisible(true);
    this.school.mode = 'escort';
    this.school.spread = 1;
    this.school.sync = 0;
    this.school.glowU.value = 1;
    this.whale.group.visible = false;
    if (this._treasure) this._treasure.visible = false;
    if (this.seaLife) this.seaLife.reset();
    this.streaks.target = 0;
    this.streaks.strength = 0;
    if (this.introBand) {
      this.introBand.target = 0;
      this.introBand.strength = 0;
      this.introBand.front = 2;
    }
    this.ocean.darkTarget = 0;
    this.ocean.darkness = 0;
    this.ocean.tintTarget = 0;
    this.ocean.hazardLight.intensity = 0;
    this.cruiseOffset.set(0, 0, 0);
    this.speed = 0;
    this.cameraMode = 'title';
  }

  routeWindow(s) {
    let w = 1;
    for (const [a, b] of this.spans) {
      const d = s < a ? a - s : s > b ? s - b : 0;
      w = Math.min(w, smoothstep(0, 12, d));
    }
    return w;
  }

  route(s, out = new THREE.Vector3()) {
    const w = this.routeWindow(s);
    return out.set((Math.sin(s * 0.045) * 2.2 + Math.sin(s * 0.11 + 1) * 0.9) * w, Math.sin(s * 0.06 + 1) * 1.1 * w, -s);
  }

  // =====================================================================
  // Pip movement helpers (used by encounters and cutscenes)
  // =====================================================================
  hoverAt(point, faceDir = null) {
    this.drive = 'hover';
    this.hoverPoint.copy(point);
    this.pip.swimmer.faceDir = faceDir ? faceDir.clone() : new THREE.Vector3(0, 0, -1);
  }

  /** Move Pip along a smooth curve through world points over `duration` seconds. */
  swimPath(points, duration, ease = Ease.inOutSine, onUpdate) {
    this.drive = 'script';
    this.pip.swimmer.faceDir = null;
    const pts = points.filter((p, i) => i === 0 || p.distanceToSquared(points[i - 1]) > 1e-6);
    if (pts.length < 2) return this.sched.wait(duration);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    return this.sched.tween(
      duration,
      (k, dt, raw) => {
        curve.getPointAt(clamp(k, 0, 1), this.pip.position);
        if (onUpdate) onUpdate(k, raw);
      },
      ease,
    );
  }

  resumeCruise() {
    this.s = -this.pip.position.z;
    this.route(this.s, _v);
    this.cruiseOffset.subVectors(this.pip.position, _v);
    this.speed = Math.max(2, Math.min(this.cruiseSpeed, this.pip.swimmer.speed));
    this.drive = 'cruise';
    this.pip.swimmer.faceDir = null;
    this.cameraMode = 'cruise';
    this.cruiseShotTimer = 0;
    this._applyCruiseShot(false);
  }

  shake(a) {
    this.rig.shake(a);
  }

  _cruiseShots() {
    return [
      { yaw: 0.32, pitch: 0.12, radius: 3.3 },
      { yaw: 1.25, pitch: 0.08, radius: 3.8 },
      { yaw: 0.12, pitch: 0.26, radius: 4.8 },
      { yaw: -0.55, pitch: 0.1, radius: 3.4 },
    ];
  }

  _applyCruiseShot(next = true) {
    if (next) this.cruiseShotIndex = (this.cruiseShotIndex + 1) % 4;
    const s = this._cruiseShots()[this.cruiseShotIndex];
    this.rig.setShot({ target: this.pip.group, offset: _v2.set(0, 0.35, -1.6), ...s, rate: 3, rotRate: 0.5 });
  }

  // =====================================================================
  // Flow: title → intro → rules → journey → game over / victory
  // =====================================================================
  toTitle() {
    this.state = 'title';
    this.paused = false;
    this.resetWorld();
    this.ui.hideScreens();
    this.ui.clearTransient();
    this.ui.showHUD(false);
    this.ui.fade(false, 600);
    this.route(TITLE_S, _v);
    this.pip.swimmer.teleport(_v, new THREE.Vector3(0, 0, -1));
    this.ocean.prime(TITLE_S);
    this.hoverAt(_v);
    this.pip.swimmer.effort = 0.25;
    this.school.mode = 'escort';
    this.school.spread = 1;
    this.school.forward.set(0, 0, -1);
    this.school.snapTo(_v2.copy(_v).add(new THREE.Vector3(-2.2, 0.8, 0.4)));
    this.cameraMode = 'title';
    this.rig.setShot({ target: this.pip.group, offset: new THREE.Vector3(-1.2, 0.7, 0), yaw: 1.45, pitch: 0.24, radius: 5.6, rate: 2, rotRate: 0.6 }, true);
    this.ui.show('title', 'btn-start');
    requestAnimationFrame(() => {
      this.updateLayout();
      this.rig.snap();
    });
  }

  async startGame(difficulty) {
    if (this.state !== 'title') return;
    this.audio.unlock();
    this.audio.tap();
    this.settings.difficulty = difficulty;
    this._save();
    this.deck = new QuestionDeck(QUESTIONS, difficulty, this.seed);
    this.ui.hide('title');
    this.state = 'intro';
    this.updateLayout();
    this.ui.showSkip(true);
    let completed = false;
    try {
      await this.intro();
      completed = true;
    } catch (e) {
      if (!isCancel(e)) console.error(e);
    }
    if (this.state !== 'intro') return; // quit during intro
    this.ui.showSkip(false);
    this.ui.hideCaption();
    this._afterIntro(completed);
    this.state = 'rules';
    await this.ui.rules();
    if (this.state !== 'rules') return;
    this.audio.tap();
    this.beginJourney();
  }

  skipIntro() {
    if (this.state !== 'intro') return;
    this.audio.tap();
    this.sched.cancelAll();
  }

  async intro() {
    const ui = this.ui;
    const pip = this.pip;
    const school = this.school;
    pip.swimmer.effort = 0;
    pip.setExpression('happy');
    // 1. Swimming together, side by side, all in one direction.
    this.cameraMode = 'intro';
    this.s = TITLE_S - 20;
    this.route(this.s, _v);
    pip.swimmer.teleport(_v, new THREE.Vector3(0, 0, -1));
    this.ocean.prime(this.s);
    this.cruiseSpeed = 3.8;
    this.speed = 3.8;
    this.cruiseOffset.set(1.3, -0.3, 0);
    this.drive = 'cruise';
    school.setVisible(true);
    school.mode = 'escort';
    school.anchor = null;
    school.spread = 0.85;
    school.forward.set(0, 0, -1);
    const schoolOffset = new THREE.Vector3(-1.6, 0.7, 0.6);
    school.snapTo(_v2.copy(pip.position).add(schoolOffset));
    school.fish.forEach((f) => f.vel.set(0, 0, -3.8));
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(-1.4, 0.5, 0), yaw: 1.5, pitch: 0.06, radius: 5.4, rate: 2.5, rotRate: 1 }, true);
    ui.caption('Deep in the ocean, little Pip swam with its family — all together, all in one direction.');
    await this.sched.tween(5, () => school.center.copy(pip.position).add(schoolOffset));

    // 2. Curiosity: something shiny on the sea floor — gold coins and an old treasure chest.
    const treasure = this._treasure;
    const tS = -pip.position.z + 7;
    const tX = 1.8;
    treasure.position.set(tX, this.ocean.surfaceHeight(tX, tS), -tS);
    treasure.userData.ground((x, z) => this.ocean.surfaceHeight(x, -z));
    treasure.visible = true;
    const coinSpot = treasure.position.clone().add(new THREE.Vector3(-0.2, 0.75, 1.3));
    ui.caption('But Pip was a curious little fish… what was that shining on the sea floor?');
    pip.setExpression('hopeful');
    pip.lookOverride = [0.4, -0.5];
    await this.sched.tween(1.6, (k, dt) => {
      school.center.copy(pip.position).add(schoolOffset);
      treasure.userData.update(dt);
    });
    // Pip wanders off to explore. The family swims on a little, then stops and turns around to
    // wait for Pip — still close by when the current strikes.
    const schoolStart = school.center.clone();
    const schoolWait = coinSpot.clone().add(new THREE.Vector3(-1.4, 3.2, -9.5));
    let schoolT = 0;
    let schoolTurn = 0;
    const schoolMove = (dt) => {
      schoolT += dt;
      school.center.lerpVectors(schoolStart, schoolWait, Ease.outQuad(Math.min(1, schoolT / 5.8)));
      // Turn back towards Pip once they notice Pip is missing.
      const a = smoothstep(4.0, 5.6, schoolT) * (Math.PI - 0.3);
      if (a !== schoolTurn) {
        schoolTurn = a;
        school.forward.set(Math.sin(a), 0, -Math.cos(a));
      }
    };
    // (Cut, rather than swinging round through the reef wall.)
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(-0.4, 0.5, -1.5), yaw: -0.08, pitch: 0.2, radius: 3.8, rate: 2, rotRate: 0.8 }, true);
    const p0 = pip.position.clone();
    await this.swimPath([p0, p0.clone().add(_v.set(0.6, -0.9, -2.6)), coinSpot], 3.4, Ease.inOutSine, (k, raw) => {
      schoolMove(raw * 3.4 - schoolT);
    });
    ui.caption('Gold coins from an old sunken treasure chest! Pip had never seen anything so shiny.');
    pip.lookOverride = [0, -0.6];
    this.hoverAt(pip.position.clone(), new THREE.Vector3(0.2, -0.5, -1));
    this.rig.setShot({ target: treasure, offset: new THREE.Vector3(-0.2, 0.7, 0.6), yaw: 0.8, pitch: 0.28, radius: 2.6, rate: 2, rotRate: 0.8 });
    await this.sched.tween(2.4, (k, dt) => {
      schoolMove(dt);
      treasure.userData.update(dt);
    });
    pip.lookOverride = null;

    // 3. A powerful current roars down the reef. It flings the family up and away, then grabs
    //    Pip and drags it, tumbling, far back the way they came.
    const band = this.introBand;
    const P0 = pip.position.clone();
    const L = band.length;
    // The stream runs back along +Z (away from home), hugging the sea floor. Pip sits about a
    // third of the way along it, the waiting family near its upstream end.
    band.group.position.set(P0.x - 0.3, P0.y + 0.5, P0.z + (0.5 - 0.36) * L);
    band.group.rotation.set(0, -Math.PI / 2, 0);
    band.group.updateMatrixWorld(true);
    band.front = 0;
    band.target = 0;
    this.streaks.target = 0;
    ui.caption('Suddenly, a powerful current came roaring down the reef!');
    this.audio.roar(8.5);
    // Wide shot from behind Pip: Pip down by the treasure, the family waiting further ahead.
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(-0.4, 0.5, -2.6), yaw: 0.1, pitch: 0.26, radius: 4.8, rate: 2.2, rotRate: 1.5 }, true);
    pip.setExpression('scared');
    pip.lookOverride = [0, 0.5];
    pip.shiver = 1.4;
    // A wall of churning water and sand appears far up the reef and comes rushing towards them.
    band.strength = 0.9;
    band.target = 1.35;
    await this.sched.tween(1.0, (k, dt) => {
      schoolMove(dt);
      treasure.userData.update(dt);
      band.front = 0.08 + k * 0.07;
      this._sandWall(dt, band.front, 0.8);
      this._camRumble(0.25 * k);
    });
    let familyHit = false;
    const rush = (dt) => {
      band.front = Math.min(1.02, band.front + dt * 0.62);
      this._sandWall(dt, band.front, 1);
      this._introDebris(dt, band.front);
      if (!familyHit && band.front > 0.19) {
        familyHit = true;
        // The family is caught by the top of the stream and flung up and away, out of the reef.
        school.scatter(new THREE.Vector3(0, 0.75, -0.65), 9);
        this.audio.whoosh();
      }
    };
    await this.sched.tween(0.6, (k, dt) => {
      if (!familyHit) schoolMove(dt);
      treasure.userData.update(dt);
      rush(dt);
      this._camRumble(0.35);
    });
    // Impact: the current hits Pip.
    this.audio.whoosh();
    this.audio.thud();
    this.shake(1.1);
    this.streaks.target = 1;
    this.ocean.murkTarget = 0.85; // the water fills with stirred-up sand
    pip.lookOverride = null;
    pip.shiver = 0;
    const endS = -(P0.z + 22);
    const endX = P0.x * 0.4;
    const end = new THREE.Vector3(endX, this.ocean.surfaceHeight(endX, endS) + 0.9, P0.z + 22);
    const path = new THREE.CatmullRomCurve3(
      [
        P0.clone(),
        P0.clone().add(_v.set(-0.6, 1.0, 3.5)),
        P0.clone().add(_v.set(0.7, 1.4, 8)),
        P0.clone().add(_v.set(-0.4, 1.2, 13)),
        P0.clone().add(_v.set(0.4, 0.9, 18)),
        end,
      ],
      false,
      'centripetal',
    );
    this.drive = 'script';
    pip.swimmer.faceDir = null;
    const sw = pip.swimmer;
    const reduced = this.rig.reducedMotion;
    let phase = 0;
    let rollVel = 11;
    const SWEEP = 4.4;
    // Tumbling toward the camera…
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(0, 0.4, 0), yaw: 0.08, pitch: 0.36, radius: 3.2, rate: 2.6, rotRate: 1.5 });
    await this.sched.tween(
      SWEEP,
      (k, dt, raw) => {
        path.getPointAt(1 - Math.pow(1 - raw, 1.6), pip.position);
        rush(dt);
        this._introDebris(dt * 0.6, band.front, pip.position);
        if (raw < 0.12) this._coinsSwept(dt, treasure);
        this._camRumble(0.65 * (1 - raw) + 0.2);
        if (!reduced) this.rig.extraRoll = Math.sin(this.clock * 1.9) * 0.07 * (1 - raw);
        if (phase === 0 && raw >= 0.3) {
          // …then Pip fights back, facing the family, but is dragged away regardless.
          phase = 1;
          ui.caption('The current swept Pip far, far away from its family!');
          sw.minSpeedForHeading = 1e9;
          sw.faceDir = new THREE.Vector3(0.6, 0, -1);
          sw.effort = 1.3;
          pip.shiver = 1.2;
          pip.lookOverride = [0, 0.35];
          this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(0, 0.3, 0), yaw: Math.PI + 0.3, pitch: 0.3, radius: 2.0, rate: 3.5, rotRate: 2 }, true);
        } else if (phase === 1 && raw >= 0.7) {
          // Pip loses the fight and is flung out of the stream, spinning.
          phase = 2;
          sw.minSpeedForHeading = 0.6;
          sw.faceDir = null;
          sw.effort = 0;
          pip.lookOverride = null;
          rollVel = 9;
          this.rig.shot.rate = 1.2;
          this.audio.whoosh();
        }
        if (phase === 1) {
          // Right itself, wobbling against the flow.
          const upright = Math.round(sw.extraRoll / TAU) * TAU;
          sw.extraRoll = lerp(sw.extraRoll, upright + Math.sin(this.clock * 7) * 0.3, damp(6, dt));
          sw.extraPitch = Math.sin(this.clock * 5) * 0.15;
        } else {
          const settle = phase === 2 ? smoothstep(0.86, 1, raw) : 0;
          sw.extraRoll += dt * rollVel * (1 - settle);
          if (settle > 0) sw.extraRoll = lerp(sw.extraRoll, Math.round(sw.extraRoll / TAU) * TAU, settle);
          sw.extraPitch = Math.sin(this.clock * 9) * 0.45 * (1 - settle);
        }
      },
      null,
    );
    sw.extraRoll = 0;
    sw.extraPitch = 0;
    this.rig.extraRoll = 0;
    band.target = 0;
    this.streaks.target = 0;
    this.hoverAt(end, new THREE.Vector3(0.1, 0, -1));
    pip.setExpression('dizzy');
    await this.sched.tween(1.4, (k, dt) => this._introDebris(dt * (1 - k) * 0.5, 1));

    // 4. Lost. Murky, empty water: no family, no reef Pip knows.
    school.setVisible(false);
    this.seaLife.quiet = true;
    ui.caption('When the water calmed, Pip’s family was nowhere to be seen.');
    this.audio.lonely();
    // High, wide shot: one tiny fish alone on the sand.
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(0, 0, 0), yaw: Math.PI - 0.1, pitch: 1.12, radius: 5.2, rate: 1.5, rotRate: 0.6 }, true);
    pip.setExpression('worried');
    sw.effort = 0.25;
    // Pip turns slowly all the way round, looking everywhere for them.
    let turnA = 0;
    await this.sched.tween(3.6, (k, dt) => {
      this.rig.shot.yaw += dt * 0.12;
      if (k > 0.14) this.thought.show(true);
      turnA = Ease.inOutSine(k) * TAU;
      sw.faceDir = _v.set(Math.sin(turnA) * 1, 0, -Math.cos(turnA)).clone();
      pip.lookOverride = [Math.sin(k * 9) * 0.55, 0.05];
    });
    // Pip calls out with a flash of its lights… and nobody answers.
    ui.caption('Pip called out for them… but no one answered.');
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(0, 0.25, 0), yaw: Math.PI + 0.5, pitch: 0.3, radius: 3.0, rate: 1.4, rotRate: 0.9 });
    sw.faceDir = new THREE.Vector3(0.25, 0, -1);
    pip.lookOverride = [0, 0.3];
    pip.setExpression('hopeful');
    await this.sched.wait(0.6);
    this._pipCall();
    await this.sched.wait(2.2);
    // It droops, small and alone. Close on its sad face.
    this.thought.hide();
    pip.lookOverride = null;
    pip.setExpression('sad');
    sw.faceDir = new THREE.Vector3(-0.2, 0, -1);
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(0, 0.5, 0), yaw: Math.PI - 0.55, pitch: 0.32, radius: 1.5, rate: 1.4, rotRate: 1 });
    const droopFrom = this.hoverPoint.clone();
    await this.sched.tween(2.0, (k, dt) => {
      const e = Ease.inOutSine(k);
      this.hoverPoint.y = droopFrom.y - 0.3 * e;
      pip.glowBoost = 1 - 0.4 * e;
      sw.extraPitch = 0.12 * e;
      sw.effort = 0.25 * (1 - e);
    });
    // Courage: the water clears a little, and the journey begins.
    ui.caption('Home is far away, past dangerous waters. Pip needs your help!');
    pip.setExpression('determined');
    this.ocean.murkTarget = 0;
    this.seaLife.quiet = false;
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(0, 0.6, -3), yaw: 0.05, pitch: 0.2, radius: 4.2, rate: 1.5, rotRate: 0.6 }, true);
    await this.sched.tween(3.4, (k, dt) => {
      const e = smoothstep(0, 0.4, k);
      this.hoverPoint.y = droopFrom.y - 0.3 * (1 - e);
      pip.glowBoost = 0.6 + 0.4 * e;
      sw.extraPitch = 0.12 * (1 - e);
    });
    pip.glowBoost = 1;
    sw.extraPitch = 0;
  }

  /** Keep the camera trembling at least at `level` (no-op with reduced motion). */
  _camRumble(level) {
    if (!this.rig.reducedMotion) this.rig.shakeAmt = Math.max(this.rig.shakeAmt, level);
  }

  /** Sand, seaweed bits and bubbles carried along by the intro's current (up to its front). */
  _introDebris(dt, uMax = 1, near = null) {
    const band = this.introBand;
    this._debrisT = (this._debrisT || 0) - dt;
    while (this._debrisT <= 0) {
      this._debrisT += 0.025;
      if (near && Math.random() < 0.5) {
        // Debris overtaking Pip, so the speed of the water reads right next to it.
        _v.copy(near).add(_v2.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.6, -2.5 - Math.random() * 2));
        _v2.set(0, 0, 1);
      } else {
        band.sample(_v, _v2, Math.random() * Math.max(0.02, Math.min(uMax, 0.95) - 0.02));
        band.group.localToWorld(_v);
        _v2.transformDirection(band.group.matrixWorld);
      }
      const roll = Math.random();
      if (roll < 0.45) this.fx.dust.emit(_v, { count: 1, spread: 0.6, speed: 14, dir: _v2, life: 1.8, size: 0.45, grow: 0.5, drag: 0.05, color: 0xd7c49a, alpha: 0.45 });
      else if (roll < 0.72) this.fx.dust.emit(_v, { count: 1, spread: 0.4, speed: 13, dir: _v2, life: 2.0, size: 0.32, grow: 0.1, drag: 0.05, color: 0x4fa65e, alpha: 0.8 });
      else this.fx.bubbles.emit(_v, { count: 1, spread: 0.4, speed: 15, dir: _v2, up: 0.3, life: 1.8, size: 0.16, drag: 0.05, color: 0xe8fbff });
    }
  }

  /** Big billowing clouds of sand kicked up along the floor at the current's leading edge. */
  _sandWall(dt, u, amount = 1) {
    const band = this.introBand;
    this._sandT = (this._sandT || 0) - dt * amount;
    while (this._sandT <= 0) {
      this._sandT += 0.03;
      const uu = clamp(u - Math.random() * 0.06, 0.02, 0.98);
      band.curve.getPointAt(uu, _v);
      band.curve.getTangentAt(uu, _v2);
      _v.z += (Math.random() - 0.5) * band.width * 1.7;
      band.group.localToWorld(_v);
      _v2.transformDirection(band.group.matrixWorld);
      _v.y = this.ocean.surfaceHeight(_v.x, -_v.z) + 0.2 + Math.random() * 1.6;
      this.fx.dust.emit(_v, { count: 1, spread: 0.8, speed: 8, dir: _v2, up: 0.6, life: 2.2, size: 1.8, grow: 1.8, drag: 0.7, color: 0xdac8a0, alpha: 0.5 });
    }
  }

  /** A few gold coins glinting as they are swept away from the treasure. */
  _coinsSwept(dt, treasure) {
    this._coinT = (this._coinT || 0) - dt;
    while (this._coinT <= 0) {
      this._coinT += 0.06;
      _v.copy(treasure.position).add(_v2.set((Math.random() - 0.5) * 2, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 2));
      this.fx.sparks.emit(_v, { count: 1, spread: 0.3, speed: 9, dir: _v2.set(0, 0.15, 1), life: 1.2, size: 0.32, drag: 0.6, color: 0xffd36b });
    }
  }

  /** Pip's call for its family: a bright flash of its lights, a ring of glints and a puff of bubbles. */
  _pipCall() {
    const pip = this.pip;
    pip.pulse(3.5);
    this.audio.call();
    _v.copy(pip.position).add(_v2.copy(pip.swimmer.heading).multiplyScalar(0.45));
    this.fx.bubbles.emit(_v, { count: 7, spread: 0.12, speed: 0.6, up: 1.8, life: 2.2, size: 0.12 });
    this.fx.sparks.emit(pip.position, { count: 18, spread: 0.25, speed: 3.2, life: 1.1, size: 0.3, drag: 2.2, color: 0x9ff8ff });
  }

  _afterIntro(completed = false) {
    // Consistent state whether the intro finished or was skipped.
    this.streaks.target = 0;
    this.introBand.target = 0;
    this.school.setVisible(false);
    this.thought.hide();
    this.seaLife.quiet = false;
    this.ocean.murkTarget = 0;
    this.rig.extraRoll = 0;
    const sw = this.pip.swimmer;
    sw.extraRoll = 0;
    sw.extraPitch = 0;
    sw.effort = 0;
    sw.minSpeedForHeading = 0.6;
    this.pip.shiver = 0;
    this.pip.glowBoost = 1;
    this.pip.lookOverride = null;
    this.pip.setExpression('determined', 3);
    const p = this.pip.position;
    if (!completed && (-p.z < TITLE_S_INTRO - 4 || Math.abs(p.x) > 12)) {
      this.route(TITLE_S, _v);
      this.pip.swimmer.teleport(_v.add(_v2.set(3, -0.5, 0)), new THREE.Vector3(0, 0, -1));
    }
    this.hoverAt(this.pip.position.clone());
    this.rig.setShot({ target: this.pip.group, offset: new THREE.Vector3(0, 0.6, -3), yaw: 0.05, pitch: 0.2, radius: 4.2, rate: 1.5, rotRate: 0.6 }, !completed);
  }

  beginJourney(from = 0) {
    this.state = 'playing';
    this.run.reset();
    this.run.cleared = from;
    this.ui.setLives(this.run.lives);
    this.ui.showHUD(true);
    this.cruiseSpeed = CRUISE_SPEED;
    this.resumeCruise();
    this.updateLayout();
    this._refreshHUD(true);
    this.ui.banner(`Area ${this.zone + 1} of 3`, ZONES[this.zone].name, 3.4);
    this.audio.zoneChime();
    this.journey(from).catch((e) => {
      if (!isCancel(e)) console.error(e);
    });
  }

  async journey(from = 0) {
    for (const enc of this.encounters.slice(from)) {
      await this.sched.until(() => this.pipS >= enc.s - enc.approachFrom);
      const result = await this.runEncounter(enc);
      if (result === 'caught') {
        await this.gameOver(enc);
        return;
      }
      this.run.clearHurdle();
      this._refreshHUD(true);
      if (enc.isFinal) break;
      this.currentEnc = null;
      this.resumeCruise();
    }
    await this.reunion();
  }

  async runEncounter(enc) {
    this.currentEnc = enc;
    this.ui.hideCaption();
    this.cameraMode = 'encounter';
    this.audio.danger();
    enc.phase = 'approach';
    await enc.approach();
    let stage = 0;
    while (stage < enc.stages) {
      enc.phase = 'hold';
      enc.onHold?.(stage);
      this.rig.setShot(enc.holdShot(stage));
      const q = this.deck.next();
      this.lastQuestion = q;
      const step = enc.isFinal
        ? `Final hurdle${enc.stages > 1 ? ` · part ${stage + 1} of ${enc.stages}` : ''}`
        : `Hurdle ${enc.index + 1} of ${this.encounters.length}`;
      const ans = await this.sched.waitFor(this.ui.ask(q, { title: enc.title, step, icon: enc.icon, hint: enc.hint(stage) }));
      if (ans.skipped) {
        // Test-mode skip: pass the hurdle without counting an answer.
        this.run.skipped = (this.run.skipped || 0) + 1;
        this.audio.tap();
        this.ui.hideQuiz();
        this.ui.toast('Skipped (test mode)', '', 2);
        enc.phase = 'escape';
        await enc.success(stage);
        stage++;
      } else if (ans.correct) {
        this.run.recordCorrect();
        this.audio.correct();
        this.pip.setExpression('happy', 3);
        this.ui.showResult(pickPraise(), true);
        await this.sched.wait(0.75);
        this.ui.hideQuiz();
        this.ui.toast(`<b>✓ Correct!</b> ${escapeHtml(q.explanation)}`, 'good', 4.2);
        enc.phase = 'escape';
        await enc.success(stage);
        stage++;
      } else {
        const lives = this.run.recordWrong();
        this.ui.setLives(lives, lives);
        this.audio.wrong();
        this.audio.lifeLost();
        this.ui.flashDanger(this.reduced);
        if (navigator.vibrate) navigator.vibrate(lives === 0 ? [80, 60, 160] : 120);
        if (lives === 0) {
          this.ui.showResult('Oh no, that was your last life', false);
          await this.sched.wait(1.3);
          this.ui.hideQuiz();
          enc.phase = 'capture';
          this.cameraMode = 'capture';
          await enc.capture();
          return 'caught';
        }
        this.ui.showResult('Not quite', false);
        enc.phase = 'near';
        await enc.nearMiss(stage);
        enc.phase = 'hold';
        this.rig.setShot(enc.holdShot(stage));
        await this.sched.waitFor(
          // Keep it short: the right answer is already ticked on its card and a heart breaks in the
          // header, so only the one-line explanation is needed here.
          this.ui.explainAndWait(escapeHtml(q.explanation), lives === 1 ? 'Next question · last life' : 'Next question'),
        );
        this.ui.hideQuiz();
        await this.sched.wait(0.35);
      }
    }
    enc.phase = 'done';
    return 'cleared';
  }

  async gameOver(enc) {
    this.state = 'gameover';
    this.audio.gameOver();
    this.ui.caption(enc.captureText);
    await this.sched.wait(1.2);
    this.ui.fade(true, 1400);
    await this.sched.wait(1.6);
    this.ui.hideCaption();
    this.ui.showHUD(false);
    this.ui.gameOver({ correct: this.run.correct });
  }

  async reunion() {
    const pip = this.pip;
    const school = this.school;
    this.cameraMode = 'reunion';
    pip.setExpression('happy');
    this.ui.caption('Pip’s family! They heard the signal!', { small: false });
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(0, 0.4, 0), yaw: 0.6, pitch: 0.3, radius: 6.5, rate: 2, rotRate: 0.5 });
    // Orbit the camera slowly while the school swirls around Pip.
    await this.sched.tween(4.5, (k) => {
      this.rig.shot.yaw = 0.6 + k * 2.2;
    });
    this.ui.caption('Together again, they swim home in perfect time.');
    school.mode = 'formation';
    school.anchor = pip.group;
    this.sched.tween(2.5, (k) => (school.sync = k)).catch(() => {});
    this.audio.victory();
    this.cruiseSpeed = 5;
    this.resumeCruise();
    this.cameraMode = 'reunion';
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(0, 0.8, 2.5), yaw: 1.2, pitch: 0.22, radius: 8.5, rate: 2, rotRate: 0.4 });
    await this.sched.until(() => this.pipS >= HOME_S - 18);
    this.rig.setShot({ target: pip.group, offset: new THREE.Vector3(0, 2, -6), yaw: 0.25, pitch: 0.55, radius: 13, rate: 1.2, rotRate: 0.35 });
    this.ui.caption('Home at last.');
    await this.sched.until(() => this.pipS >= HOME_S - 4);
    this.cruiseSpeed = 0;
    this.hoverAt(pip.position.clone());
    school.mode = 'swirl';
    school.anchor = pip.group;
    await this.sched.wait(2.2);
    this.ui.hideCaption();
    this.run.win();
    this.state = 'victory';
    this.ui.showHUD(false);
    this.ui.victory();
  }

  // =====================================================================
  // Pause / restart / quit
  // =====================================================================
  pause() {
    if (this.paused || !['intro', 'rules', 'playing'].includes(this.state)) return;
    if (this.state === 'rules') return;
    this.paused = true;
    this.audio.suspend();
    const r = this.run;
    const text =
      this.state === 'intro' ? 'The story is paused.' : `Hurdles cleared: ${r.cleared} of ${r.totalHurdles} · Lives: ${r.lives} of 3`;
    this.ui.showPause(text);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.ui.hide('pause');
    this.ui.hide('settings');
    this.audio.resume();
    this.lastTime = performance.now();
    if (this.ui.isQuizOpen) requestAnimationFrame(() => document.getElementById('quiz-q').focus({ preventScroll: true }));
  }

  async restart() {
    this.audio.unlock();
    this.audio.tap();
    this.paused = false;
    this.sched.cancelAll();
    this.ui.hideScreens();
    this.ui.clearTransient();
    this.ui.fade(true, 250);
    await new Promise((r) => setTimeout(r, 280));
    this.resetWorld();
    this.school.setVisible(false);
    this.route(START_S, _v);
    this.pip.swimmer.teleport(_v, new THREE.Vector3(0, 0, -1));
    this.ocean.prime(START_S);
    this.deck = new QuestionDeck(QUESTIONS, this.settings.difficulty, this.seed);
    this.state = 'playing';
    this.beginJourney();
    this.rig.snap();
    this.ui.fade(false, 700);
    this.ui.toast('New journey — <b>3 lives</b>. Find the way home!', '', 3.2);
  }

  quitToTitle() {
    this.audio.tap();
    this.paused = false;
    this.sched.cancelAll();
    this.ui.fade(false, 300);
    this.toTitle();
  }

  // =====================================================================
  // Story beats along the route
  // =====================================================================
  _makeTriggers() {
    const cap = (text, dur = 4.5) => () => this.ui.caption(text, { small: true, dur });
    return [
      { s: 6, fn: cap('Somewhere far ahead, home is glowing. Keep swimming!') },
      { s: 22, fn: cap('When danger appears, answer the question to help Pip escape.', 5) },
      { s: 118, fn: () => this._whaleDiscovery() },
      { s: 212, fn: cap('The water is getting colder… keep going, Pip!') },
      { s: 316, fn: cap('Even in the dark, Pip’s little lights keep shining.') },
      { s: 470, fn: cap('Pip is halfway through the Dangerous Depths. Stay brave!') },
      { s: 548, fn: cap('A cavern… home must be on the other side.') },
      { s: 640, fn: cap('These glowing reefs… Pip remembers them!') },
      { s: 652, fn: cap('Tiny lights far ahead… could it be the school?') },
    ].map((t) => ({ ...t, done: false }));
  }

  async _whaleDiscovery() {
    this.ui.caption('A gentle giant glides by overhead…', { small: true, dur: 5 });
    const w = this.whale;
    w.group.visible = true;
    const base = this.pipS;
    const a = new THREE.Vector3(-46, 11, -(base + 45));
    const b = new THREE.Vector3(46, 8, -(base + 85));
    w.group.position.copy(a);
    w.group.lookAt(b);
    try {
      await this.sched.tween(18, (k) => w.group.position.lerpVectors(a, b, k));
    } finally {
      w.group.visible = false;
    }
  }

  // =====================================================================
  // Main loop
  // =====================================================================
  _loop(now) {
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    if (!this.paused) {
      this._trackFps(dt);
      this.update(dt * this.timeScale);
      this.renderer.render(this.scene, this.camera);
    } else if (this.needsRender) {
      this.rig.update(0);
      this.renderer.render(this.scene, this.camera);
    }
    this.needsRender = false;
  }

  _trackFps(dt) {
    if (this.settings.quality !== 'auto' || !['playing', 'title', 'intro'].includes(this.state)) return;
    const f = this.fpsWindow;
    f.t += dt;
    f.frames++;
    if (f.t >= 4) {
      const fps = f.frames / f.t;
      this.lastFps = fps;
      f.t = 0;
      f.frames = 0;
      const i = QUALITY_ORDER.indexOf(this.qualityName);
      // Step down only after two slow windows in a row (ignores one-off shader warm-up hitches).
      this.slowWindows = fps < 40 ? (this.slowWindows || 0) + 1 : 0;
      if (this.slowWindows >= 2 && i > 0) {
        this.slowWindows = 0;
        this._applyQuality(QUALITY_ORDER[i - 1]);
        this._syncSettingsUI();
        if (this.state === 'playing') this.ui.toast('Lowered visual quality for smoother swimming.', '', 2.5);
      }
    }
  }

  update(dt) {
    this.clock += dt;
    const t = this.clock;
    globalUniforms.uTime.value = t;
    this.sched.update(dt);

    const pip = this.pip;
    if (this.drive === 'cruise') {
      this.speed = lerp(this.speed, this.cruiseSpeed, damp(1.1, dt));
      this.s += this.speed * dt;
      this.route(this.s, _v);
      this.cruiseOffset.multiplyScalar(Math.exp(-dt * 1.3));
      pip.position.copy(_v).add(this.cruiseOffset);
    } else if (this.drive === 'hover') {
      const h = this.hoverPoint;
      pip.position.set(h.x + Math.sin(t * 0.9) * 0.1, h.y + Math.sin(t * 1.3) * 0.14, h.z + Math.sin(t * 0.7) * 0.08);
    }
    this.pipS = -pip.position.z;
    // While a hurdle is on screen, thin the haze so the danger is always clearly visible.
    const enc = this.currentEnc;
    this.ocean.clarityTarget = enc && enc.phase !== 'done' && enc.phase !== 'idle' ? 1 : 0;
    pip.lightBase = this.ocean.pipLightBase ?? 4;
    pip.update(dt);
    this.ocean.pipLight.position.copy(pip.position).add(_v.set(0, 0.9, 0.4));
    this.thought.update(dt, pip.position);

    // Glow halos read as bioluminescence: subtle in sunlit water, strong in the dark.
    const zw = this.ocean.zoneWeights(this.pipS);
    const dark = this.ocean.darkness;
    const glowK = Math.min(1, zw[0] * 0.12 + zw[1] * 0.4 + zw[2] * 0.7 + dark * 0.8 + this.ocean.murk * 0.45);
    pip.haloBase = 0.25 + glowK * 0.75;
    this.school.halo.opacity = glowK * 0.6;
    if (this.school.visible) {
      if (this.school.mode === 'escort' && this.state === 'title') {
        // The family swims beside Pip, a little further from the camera, so Pip stays in front.
        this.school.center.copy(pip.position).add(_v.set(-2.2, 0.8, 0.4));
      }
      this.school.update(dt);
    }
    this.streaks.update(dt);
    this.introBand.update(dt);
    // Plants bend hard (and gust) along the intro's current while it flows.
    if (this.introBand.strength > 0.05) {
      _v.set(1, 0, 0).applyQuaternion(this.introBand.group.quaternion);
      const m = 3.4 * this.introBand.strength * (0.85 + 0.15 * Math.sin(t * 5.3));
      this.currentPushTarget.set(_v.x * m, _v.z * m);
    }
    globalUniforms.uCurrentPush.value.lerp(this.currentPushTarget, damp(2.5, dt));
    this.currentPushTarget.set(0, 0);
    if (this.whale.group.visible) this.whale.update(dt);
    this.seaLife.update(dt);
    this.fx.update(dt);

    for (const e of this.encounters) {
      const near = this.pipS > e.s - 150 && this.pipS < e.s + e.exit + 70;
      if (e.group) e.group.visible = near;
      if (near) e.update(dt, t);
    }

    // Camera behaviour by mode.
    if (this.cameraMode === 'title') {
      this.rig.shot.yaw = 1.4 + Math.sin(t * 0.08) * 0.25;
    } else if (this.cameraMode === 'cruise' && this.drive === 'cruise') {
      this.cruiseShotTimer += dt;
      if (this.cruiseShotTimer > 11) {
        this.cruiseShotTimer = 0;
        this._applyCruiseShot(true);
      }
    }
    this.rig.update(dt);
    this.ocean.update(dt, this.pipS, this.camera);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    globalUniforms.uPointScale.value = this.renderer.getDrawingBufferSize(_v2).y / (2 * Math.tan(fov / 2));

    if (this.state === 'playing') {
      for (const tr of this.triggers) {
        if (!tr.done && this.pipS >= tr.s) {
          tr.done = true;
          if (!this.currentEnc || this.currentEnc.phase === 'done') tr.fn();
        }
      }
      this._refreshHUD(false, dt);
      const z = this.ocean.zoneIndex(this.pipS);
      if (z !== this.zone) {
        this.zone = z;
        this.run.zone = z;
        this.audio.setZone(z);
        this.audio.zoneChime();
        this.ui.banner(`Area ${z + 1} of 3`, ZONES[z].name, 3.6);
      }
    }
    this.audio.update(dt, !this.ui.isQuizOpen);
  }

  _refreshHUD(force, dt = 0) {
    this.hudTimer = (this.hudTimer || 0) + dt;
    if (!force && this.hudTimer < 0.2) return;
    this.hudTimer = 0;
    const frac = clamp(this.pipS / HOME_S, 0, 1);
    this.ui.setProgress(frac, this.run.cleared, this.run.totalHurdles, ZONES[this.zone].name);
  }

  // =====================================================================
  // Test / debug hooks (used by the automated playthrough and storyboard tools)
  // =====================================================================
  /** Start a journey just before hurdle `index` (development / automated testing only). */
  debugJump(index, difficulty = 'easy') {
    this.paused = false;
    this.sched.cancelAll();
    this.ui.hideScreens();
    this.ui.clearTransient();
    this.audio.unlock();
    this.resetWorld();
    this.school.setVisible(false);
    this.deck = new QuestionDeck(QUESTIONS, difficulty, this.seed);
    const enc = this.encounters[index];
    const s = enc.s - enc.approachFrom - 3;
    this.route(s, _v);
    this.pip.swimmer.teleport(_v, new THREE.Vector3(0, 0, -1));
    this.ocean.prime(s);
    for (const t of this.triggers) if (t.s <= s + 4) t.done = true;
    this.zone = this.ocean.zoneIndex(s);
    this.audio.setZone(this.zone);
    this.beginJourney(index);
    this.rig.snap();
  }

  _debugApi() {
    const g = this;
    return {
      game: g,
      get state() {
        return {
          state: g.state,
          paused: g.paused,
          lives: g.run.lives,
          cleared: g.run.cleared,
          correct: g.run.correct,
          answered: g.run.answered,
          quizOpen: g.ui.isQuizOpen,
          explainOpen: !document.getElementById('quiz-explain').hidden,
          encounter: g.currentEnc ? g.currentEnc.index : -1,
          phase: g.currentEnc ? g.currentEnc.phase : null,
          pipS: Math.round(g.pipS),
          zone: g.zone,
          quality: g.qualityName,
          fps: g.lastFps ? Math.round(g.lastFps) : null,
          drawCalls: g.renderer.info.render.calls,
          triangles: g.renderer.info.render.triangles,
        };
      },
      correctIndex: () => (g.ui.current ? g.ui.current.correctIndex : -1),
      jump: (i, d) => g.debugJump(i, d),
    };
  }
}

const PRAISE = ['Nice!', 'Great job!', 'Correct!', 'Brilliant!', 'You got it!', 'Awesome!'];
function pickPraise() {
  return PRAISE[Math.floor(Math.random() * PRAISE.length)];
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
