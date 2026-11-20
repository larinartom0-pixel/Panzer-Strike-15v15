/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import {
  BattleParticipant,
  BattleRibbon,
  BattleSummary,
  HitEffect,
  MapData,
  Projectile,
  ShellType,
  TankDefinition,
} from '../types.ts';
import { soundEngine } from './audio.ts';
import { buildTank3D, TankMeshBundle } from './proceduralModels.ts';
import { INITIAL_TANKS, BOT_NAMES } from './tanksData.ts';
import { BattleTerrain } from './terrain.ts';

export class BattleEngine {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public terrain: BattleTerrain;
  public mapData: MapData;

  // 15 vs 15 Participants
  public participants: BattleParticipant[] = [];
  public tankMeshes: Map<string, TankMeshBundle> = new Map();
  public player!: BattleParticipant;

  // Projectiles & FX
  public projectiles: Projectile[] = [];
  public hitEffects: HitEffect[] = [];
  public battleRibbons: BattleRibbon[] = [];
  private projectileGroup: THREE.Group = new THREE.Group();
  private effectsGroup: THREE.Group = new THREE.Group();
  private projectileMeshes: Map<string, THREE.Group> = new Map();
  private activeParticles: {
    mesh: THREE.Mesh;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    maxLife: number;
    gravity: number;
    scaleStart: number;
    scaleEnd: number;
  }[] = [];
  private tankDecals: Map<string, THREE.Mesh[]> = new Map();

  // Base Capture State
  public greenCaptureProgress: number = 0; // Green capturing Red's base (0 to 100)
  public redCaptureProgress: number = 0; // Red capturing Green's base (0 to 100)
  public greenCapturingCount: number = 0;
  public redCapturingCount: number = 0;

  // Battle State
  public battleTimeRemaining: number = 600; // 10 minutes
  public isBattleOver: boolean = false;
  public battleSummary: BattleSummary | null = null;
  public onBattleEndCallback?: (summary: BattleSummary) => void;

  // Camera & Aiming
  public isSniperMode: boolean = false;
  public sniperZoomLevel: number = 1; // 1x, 2x, 4x, 8x
  public cameraDistance: number = 15;
  public cameraYaw: number = 0;
  public cameraPitch: number = 0.28; // Higher default WoT arcade elevation
  public aimTargetPoint: THREE.Vector3 = new THREE.Vector3();
  public isAimBlockedByUBN: boolean = false;
  public penetrationIndicator: 'green' | 'orange' | 'red' | 'none' = 'none';
  public targetTankName: string = '';
  public currentDispersion: number = 0.35; // contracts to tank's base dispersion

  // Input state
  public keys: Record<string, boolean> = {};
  public mouseLookDelta: { x: number; y: number } = { x: 0, y: 0 };
  public isFiringRequested: boolean = false;
  public virtualThrottle: number = 0; // -1 to 1 for mobile touch joystick
  public virtualSteer: number = 0; // -1 to 1 for mobile touch joystick

  // Statistics tracked for player
  public playerShotsFired: number = 0;
  public playerShotsHit: number = 0;
  public playerPenetrations: number = 0;

  // Pre-allocated scratch math helpers to avoid garbage collection
  private _scratchVec1: THREE.Vector3 = new THREE.Vector3();
  private _scratchVec2: THREE.Vector3 = new THREE.Vector3();
  private _scratchVec3: THREE.Vector3 = new THREE.Vector3();
  private _scratchVec4: THREE.Vector3 = new THREE.Vector3();
  private _scratchVec5: THREE.Vector3 = new THREE.Vector3();
  private _scratchVec6: THREE.Vector3 = new THREE.Vector3();
  private _scratchRaycaster: THREE.Raycaster = new THREE.Raycaster();

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    mapData: MapData,
    playerTankDef: TankDefinition
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.mapData = mapData;
    this.terrain = new BattleTerrain(mapData);

    this.scene.add(this.projectileGroup);
    this.scene.add(this.effectsGroup);

    this.initBattlefield(playerTankDef);
  }

  private initBattlefield(playerTankDef: TankDefinition) {
    // 1. Build Terrain & Props
    this.terrain.build(this.scene, this.renderer);

    // 2. Spawn 15 Green & 15 Red Tanks
    this.spawnParticipants(playerTankDef);

    // 3. Setup Camera orientation behind player
    if (this.player) {
      this.cameraYaw = this.player.rotationY + Math.PI;
    }
  }

  private createFreshModules() {
    return {
      engine: 'intact' as const,
      ammoRack: 'intact' as const,
      fuelTank: 'intact' as const,
      gun: 'intact' as const,
      turretRing: 'intact' as const,
      optics: 'intact' as const,
      tracks: 'intact' as const,
    };
  }

  private createFreshCrew() {
    return {
      commander: 'healthy' as const,
      gunner: 'healthy' as const,
      driver: 'healthy' as const,
      loader: 'healthy' as const,
      radioOperator: 'healthy' as const,
    };
  }

  private spawnParticipants(playerTankDef: TankDefinition) {
    const greenBase = this.mapData.greenBase;
    const redBase = this.mapData.redBase;

    // Available bot tank blueprints
    const botTankPool = INITIAL_TANKS;

    // 1. Spawn Player (Green Leader)
    const playerInstalledTurret =
      playerTankDef.turrets.find((t) => t.id === playerTankDef.installedTurretId) || playerTankDef.turrets[0];

    const playerX = greenBase.x + (Math.random() - 0.5) * 18;
    const playerZ = greenBase.z + (Math.random() - 0.5) * 18;
    const playerHeading = Math.atan2(redBase.x - greenBase.x, redBase.z - greenBase.z);

    this.player = {
      id: 'player_green_1',
      name: 'Командир (Ви)',
      team: 'green',
      isPlayer: true,
      tankDef: playerTankDef,
      x: playerX,
      y: this.terrain.getHeight(playerX, playerZ),
      z: playerZ,
      vx: 0,
      vz: 0,
      verticalVel: 0,
      isAirborne: false,
      rotationY: playerHeading,
      turretRotationY: 0,
      gunElevation: 0,
      speed: 0,
      currentTurnSpeed: 0,
      maxHP: playerInstalledTurret.hpBonus,
      currentHP: playerInstalledTurret.hpBonus,
      isAlive: true,
      isSpotted: true,
      spotTimer: 999999,
      reloadProgress: 1.0,
      activeShell: 'AP',
      shellsRemaining: { ...playerTankDef.shellLoadout },
      tracksDamaged: false,
      tracksRepairTimer: 0,
      engineDamaged: false,
      gunDamaged: false,
      modules: this.createFreshModules(),
      crew: this.createFreshCrew(),
      isOnFire: false,
      fireTimer: 0,
      consumableCooldowns: { repairKit: 0, medKit: 0, fireExtinguisher: 0 },
      damageDealt: 0,
      kills: 0,
      spottedCount: 0,
      baseCapturePoints: 0,
      damageBlocked: 0,
      pitch: 0,
      roll: 0,
      pitchVel: 0,
      rollVel: 0,
      isFlipped: false,
      flipTimer: 0,
    };
    this.participants.push(this.player);

    const playerMeshBundle = buildTank3D(playerTankDef, 'green', true);
    this.tankMeshes.set(this.player.id, playerMeshBundle);
    this.scene.add(playerMeshBundle.rootGroup);

    // 2. Spawn 14 Allied Green Bots
    for (let i = 0; i < 14; i++) {
      const botDef = botTankPool[i % botTankPool.length];
      const botTurret = botDef.turrets.find((t) => t.id === botDef.installedTurretId) || botDef.turrets[0];
      const offsetX = ((i % 5) - 2) * 16 + (Math.random() - 0.5) * 6;
      const offsetZ = Math.floor(i / 5) * 18 + (Math.random() - 0.5) * 6;
      const bx = greenBase.x + offsetX;
      const bz = greenBase.z + offsetZ;

      const botParticipant: BattleParticipant = {
        id: `bot_green_${i + 2}`,
        name: BOT_NAMES.green[i % BOT_NAMES.green.length],
        team: 'green',
        isPlayer: false,
        tankDef: botDef,
        x: bx,
        y: this.terrain.getHeight(bx, bz),
        z: bz,
        vx: 0,
        vz: 0,
        verticalVel: 0,
        isAirborne: false,
        rotationY: playerHeading,
        turretRotationY: 0,
        gunElevation: 0,
        speed: 0,
        currentTurnSpeed: 0,
        maxHP: botTurret.hpBonus,
        currentHP: botTurret.hpBonus,
        isAlive: true,
        isSpotted: true, // allies always visible to player
        spotTimer: 999999,
        reloadProgress: 0.8 + Math.random() * 0.2,
        activeShell: 'AP',
        shellsRemaining: { AP: 40, APCR: 15, HE: 10 },
        tracksDamaged: false,
        tracksRepairTimer: 0,
        engineDamaged: false,
        gunDamaged: false,
        modules: this.createFreshModules(),
        crew: this.createFreshCrew(),
        isOnFire: false,
        fireTimer: 0,
        consumableCooldowns: { repairKit: 0, medKit: 0, fireExtinguisher: 0 },
        damageDealt: 0,
        kills: 0,
        spottedCount: 0,
        baseCapturePoints: 0,
        damageBlocked: 0,
        pitch: 0,
        roll: 0,
        pitchVel: 0,
        rollVel: 0,
        isFlipped: false,
        flipTimer: 0,
        aiRole: i % 4 === 0 ? 'brawler' : i % 4 === 1 ? 'flanker' : i % 4 === 2 ? 'sniper' : 'scout',
        aiActionTimer: Math.random() * 2,
      };

      this.participants.push(botParticipant);
      const meshBundle = buildTank3D(botDef, 'green', false);
      this.tankMeshes.set(botParticipant.id, meshBundle);
      this.scene.add(meshBundle.rootGroup);
    }

    // 3. Spawn 15 Enemy Red Bots
    const redHeading = Math.atan2(greenBase.x - redBase.x, greenBase.z - redBase.z);
    for (let i = 0; i < 15; i++) {
      const botDef = botTankPool[i % botTankPool.length];
      const botTurret = botDef.turrets.find((t) => t.id === botDef.installedTurretId) || botDef.turrets[0];
      const offsetX = ((i % 5) - 2) * 16 + (Math.random() - 0.5) * 6;
      const offsetZ = Math.floor(i / 5) * 18 + (Math.random() - 0.5) * 6;
      const rx = redBase.x + offsetX;
      const rz = redBase.z + offsetZ;

      const botParticipant: BattleParticipant = {
        id: `bot_red_${i + 1}`,
        name: BOT_NAMES.red[i % BOT_NAMES.red.length],
        team: 'red',
        isPlayer: false,
        tankDef: botDef,
        x: rx,
        y: this.terrain.getHeight(rx, rz),
        z: rz,
        vx: 0,
        vz: 0,
        verticalVel: 0,
        isAirborne: false,
        rotationY: redHeading,
        turretRotationY: 0,
        gunElevation: 0,
        speed: 0,
        currentTurnSpeed: 0,
        maxHP: botTurret.hpBonus,
        currentHP: botTurret.hpBonus,
        isAlive: true,
        isSpotted: false, // hidden until spotted!
        spotTimer: 0,
        reloadProgress: 0.8 + Math.random() * 0.2,
        activeShell: 'AP',
        shellsRemaining: { AP: 40, APCR: 15, HE: 10 },
        tracksDamaged: false,
        tracksRepairTimer: 0,
        engineDamaged: false,
        gunDamaged: false,
        modules: this.createFreshModules(),
        crew: this.createFreshCrew(),
        isOnFire: false,
        fireTimer: 0,
        consumableCooldowns: { repairKit: 0, medKit: 0, fireExtinguisher: 0 },
        damageDealt: 0,
        kills: 0,
        spottedCount: 0,
        baseCapturePoints: 0,
        damageBlocked: 0,
        pitch: 0,
        roll: 0,
        pitchVel: 0,
        rollVel: 0,
        isFlipped: false,
        flipTimer: 0,
        aiRole: i % 4 === 0 ? 'brawler' : i % 4 === 1 ? 'flanker' : i % 4 === 2 ? 'sniper' : 'scout',
        aiActionTimer: Math.random() * 2,
      };

      this.participants.push(botParticipant);
      const meshBundle = buildTank3D(botDef, 'red', false);
      this.tankMeshes.set(botParticipant.id, meshBundle);
      this.scene.add(meshBundle.rootGroup);
    }
  }

  public useConsumable(type: 'repairKit' | 'medKit' | 'fireExtinguisher') {
    const p = this.player;
    if (!p || !p.isAlive) return;
    if (p.consumableCooldowns[type] > 0) return;

    if (type === 'repairKit') {
      const hasDamage =
        p.tracksDamaged ||
        p.engineDamaged ||
        p.gunDamaged ||
        Object.values(p.modules).some((m) => m !== 'intact');
      if (!hasDamage) return;

      p.tracksDamaged = false;
      p.tracksRepairTimer = 0;
      p.engineDamaged = false;
      p.gunDamaged = false;
      p.modules = this.createFreshModules();
      p.consumableCooldowns.repairKit = 45;
      soundEngine.playReloadFinish();
      this.addBattleRibbon('crit', 'Ремкомплект: модулі полагоджено');
    } else if (type === 'medKit') {
      const hasInjured = Object.values(p.crew).some((c) => c === 'injured');
      if (!hasInjured) return;

      p.crew = this.createFreshCrew();
      p.consumableCooldowns.medKit = 45;
      soundEngine.playReloadFinish();
      this.addBattleRibbon('crit', 'Аптечка: екіпаж вилікувано');
    } else if (type === 'fireExtinguisher') {
      if (!p.isOnFire) return;
      p.isOnFire = false;
      p.fireTimer = 0;
      p.consumableCooldowns.fireExtinguisher = 45;
      soundEngine.playReloadFinish();
      this.addBattleRibbon('fire', 'Пожежу ліквідовано!');
    }
  }

  update(dt: number) {
    if (this.isBattleOver) return;

    // Clamp delta time to avoid physics explodes on tab switch
    const clampedDt = Math.min(dt, 0.05);

    this.battleTimeRemaining -= clampedDt;
    if (this.battleTimeRemaining <= 0) {
      this.finishBattle('timeout');
      return;
    }

    // 1. Update Modules, Fire DoT & Consumable Cooldowns for all tanks
    this.updateModulesAndFire(clampedDt);

    // 2. Process Player Input & Real Drivetrain Physics
    this.updatePlayerMovement(clampedDt);

    // 3. Process AI Bot Decisions & Drivetrain Physics
    this.updateAI(clampedDt);

    // 4. Update 3D Rigid-Body Suspension, Airborne Gravity & Rollover Physics
    for (const tank of this.participants) {
      this.updateTankSuspensionAndSlope(tank, clampedDt);
    }

    // 5. Tank-to-Tank Collisions, Impulse Rebound & Ramming Physics
    this.updateTankCollisions(clampedDt);

    // 6. Update Projectiles, Glowing 3D Tracers & Armor Impact Hits
    this.updateProjectiles(clampedDt);

    // 7. Update Spotting System (Line of sight & view range)
    this.updateSpotting(clampedDt);

    // 8. Update Base Capture System
    this.updateBaseCapture(clampedDt);

    // 9. Update Visual 3D Meshes & Animations
    this.update3DMeshes(clampedDt);

    // 10. Update 3D Particle Bursts, FX and Ribbons
    this.updateEffects(clampedDt);

    // 11. Update Camera & Aiming (3rd person + Sniper + UBN)
    this.updateCamera(clampedDt);

    // 12. Update Terrain animated flags
    this.terrain.update(clampedDt);

    // 13. Check Win/Loss conditions
    this.checkBattleStatus();
  }

  private updateModulesAndFire(dt: number) {
    for (const tank of this.participants) {
      if (!tank.isAlive) continue;

      // Cooldown ticks
      if (tank.consumableCooldowns.repairKit > 0) {
        tank.consumableCooldowns.repairKit = Math.max(0, tank.consumableCooldowns.repairKit - dt);
      }
      if (tank.consumableCooldowns.medKit > 0) {
        tank.consumableCooldowns.medKit = Math.max(0, tank.consumableCooldowns.medKit - dt);
      }
      if (tank.consumableCooldowns.fireExtinguisher > 0) {
        tank.consumableCooldowns.fireExtinguisher = Math.max(
          0,
          tank.consumableCooldowns.fireExtinguisher - dt
        );
      }

      // Automatic repair timer if tracks broken
      if (tank.tracksDamaged) {
        let repairRate = 1.0;
        if (tank.tankDef.equippedGear.includes('repair_kit')) repairRate = 1.45;
        tank.tracksRepairTimer -= dt * repairRate;
        if (tank.tracksRepairTimer <= 0) {
          tank.tracksDamaged = false;
          tank.modules.tracks = 'intact';
        }
      }

      // Active Fire DoT
      if (tank.isOnFire) {
        tank.fireTimer -= dt;
        const fireDps = tank.maxHP * 0.045; // 4.5% HP per second
        tank.currentHP = Math.max(0, tank.currentHP - fireDps * dt);

        // Emit occasional fire smoke particles
        if (Math.random() < dt * 12) {
          this.spawn3DParticle(
            tank.x + (Math.random() - 0.5) * 1.4,
            tank.y + 1.5,
            tank.z + (Math.random() - 0.5) * 1.4,
            (Math.random() - 0.5) * 1.5,
            3.5 + Math.random() * 2.5,
            (Math.random() - 0.5) * 1.5,
            Math.random() < 0.5 ? 0xf97316 : 0x262626,
            0.55,
            0.35,
            1.1,
            -1.0
          );
        }

        // Bots automatically use extinguisher after ~1.5s if off cooldown
        if (!tank.isPlayer && tank.fireTimer < 3.5 && tank.consumableCooldowns.fireExtinguisher <= 0) {
          tank.isOnFire = false;
          tank.fireTimer = 0;
          tank.consumableCooldowns.fireExtinguisher = 45;
        }

        if (tank.fireTimer <= 0) {
          tank.isOnFire = false;
        }

        if (tank.currentHP <= 0 && tank.isAlive) {
          tank.isAlive = false;
          this.spawn3DBurst(tank.x, tank.y + 1.2, tank.z, 'explosion', 18);
          soundEngine.playExplosion();
        }
      }
    }
  }

  /**
   * Real drivetrain, traction, momentum, lateral drift and sliding physics shared by Player & AI
   */
  private stepTankDrivePhysics(
    tank: BattleParticipant,
    forwardInput: number,
    turnInput: number,
    handbrake: boolean,
    dt: number
  ) {
    const tankDef = tank.tankDef;
    const engine =
      tankDef.engines.find((e) => e.id === tankDef.installedEngineId) || tankDef.engines[0];
    const suspension =
      tankDef.suspensions.find((s) => s.id === tankDef.installedSuspensionId) ||
      tankDef.suspensions[0];

    const canMove = !tank.tracksDamaged && !tank.isFlipped;

    // Module & Crew modifiers
    const engineMult =
      tank.modules.engine === 'destroyed' ? 0.25 : tank.modules.engine === 'damaged' ? 0.6 : 1.0;
    const driverMult = tank.crew.driver === 'injured' ? 0.72 : 1.0;
    const turboBonus = tankDef.equippedGear.includes('turbo') ? 5 : 0;

    // Real km/h -> m/s world scale (1 km/h ~ 0.34 world units/s)
    const worldScale = 0.34;
    const maxSpeedForward = (engine.topSpeed + turboBonus) * worldScale * engineMult * driverMult;
    const maxSpeedReverse = engine.reverseSpeed * worldScale * engineMult * driverMult;

    // Power-to-weight ratio drives real acceleration curve
    const hpPerTon = (engine.horsepower * engineMult) / Math.max(10, tankDef.weightTons);
    const baseAccel = Math.max(3.5, hpPerTon * 0.58) * driverMult * suspension.passability;

    // Basis vectors of tank hull
    const fwdX = Math.sin(tank.rotationY);
    const fwdZ = Math.cos(tank.rotationY);
    const rightX = -fwdZ; // left/right orthogonal axis
    const rightZ = fwdX;

    // Decompose current world velocity (vx, vz) into forward & lateral components
    let fwdVel = tank.vx * fwdX + tank.vz * fwdZ;
    let latVel = tank.vx * rightX + tank.vz * rightZ;

    if (!tank.isAirborne) {
      // Slope gravity acceleration along longitudinal axis (uphill slows, downhill speeds up)
      const slopeForce = -22.0 * Math.sin(tank.pitch);
      fwdVel += slopeForce * dt;

      if (canMove && !handbrake && Math.abs(forwardInput) > 0.05) {
        if (forwardInput > 0) {
          // Torque curve: stronger low-gear pull, tapers near top speed
          const speedRatio = Math.max(0, fwdVel / maxSpeedForward);
          const torque = baseAccel * Math.max(0.18, 1.15 - speedRatio * 0.85);
          fwdVel = Math.min(maxSpeedForward, fwdVel + torque * forwardInput * dt);
        } else {
          if (fwdVel > 0.5) {
            // Active braking
            fwdVel = Math.max(0, fwdVel - baseAccel * 2.2 * dt);
          } else {
            const revRatio = Math.max(0, -fwdVel / maxSpeedReverse);
            const revTorque = baseAccel * 0.85 * Math.max(0.2, 1.1 - revRatio * 0.85);
            fwdVel = Math.max(-maxSpeedReverse, fwdVel + revTorque * forwardInput * dt);
          }
        }
      } else {
        // Rolling resistance + handbrake braking
        const drag = handbrake ? 14.0 : 3.2 / suspension.passability;
        if (Math.abs(fwdVel) <= drag * dt) {
          fwdVel = 0;
        } else {
          fwdVel -= Math.sign(fwdVel) * drag * dt;
        }
      }

      // Lateral track grip (prevents sliding sideways like ice, but allows realistic high-speed drift!)
      const grip = handbrake ? 3.2 : 9.5 * suspension.passability;
      latVel *= Math.exp(-grip * dt);

      // Rotational inertia (angular acceleration on tracks)
      const maxTurnRate =
        THREE.MathUtils.degToRad(suspension.traverseSpeed) *
        0.92 *
        driverMult *
        (handbrake ? 1.28 : 1.0);
      const targetTurnSpeed = canMove ? turnInput * maxTurnRate : 0;
      tank.currentTurnSpeed = THREE.MathUtils.damp(tank.currentTurnSpeed, targetTurnSpeed, 7.5, dt);
      tank.rotationY += tank.currentTurnSpeed * dt;

      // Centrifugal body roll torque during sharp turns at speed
      const centrifugalRoll = -tank.currentTurnSpeed * fwdVel * 0.022;
      tank.rollVel += centrifugalRoll * dt * 12.0;

      // Reconstruct world velocity
      tank.vx = fwdX * fwdVel + rightX * latVel;
      tank.vz = fwdZ * fwdVel + rightZ * latVel;
      tank.speed = fwdVel;
    } else {
      // Airborne: preserve horizontal ballistic momentum and minor angular spin
      tank.rotationY += tank.currentTurnSpeed * 0.35 * dt;
      tank.speed = fwdVel;
    }

    // Integrate position
    const nextX = THREE.MathUtils.clamp(tank.x + tank.vx * dt, -490, 490);
    const nextZ = THREE.MathUtils.clamp(tank.z + tank.vz * dt, -490, 490);

    // Resolve smooth sliding collisions with rocks/buildings
    const tankRadius = tankDef.hullWidth * 0.56;
    const resolved = this.resolveObstacleCollision(tank, nextX, nextZ, tankRadius);
    tank.x = resolved.x;
    tank.z = resolved.z;
  }

  private resolveObstacleCollision(
    tank: BattleParticipant,
    nextX: number,
    nextZ: number,
    tankRadius: number
  ): { x: number; z: number } {
    let x = nextX;
    let z = nextZ;

    for (const obs of this.terrain.coverObstacles) {
      const dx = x - obs.x;
      const dz = z - obs.z;
      const dist = Math.hypot(dx, dz);
      const minDist = obs.radius + tankRadius;

      if (dist < minDist && dist > 0.0001) {
        const nx = dx / dist;
        const nz = dz / dist;
        // Push outside obstacle perimeter
        x = obs.x + nx * minDist;
        z = obs.z + nz * minDist;

        // Project velocity onto tangent (sliding along obstacle instead of bouncing or sticking!)
        const vn = tank.vx * nx + tank.vz * nz;
        if (vn < 0) {
          tank.vx -= vn * nx * 1.05;
          tank.vz -= vn * nz * 1.05;
          // Minor tangential scrape friction
          tank.vx *= 0.94;
          tank.vz *= 0.94;
        }
      }
    }

    return { x, z };
  }

  private updateTankSuspensionAndSlope(tank: BattleParticipant, dt: number) {
    if (!tank.isAlive) return;

    // Sample terrain at 4 corners around the tank's hull
    const halfW = tank.tankDef.hullWidth * 0.45;
    const halfL = tank.tankDef.hullLength * 0.45;

    const cosH = Math.cos(tank.rotationY);
    const sinH = Math.sin(tank.rotationY);

    const flX = tank.x + sinH * halfL + cosH * halfW;
    const flZ = tank.z + cosH * halfL - sinH * halfW;
    const frX = tank.x + sinH * halfL - cosH * halfW;
    const frZ = tank.z + cosH * halfL + sinH * halfW;
    const rlX = tank.x - sinH * halfL + cosH * halfW;
    const rlZ = tank.z - cosH * halfL - sinH * halfW;
    const rrX = tank.x - sinH * halfL - cosH * halfW;
    const rrZ = tank.z - cosH * halfL + sinH * halfW;

    const hFL = this.terrain.getHeight(flX, flZ);
    const hFR = this.terrain.getHeight(frX, frZ);
    const hRL = this.terrain.getHeight(rlX, rlZ);
    const hRR = this.terrain.getHeight(rrX, rrZ);

    const avgGroundY = (hFL + hFR + hRL + hRR) * 0.25;
    const centerGroundY = this.terrain.getHeight(tank.x, tank.z);
    const groundY = Math.max(centerGroundY, avgGroundY - 0.15);

    // Note: in Euler YXZ with rotation.y = heading and barrel pointing +Z:
    // Nose-up uphill means negative rotation.x!
    const terrainSlopePitch = -Math.atan2((hFL + hFR) * 0.5 - (hRL + hRR) * 0.5, halfL * 2);
    const terrainSlopeRoll = Math.atan2((hFL + hRL) * 0.5 - (hFR + hRR) * 0.5, halfW * 2);

    // Vertical gravity & airborne airtime physics
    const gravityY = 22.0;
    tank.verticalVel -= gravityY * dt;
    tank.y += tank.verticalVel * dt;

    if (tank.y <= groundY) {
      // Check hard landing impact
      if (tank.isAirborne && tank.verticalVel < -4.5) {
        tank.pitchVel += Math.abs(tank.verticalVel) * 0.08; // nose-dive suspension compression
        this.spawn3DBurst(tank.x, groundY + 0.2, tank.z, 'dust', 8);
      }
      tank.y = groundY;
      tank.verticalVel = 0;
      tank.isAirborne = false;
    } else if (tank.y - groundY > 0.35) {
      tank.isAirborne = true;
    }

    // Flipped state check (tank rolled over onto side/roof)
    if (tank.isFlipped) {
      tank.flipTimer += dt;
      // Slide to a stop on side/turret with friction
      tank.vx *= Math.exp(-3.0 * dt);
      tank.vz *= Math.exp(-3.0 * dt);
      tank.speed = 0;

      // Auto-recover after 6 seconds or when player presses 'R'
      if (tank.flipTimer > 6.0 || (tank.isPlayer && this.keys['KeyR'])) {
        tank.isFlipped = false;
        tank.flipTimer = 0;
        tank.roll = terrainSlopeRoll;
        tank.rollVel = 0;
        tank.pitch = terrainSlopePitch;
      }
      return;
    }

    if (!tank.isAirborne) {
      // Spring-damper suspension alignment to ground slope + centrifugal roll
      const springStiffness = 28.0;
      const springDamping = 7.5;

      const pitchTorque = (terrainSlopePitch - tank.pitch) * springStiffness - tank.pitchVel * springDamping;
      const rollTorque = (terrainSlopeRoll - tank.roll) * springStiffness - tank.rollVel * springDamping;

      tank.pitchVel += pitchTorque * dt;
      tank.rollVel += rollTorque * dt;
      tank.pitch += tank.pitchVel * dt;
      tank.roll += tank.rollVel * dt;

      // Check tipping / rollover threshold (~48 deg = 0.84 rad)
      if (Math.abs(tank.roll) > 0.84 || (Math.abs(terrainSlopeRoll) > 0.78 && Math.abs(tank.speed) > 2.5)) {
        tank.isFlipped = true;
        tank.flipTimer = 0;
        tank.roll = Math.sign(tank.roll || terrainSlopeRoll) * Math.PI * 0.78;
        soundEngine.playTrackBreak();
        this.spawnHitEffect(
          tank.x,
          tank.y + 1,
          tank.z,
          'track_break',
          '#f59e0b',
          undefined,
          'ТАНК ПЕРЕВЕРНУВСЯ!'
        );
      }
    } else {
      // Mid-air slight nose pitch down due to front weight bias
      tank.pitchVel += 0.35 * dt;
      tank.pitch = THREE.MathUtils.clamp(tank.pitch + tank.pitchVel * dt, -0.7, 0.7);
      tank.roll += tank.rollVel * dt;
    }
  }

  private updateTankCollisions(dt: number) {
    const len = this.participants.length;
    for (let i = 0; i < len; i++) {
      const a = this.participants[i];
      if (!a.isAlive) continue;

      for (let j = i + 1; j < len; j++) {
        const b = this.participants[j];
        if (!b.isAlive) continue;

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minSpacing = (a.tankDef.hullWidth + b.tankDef.hullWidth) * 0.56 + 0.35;

        if (dist < minSpacing && dist > 0.001) {
          const overlap = minSpacing - dist;
          const nx = dx / dist;
          const nz = dz / dist;

          const massA = a.tankDef.weightTons;
          const massB = b.tankDef.weightTons;
          const totalMass = massA + massB;

          // Positional separation weighted by inverse mass
          const ratioA = massB / totalMass;
          const ratioB = massA / totalMass;

          a.x -= nx * overlap * ratioA;
          a.z -= nz * overlap * ratioA;
          b.x += nx * overlap * ratioB;
          b.z += nz * overlap * ratioB;

          // Relative velocity along contact normal (b minus a)
          const rvx = b.vx - a.vx;
          const rvz = b.vz - a.vz;
          const velAlongNormal = rvx * nx + rvz * nz;

          // Only resolve impulse if tanks are moving toward each other
          if (velAlongNormal < 0) {
            const restitution = 0.25;
            const impulseJ = (-(1 + restitution) * velAlongNormal) / (1 / massA + 1 / massB);

            a.vx -= (impulseJ / massA) * nx;
            a.vz -= (impulseJ / massA) * nz;
            b.vx += (impulseJ / massB) * nx;
            b.vz += (impulseJ / massB) * nz;

            // Impact speed magnitude
            const impactSpeed = Math.abs(velAlongNormal);

            if (impactSpeed > 2.0) {
              const impactMidX = (a.x + b.x) * 0.5;
              const impactMidZ = (a.z + b.z) * 0.5;
              const impactMidY = (a.y + b.y) * 0.5 + 0.9;

              const baseDamage = Math.pow(impactSpeed, 1.75) * 4.5;
              const damageToA = Math.round(baseDamage * (massB / massA));
              const damageToB = Math.round(baseDamage * (massA / massB));

              if (a.team !== b.team) {
                a.currentHP = Math.max(0, a.currentHP - damageToA);
                b.currentHP = Math.max(0, b.currentHP - damageToB);

                if (a.baseCapturePoints > 0) a.baseCapturePoints = 0;
                if (b.baseCapturePoints > 0) b.baseCapturePoints = 0;

                soundEngine.playPenetration();
                this.spawn3DBurst(impactMidX, impactMidY, impactMidZ, 'ricochet', 10);
                this.spawnHitEffect(
                  impactMidX,
                  impactMidY,
                  impactMidZ,
                  'ricochet',
                  '#f59e0b',
                  Math.max(damageToA, damageToB),
                  'ТАРАН!'
                );

                if (a.isPlayer) {
                  this.addBattleRibbon('ram', `Таран! -${damageToB} HP`, damageToB);
                } else if (b.isPlayer) {
                  this.addBattleRibbon('ram', `Таран! -${damageToA} HP`, damageToA);
                }

                if (a.currentHP <= 0 && a.isAlive) {
                  a.isAlive = false;
                  this.spawn3DBurst(a.x, a.y + 1, a.z, 'explosion', 16);
                  soundEngine.playExplosion();
                  if (b.isPlayer) this.addBattleRibbon('kill', `Знищено тараном: ${a.name}`);
                }
                if (b.currentHP <= 0 && b.isAlive) {
                  b.isAlive = false;
                  this.spawn3DBurst(b.x, b.y + 1, b.z, 'explosion', 16);
                  soundEngine.playExplosion();
                  if (a.isPlayer) this.addBattleRibbon('kill', `Знищено тараном: ${b.name}`);
                }
              }
            }
          }
        }
      }
    }
  }

  private updatePlayerMovement(dt: number) {
    if (!this.player.isAlive) return;

    const tankDef = this.player.tankDef;
    const engine =
      tankDef.engines.find((e) => e.id === tankDef.installedEngineId) || tankDef.engines[0];

    let forwardInput = this.virtualThrottle;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) forwardInput += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) forwardInput -= 1;
    forwardInput = Math.max(-1, Math.min(1, forwardInput));

    let turnInput = this.virtualSteer;
    // KeyA (+1 -> +rotationY = Turn LEFT), KeyD (-1 -> -rotationY = Turn RIGHT)
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) turnInput += 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) turnInput -= 1;
    turnInput = Math.max(-1, Math.min(1, turnInput));

    const handbrake = Boolean(this.keys['Space']);

    // Run real tank drivetrain physics
    this.stepTankDrivePhysics(this.player, forwardInput, turnInput, handbrake, dt);

    // Engine sound feedback
    const maxSpeedForward = engine.topSpeed * 0.34;
    soundEngine.updateEngineSound(
      this.player.speed / maxSpeedForward,
      Math.abs(this.player.speed) > 0.25 || Math.abs(turnInput) > 0.05
    );

    // Gun reload timer (affected by Ammo Rack and Loader!)
    const installedGun =
      tankDef.guns.find((g) => g.id === tankDef.installedGunId) || tankDef.guns[0];
    let reloadDuration = installedGun.reloadTime;
    if (tankDef.equippedGear.includes('rammer')) reloadDuration *= 0.9;
    if (this.player.modules.ammoRack === 'damaged') reloadDuration *= 1.65;
    if (this.player.crew.loader === 'injured') reloadDuration *= 1.4;

    if (this.player.reloadProgress < 1.0) {
      this.player.reloadProgress += dt / reloadDuration;
      if (this.player.reloadProgress >= 1.0) {
        this.player.reloadProgress = 1.0;
        soundEngine.playReloadFinish();
      }
    }

    // Reticle dispersion dynamics (affected by Gun module & Gunner crew!)
    const gunDmgMult = this.player.modules.gun !== 'intact' ? 1.85 : 1.0;
    const gunnerMult = this.player.crew.gunner === 'injured' ? 1.35 : 1.0;
    const isStationary = Math.abs(this.player.speed) < 0.25 && Math.abs(turnInput) < 0.05;
    const baseDisp = installedGun.dispersion * gunDmgMult * gunnerMult;
    const targetDispersion = isStationary ? baseDisp : baseDisp * 2.15;

    const aimSpeed = this.player.crew.gunner === 'injured' ? 1.7 : 2.8;
    this.currentDispersion = THREE.MathUtils.damp(
      this.currentDispersion,
      targetDispersion,
      isStationary ? aimSpeed : 7.5,
      dt
    );

    // Player firing trigger
    if (this.isFiringRequested && this.player.reloadProgress >= 1.0) {
      this.firePlayerGun();
      this.isFiringRequested = false;
    } else if (this.isFiringRequested) {
      // Clear stale request while reloading so gun doesn't auto-fire seconds later
      this.isFiringRequested = false;
    }
  }

  private firePlayerGun() {
    const meshBundle = this.tankMeshes.get(this.player.id);
    if (!meshBundle) return;

    const tankDef = this.player.tankDef;
    const gun =
      tankDef.guns.find((g) => g.id === tankDef.installedGunId) || tankDef.guns[0];

    const currentShellType = this.player.activeShell;
    if (this.player.shellsRemaining[currentShellType] <= 0) return;

    this.player.shellsRemaining[currentShellType]--;
    this.player.reloadProgress = 0;
    this.playerShotsFired++;

    // Ensure world matrices reflect latest barrel pitch/turret yaw
    meshBundle.rootGroup.updateMatrixWorld(true);

    const muzzleWorldPos = new THREE.Vector3();
    const mantletWorldPos = new THREE.Vector3();
    meshBundle.muzzlePoint.getWorldPosition(muzzleWorldPos);
    meshBundle.mantletGroup.getWorldPosition(mantletWorldPos);

    // Actual 3D barrel direction (respects real UBN & turret rotation!)
    const barrelDir = new THREE.Vector3()
      .subVectors(muzzleWorldPos, mantletWorldPos)
      .normalize();

    // If reticle is within UBN limits, shoot directly at aimTargetPoint for crisp convergence;
    // otherwise fire along the physical clamped barrel angle!
    const fireDir = new THREE.Vector3();
    if (!this.isAimBlockedByUBN) {
      fireDir.subVectors(this.aimTargetPoint, muzzleWorldPos).normalize();
    } else {
      fireDir.copy(barrelDir);
    }

    // Apply gun dispersion cone
    const spreadScale = this.currentDispersion * 0.032;
    fireDir.x += (Math.random() - 0.5) * spreadScale;
    fireDir.y += (Math.random() - 0.5) * spreadScale;
    fireDir.z += (Math.random() - 0.5) * spreadScale;
    fireDir.normalize();

    // Visible high-speed WoT tracer velocities (units/sec)
    const shellVelocity =
      currentShellType === 'APCR' ? 265 : currentShellType === 'HE' ? 165 : 210;
    const isHeavyGun = gun.damageAP >= 300;

    const penetration =
      currentShellType === 'APCR'
        ? gun.penetrationAPCR
        : currentShellType === 'HE'
        ? gun.penetrationAP * 0.45
        : gun.penetrationAP;

    const damage = currentShellType === 'HE' ? gun.damageHE : gun.damageAP;

    const projId = `proj_${Date.now()}_${Math.random()}`;
    const proj: Projectile = {
      id: projId,
      shooterId: this.player.id,
      shooterTeam: 'green',
      shellType: currentShellType,
      startX: muzzleWorldPos.x,
      startY: muzzleWorldPos.y,
      startZ: muzzleWorldPos.z,
      x: muzzleWorldPos.x,
      y: muzzleWorldPos.y,
      z: muzzleWorldPos.z,
      vx: fireDir.x * shellVelocity,
      vy: fireDir.y * shellVelocity,
      vz: fireDir.z * shellVelocity,
      penetration,
      damage,
      alive: true,
      trail: [],
    };
    this.projectiles.push(proj);
    this.createProjectileVisual(proj);

    // Audio, recoil & hull suspension kickback
    soundEngine.playCannonShot(isHeavyGun);
    meshBundle.recoilOffset = 0.55;
    this.player.pitchVel -= isHeavyGun ? 0.35 : 0.18;

    // 3D Muzzle blast flash & smoke puff
    this.spawn3DBurst(muzzleWorldPos.x, muzzleWorldPos.y, muzzleWorldPos.z, 'muzzle', 12);
    this.spawnHitEffect(muzzleWorldPos.x, muzzleWorldPos.y, muzzleWorldPos.z, 'explosion', '#f59e0b');
  }

  private updateAI(dt: number) {
    for (const bot of this.participants) {
      if (bot.isPlayer || !bot.isAlive) continue;

      const meshBundle = this.tankMeshes.get(bot.id);
      if (!meshBundle) continue;

      const botDef = bot.tankDef;
      const gun = botDef.guns.find((g) => g.id === botDef.installedGunId) || botDef.guns[0];

      // Reload (affected by Ammo Rack & Loader)
      let reloadDur = gun.reloadTime;
      if (bot.modules.ammoRack === 'damaged') reloadDur *= 1.65;
      if (bot.crew.loader === 'injured') reloadDur *= 1.4;
      if (bot.reloadProgress < 1.0) {
        bot.reloadProgress += dt / reloadDur;
        if (bot.reloadProgress >= 1.0) bot.reloadProgress = 1.0;
      }

      // Find enemy target
      let bestTarget: BattleParticipant | null = null;
      let minTargetDist = 99999;

      for (const candidate of this.participants) {
        if (!candidate.isAlive || candidate.team === bot.team) continue;
        if (!candidate.isSpotted) continue;

        const dist = Math.hypot(candidate.x - bot.x, candidate.z - bot.z);
        if (dist < minTargetDist) {
          minTargetDist = dist;
          bestTarget = candidate;
        }
      }

      bot.aiTargetId = bestTarget ? bestTarget.id : null;

      // Desired navigation target
      let targetNavX: number;
      let targetNavZ: number;

      if (bestTarget && minTargetDist < 360) {
        if (bot.aiRole === 'sniper' && minTargetDist < 130) {
          const angleAway = Math.atan2(bot.x - bestTarget.x, bot.z - bestTarget.z);
          targetNavX = bot.x + Math.sin(angleAway) * 90;
          targetNavZ = bot.z + Math.cos(angleAway) * 90;
        } else if (bot.aiRole === 'brawler') {
          targetNavX = bestTarget.x;
          targetNavZ = bestTarget.z;
        } else {
          const flankAngle = Math.atan2(bestTarget.x - bot.x, bestTarget.z - bot.z) + 0.55;
          targetNavX = bot.x + Math.sin(flankAngle) * 55;
          targetNavZ = bot.z + Math.cos(flankAngle) * 55;
        }
      } else {
        const enemyBase = bot.team === 'green' ? this.mapData.redBase : this.mapData.greenBase;
        targetNavX = enemyBase.x;
        targetNavZ = enemyBase.z;
      }

      // Desired steering & throttle inputs for real drivetrain physics
      const desiredAngle = Math.atan2(targetNavX - bot.x, targetNavZ - bot.z);
      let angleDiff = desiredAngle - bot.rotationY;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      let steerInput = THREE.MathUtils.clamp(angleDiff * 2.2, -1, 1);
      let throttleInput = Math.abs(angleDiff) < 0.85 ? 0.95 : 0.25;

      // Look-ahead obstacle avoidance
      const probeX = bot.x + Math.sin(bot.rotationY) * 7.5;
      const probeZ = bot.z + Math.cos(bot.rotationY) * 7.5;
      if (this.checkObstacleCollision(probeX, probeZ, 2.8)) {
        steerInput = angleDiff >= 0 ? 1 : -1;
        throttleInput = 0.5;
      }

      // Stop advancing cleanly when already close in sniper role
      if (bestTarget && bot.aiRole === 'sniper' && minTargetDist < 180 && minTargetDist >= 130) {
        throttleInput = 0;
      }

      this.stepTankDrivePhysics(bot, throttleInput, steerInput, false, dt);

      // Turret & Barrel Elevation aim at target
      if (bestTarget) {
        const targetWorldAngle = Math.atan2(bestTarget.x - bot.x, bestTarget.z - bot.z);
        let turretRelativeAngle = targetWorldAngle - bot.rotationY;
        while (turretRelativeAngle > Math.PI) turretRelativeAngle -= Math.PI * 2;
        while (turretRelativeAngle < -Math.PI) turretRelativeAngle += Math.PI * 2;

        if (botDef.tankClass === 'destroyer') {
          turretRelativeAngle = THREE.MathUtils.clamp(turretRelativeAngle, -0.32, 0.32);
        }

        const turretMult = bot.modules.turretRing === 'damaged' ? 0.45 : 1.0;
        const turretTurnSpeed = THREE.MathUtils.degToRad(30) * turretMult * dt;
        const diff = turretRelativeAngle - bot.turretRotationY;
        if (Math.abs(diff) > 0.03) {
          bot.turretRotationY += Math.sign(diff) * Math.min(Math.abs(diff), turretTurnSpeed);
        }

        // Compute realistic gun elevation in mantlet space
        const dx = bestTarget.x - bot.x;
        const dz = bestTarget.z - bot.z;
        const dy = (bestTarget.y + 1.2) - (bot.y + 1.8);
        const horizDist = Math.max(1, Math.hypot(dx, dz));
        const desiredRotX = -Math.atan2(dy, horizDist);
        const minRotX = -THREE.MathUtils.degToRad(botDef.gunElevationDeg || 22);
        const maxRotX = THREE.MathUtils.degToRad(botDef.gunDepressionDeg || 8);
        bot.gunElevation = THREE.MathUtils.clamp(desiredRotX, minRotX, maxRotX);

        // Fire when aligned
        if (Math.abs(diff) < 0.14 && bot.reloadProgress >= 1.0 && minTargetDist < 310) {
          this.fireBotGun(bot, bestTarget);
        }
      }
    }
  }

  private fireBotGun(bot: BattleParticipant, target: BattleParticipant) {
    const meshBundle = this.tankMeshes.get(bot.id);
    if (!meshBundle) return;

    const gun =
      bot.tankDef.guns.find((g) => g.id === bot.tankDef.installedGunId) || bot.tankDef.guns[0];

    bot.reloadProgress = 0;
    meshBundle.rootGroup.updateMatrixWorld(true);

    const muzzleWorldPos = new THREE.Vector3();
    meshBundle.muzzlePoint.getWorldPosition(muzzleWorldPos);

    // Aim at enemy hull/turret center with realistic dispersion
    const targetCenter = new THREE.Vector3(target.x, target.y + 1.25, target.z);
    const fireDir = this._scratchVec1.subVectors(targetCenter, muzzleWorldPos).normalize();
    const gunSpread = bot.modules.gun !== 'intact' ? 0.08 : 0.038;
    fireDir.x += (Math.random() - 0.5) * gunSpread;
    fireDir.y += (Math.random() - 0.5) * (gunSpread * 0.75);
    fireDir.z += (Math.random() - 0.5) * gunSpread;
    fireDir.normalize();

    const shellVelocity = 205;
    const proj: Projectile = {
      id: `bot_proj_${Date.now()}_${Math.random()}`,
      shooterId: bot.id,
      shooterTeam: bot.team,
      shellType: 'AP',
      startX: muzzleWorldPos.x,
      startY: muzzleWorldPos.y,
      startZ: muzzleWorldPos.z,
      x: muzzleWorldPos.x,
      y: muzzleWorldPos.y,
      z: muzzleWorldPos.z,
      vx: fireDir.x * shellVelocity,
      vy: fireDir.y * shellVelocity,
      vz: fireDir.z * shellVelocity,
      penetration: gun.penetrationAP,
      damage: gun.damageAP,
      alive: true,
      trail: [],
    };
    this.projectiles.push(proj);
    this.createProjectileVisual(proj);
    this.spawn3DBurst(muzzleWorldPos.x, muzzleWorldPos.y, muzzleWorldPos.z, 'muzzle', 7);

    meshBundle.recoilOffset = 0.4;
    bot.pitchVel -= 0.16;
  }

  private createProjectileVisual(proj: Projectile) {
    const group = new THREE.Group();
    group.position.set(proj.x, proj.y, proj.z);

    const colorHex =
      proj.shellType === 'APCR' ? 0x38bdf8 : proj.shellType === 'HE' ? 0xf97316 : 0xfacc15;
    const tailHex =
      proj.shellType === 'APCR' ? 0xe0f2fe : proj.shellType === 'HE' ? 0xfef08a : 0xfef9c3;

    // Bright visible glowing warhead core
    const headGeo = new THREE.CylinderGeometry(0.11, 0.15, 1.8, 8);
    headGeo.rotateX(Math.PI / 2);
    const headMat = new THREE.MeshBasicMaterial({ color: tailHex });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    group.add(headMesh);

    // Long incandescent tracer tail so shells are unmistakable in flight
    const tailGeo = new THREE.CylinderGeometry(0.03, 0.17, 5.2, 8);
    tailGeo.rotateX(Math.PI / 2);
    tailGeo.translate(0, 0, -2.8);
    const tailMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    const tailMesh = new THREE.Mesh(tailGeo, tailMat);
    group.add(tailMesh);

    const dir = this._scratchVec1.set(proj.vx, proj.vy, proj.vz).normalize();
    group.quaternion.setFromUnitVectors(this._scratchVec2.set(0, 0, 1), dir);

    this.projectileGroup.add(group);
    this.projectileMeshes.set(proj.id, group);
  }

  private removeProjectileVisual(projId: string) {
    const meshGroup = this.projectileMeshes.get(projId);
    if (meshGroup) {
      this.projectileGroup.remove(meshGroup);
      meshGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
      this.projectileMeshes.delete(projId);
    }
  }

  private spawn3DParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: number,
    scaleStart: number,
    scaleEnd: number,
    maxLife: number,
    gravity: number
  ) {
    if (this.activeParticles.length > 260) {
      const oldest = this.activeParticles.shift();
      if (oldest) {
        this.effectsGroup.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
        (oldest.mesh.material as THREE.Material).dispose();
      }
    }

    const geo = new THREE.DodecahedronGeometry(0.45, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(scaleStart);
    this.effectsGroup.add(mesh);

    this.activeParticles.push({
      mesh,
      vx,
      vy,
      vz,
      life: 0,
      maxLife,
      gravity,
      scaleStart,
      scaleEnd,
    });
  }

  private spawn3DBurst(
    x: number,
    y: number,
    z: number,
    kind: 'muzzle' | 'penetration' | 'ricochet' | 'explosion' | 'dust',
    count: number
  ) {
    for (let i = 0; i < count; i++) {
      const speed = kind === 'ricochet' ? 14 : kind === 'explosion' ? 11 : kind === 'muzzle' ? 7 : 5;
      const vx = (Math.random() - 0.5) * speed * 2;
      const vy = Math.random() * speed * 1.1 + (kind === 'dust' ? 1.5 : 0.8);
      const vz = (Math.random() - 0.5) * speed * 2;

      let color = 0xf59e0b;
      let scaleStart = 0.5;
      let scaleEnd = 1.6;
      let maxLife = 0.45;
      let grav = 8.0;

      if (kind === 'muzzle') {
        color = i % 2 === 0 ? 0xfbbf24 : 0x78716c;
        scaleStart = i % 2 === 0 ? 0.65 : 0.9;
        scaleEnd = i % 2 === 0 ? 0.2 : 2.2;
        maxLife = i % 2 === 0 ? 0.22 : 0.65;
        grav = -1.5;
      } else if (kind === 'ricochet') {
        color = i % 2 === 0 ? 0xfef08a : 0xf97316;
        scaleStart = 0.35;
        scaleEnd = 0.05;
        maxLife = 0.35 + Math.random() * 0.2;
        grav = 16.0;
      } else if (kind === 'penetration') {
        color = i % 3 === 0 ? 0xef4444 : i % 3 === 1 ? 0xfbbf24 : 0x262626;
        scaleStart = 0.55;
        scaleEnd = 1.4;
        maxLife = 0.55 + Math.random() * 0.25;
        grav = 4.0;
      } else if (kind === 'explosion') {
        color = i % 3 === 0 ? 0xf97316 : i % 3 === 1 ? 0xfacc15 : 0x1f2937;
        scaleStart = 1.1;
        scaleEnd = 3.2;
        maxLife = 0.75 + Math.random() * 0.4;
        grav = -2.0;
      } else if (kind === 'dust') {
        color = 0x78716c;
        scaleStart = 0.7;
        scaleEnd = 2.0;
        maxLife = 0.55;
        grav = 1.5;
      }

      this.spawn3DParticle(x, y, z, vx, vy, vz, color, scaleStart, scaleEnd, maxLife, grav);
    }
  }

  private spawnArmorImpactHole(
    target: BattleParticipant,
    worldPoint: THREE.Vector3,
    worldNormal: THREE.Vector3,
    isPenetrated: boolean,
    hitObject?: THREE.Object3D
  ) {
    const bundle = this.tankMeshes.get(target.id);
    if (!bundle) return;

    bundle.rootGroup.updateMatrixWorld(true);

    // Attach to turretGroup if hit is on turret/mantlet so hole rotates with turret!
    let attachToTurret = false;
    let cur: THREE.Object3D | null | undefined = hitObject;
    while (cur) {
      if (cur === bundle.turretGroup) {
        attachToTurret = true;
        break;
      }
      cur = cur.parent;
    }
    if (!hitObject && worldPoint.y - target.y >= 1.35) {
      attachToTurret = true;
    }

    const parentGroup = attachToTurret ? bundle.turretGroup : bundle.hullGroup;

    // Convert world hit point and normal to parentGroup's local space
    const localPos = parentGroup.worldToLocal(worldPoint.clone());
    const worldPointPlusNormal = worldPoint.clone().add(worldNormal);
    const localPlusNormal = parentGroup.worldToLocal(worldPointPlusNormal);
    const localNormal = localPlusNormal.sub(localPos).normalize();
    if (localNormal.lengthSq() < 0.01) localNormal.set(0, 1, 0);

    // Push slightly outward along surface normal to eliminate Z-fighting
    localPos.addScaledVector(localNormal, 0.03);

    const holeGroup = new THREE.Mesh(
      new THREE.CylinderGeometry(isPenetrated ? 0.16 : 0.12, isPenetrated ? 0.16 : 0.12, 0.035, 12),
      new THREE.MeshBasicMaterial({
        color: isPenetrated ? 0x09090b : 0x94a3b8,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
    );
    holeGroup.position.copy(localPos);
    holeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localNormal);

    // Glowing molten armor rim on penetration / dark dent core on ricochet
    const rimMesh = new THREE.Mesh(
      isPenetrated
        ? new THREE.CylinderGeometry(0.24, 0.24, 0.018, 12)
        : new THREE.BoxGeometry(0.32, 0.02, 0.09),
      new THREE.MeshBasicMaterial({
        color: isPenetrated ? 0xea580c : 0x334155,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );
    rimMesh.position.set(0, -0.005, 0);
    holeGroup.add(rimMesh);

    parentGroup.add(holeGroup);

    const list = this.tankDecals.get(target.id) || [];
    list.push(holeGroup);
    if (list.length > 16) {
      const oldest = list.shift();
      if (oldest && oldest.parent) {
        oldest.parent.remove(oldest);
        oldest.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.geometry.dispose();
            (c.material as THREE.Material).dispose();
          }
        });
      }
    }
    this.tankDecals.set(target.id, list);
  }

  private updateProjectiles(dt: number) {
    const gravity = 9.81 * 1.45; // realistic ballistic arc

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      if (!proj.alive) {
        this.removeProjectileVisual(proj.id);
        this.projectiles.splice(i, 1);
        continue;
      }

      if (proj.trail.length < 10) {
        proj.trail.push({ x: proj.x, y: proj.y, z: proj.z });
      } else {
        proj.trail.shift();
        proj.trail.push({ x: proj.x, y: proj.y, z: proj.z });
      }

      const prevPos = this._scratchVec1.set(proj.x, proj.y, proj.z);

      proj.vy -= gravity * dt;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.z += proj.vz * dt;

      const curPos = this._scratchVec2.set(proj.x, proj.y, proj.z);
      const segVec = this._scratchVec3.subVectors(curPos, prevPos);
      const segLen = segVec.length();
      const segDir = segLen > 0.0001 ? segVec.clone().divideScalar(segLen) : this._scratchVec4.set(0, 0, 1);

      // Update 3D tracer mesh & spawn subtle smoke trail
      const vis = this.projectileMeshes.get(proj.id);
      if (vis) {
        vis.position.copy(curPos);
        vis.quaternion.setFromUnitVectors(this._scratchVec4.set(0, 0, 1), segDir);
      }
      if (Math.random() < 0.75) {
        this.spawn3DParticle(
          proj.x,
          proj.y,
          proj.z,
          (Math.random() - 0.5) * 0.4,
          0.3,
          (Math.random() - 0.5) * 0.4,
          0xd4d4d8,
          0.22,
          0.55,
          0.28,
          -0.2
        );
      }

      // 1. Tank Raycast Collision (Anti-tunneling continuous segment check!)
      let hitTank: BattleParticipant | null = null;
      let hitPoint: THREE.Vector3 | null = null;
      let hitNormal: THREE.Vector3 | null = null;
      let hitObject: THREE.Object3D | undefined;
      let bestDist = segLen + 0.6;

      this._scratchRaycaster.set(prevPos, segDir);
      this._scratchRaycaster.near = 0;
      this._scratchRaycaster.far = bestDist;

      for (const tank of this.participants) {
        if (!tank.isAlive || tank.id === proj.shooterId) continue;
        if (tank.team === proj.shooterTeam) continue;

        // Fast broadphase proximity filter
        const midX = (prevPos.x + curPos.x) * 0.5;
        const midZ = (prevPos.z + curPos.z) * 0.5;
        const broadDist = Math.hypot(midX - tank.x, midZ - tank.z);
        if (broadDist > tank.tankDef.hullLength + segLen * 0.5 + 2.5) continue;

        const bundle = this.tankMeshes.get(tank.id);
        if (!bundle) continue;

        bundle.rootGroup.updateMatrixWorld(true);
        const hits = this._scratchRaycaster.intersectObjects(
          [bundle.hullGroup, bundle.turretGroup],
          true
        );

        if (hits.length > 0 && hits[0].distance < bestDist) {
          bestDist = hits[0].distance;
          hitTank = tank;
          hitPoint = hits[0].point.clone();
          hitObject = hits[0].object;
          if (hits[0].face) {
            const nMat = new THREE.Matrix3().getNormalMatrix(hits[0].object.matrixWorld);
            hitNormal = hits[0].face.normal.clone().applyMatrix3(nMat).normalize();
          } else {
            hitNormal = segDir.clone().negate();
          }
        }
      }

      if (hitTank && hitPoint && hitNormal) {
        proj.x = hitPoint.x;
        proj.y = hitPoint.y;
        proj.z = hitPoint.z;
        proj.alive = false;
        this.processArmorHit(proj, hitTank, hitPoint, hitNormal, hitObject);
        this.removeProjectileVisual(proj.id);
        this.projectiles.splice(i, 1);
        continue;
      }

      // 2. Terrain impact check
      const groundY = this.terrain.getHeight(proj.x, proj.z);
      if (proj.y <= groundY) {
        proj.alive = false;
        this.spawn3DBurst(proj.x, groundY + 0.25, proj.z, 'dust', 10);
        this.spawnHitEffect(proj.x, groundY, proj.z, 'explosion', '#78716c');
        this.removeProjectileVisual(proj.id);
        this.projectiles.splice(i, 1);
        continue;
      }

      // 3. Obstacle impact check
      let hitObstacle = false;
      for (const obs of this.terrain.coverObstacles) {
        const d = Math.hypot(proj.x - obs.x, proj.z - obs.z);
        if (d < obs.radius && proj.y < this.terrain.getHeight(obs.x, obs.z) + obs.height) {
          hitObstacle = true;
          proj.alive = false;
          this.spawn3DBurst(proj.x, proj.y, proj.z, 'ricochet', 7);
          this.spawnHitEffect(proj.x, proj.y, proj.z, 'ricochet', '#f59e0b');
          soundEngine.playRicochet();
          break;
        }
      }
      if (hitObstacle) {
        this.removeProjectileVisual(proj.id);
        this.projectiles.splice(i, 1);
        continue;
      }

      // 4. Out of bounds check
      if (Math.abs(proj.x) > 650 || Math.abs(proj.z) > 650 || proj.y < -100) {
        proj.alive = false;
        this.removeProjectileVisual(proj.id);
        this.projectiles.splice(i, 1);
      }
    }
  }

  public getArmorZoneAtHit(
    target: BattleParticipant,
    hitPoint: THREE.Vector3,
    shotDir: THREE.Vector3
  ): {
    zoneName: string;
    nominalArmor: number;
    effectiveArmor: number;
    isRicochet: boolean;
    isTrackHit: boolean;
  } {
    const def = target.tankDef;
    const dx = hitPoint.x - target.x;
    const dy = hitPoint.y - target.y;
    const dz = hitPoint.z - target.z;

    const cosR = Math.cos(-target.rotationY);
    const sinR = Math.sin(-target.rotationY);
    const localX = dx * cosR - dz * sinR;
    const localZ = dx * sinR + dz * cosR;
    const localY = dy;

    const lDirX = shotDir.x * cosR - shotDir.z * sinR;
    const lDirZ = shotDir.x * sinR + shotDir.z * cosR;
    const lDirY = shotDir.y;
    const lDir = this._scratchVec3.set(lDirX, lDirY, lDirZ).normalize();

    let zoneName = 'ВЛД (Верхній бронелист)';
    let nominalArmor = def.armorHullFront;
    const surfaceNormal = this._scratchVec4.set(0, 0.6, 0.8).normalize();
    let isTrackHit = false;

    if (localY < 0.82 && Math.abs(localX) > def.hullWidth * 0.32) {
      zoneName = 'Гусениці';
      nominalArmor = def.armorTracks || 25;
      surfaceNormal.set(Math.sign(localX), 0, 0);
      isTrackHit = true;
    } else if (localY >= 1.35) {
      if (localY > 1.95 && Math.abs(localX) < 0.65) {
        zoneName = 'Лючок командира';
        nominalArmor = def.armorCupola || 60;
        surfaceNormal.set(localX * 0.8, 0.6, localZ * 0.8).normalize();
      } else if (localZ > 0.1) {
        if (Math.abs(localX) < 0.5) {
          zoneName = 'Маска гармати';
          nominalArmor = def.armorTurretMantlet || 165;
          surfaceNormal.set(localX * 0.3, 0.1, 0.95).normalize();
        } else {
          zoneName = 'Щоки башти';
          nominalArmor = def.armorTurretFront;
          surfaceNormal.set(Math.sign(localX) * 0.5, 0.2, 0.84).normalize();
        }
      } else if (Math.abs(localX) > 0.75) {
        zoneName = 'Борт башти';
        nominalArmor = def.armorTurretSides;
        surfaceNormal.set(Math.sign(localX), 0.1, 0).normalize();
      } else {
        zoneName = 'Корма башти';
        nominalArmor = def.armorTurretRear;
        surfaceNormal.set(0, 0, -1);
      }
    } else {
      if (localZ > 0.45) {
        if (localY < 0.92) {
          zoneName = 'НЛД (Нижній бронелист)';
          nominalArmor = def.armorHullLowerGlacis || Math.round(def.armorHullFront * 0.65);
          surfaceNormal.set(0, -0.35, 0.94).normalize();
        } else {
          zoneName = 'ВЛД (Верхній бронелист)';
          nominalArmor = def.armorHullFront;
          surfaceNormal.set(0, 0.65, 0.75).normalize();
        }
      } else if (Math.abs(localX) > def.hullWidth * 0.35) {
        zoneName = 'Борт корпусу';
        nominalArmor = def.armorHullSides;
        surfaceNormal.set(Math.sign(localX), 0, 0);
      } else {
        zoneName = 'Корма корпусу (Двигун)';
        nominalArmor = def.armorHullRear;
        surfaceNormal.set(0, 0.1, -1).normalize();
      }
    }

    const cosTheta = Math.max(0.12, Math.abs(lDir.dot(surfaceNormal)));
    const effectiveArmor = Math.round(nominalArmor / cosTheta);
    const isRicochet = cosTheta < 0.32;

    return {
      zoneName,
      nominalArmor,
      effectiveArmor,
      isRicochet,
      isTrackHit,
    };
  }

  private rollInternalModuleAndCrewDamage(
    target: BattleParticipant,
    zoneName: string,
    isShooterPlayer: boolean,
    shooter?: BattleParticipant
  ): boolean {
    let ammoRackDetonated = false;

    const reportCrit = (label: string, type: BattleRibbon['type'] = 'crit') => {
      if (isShooterPlayer) {
        this.addBattleRibbon(type, label);
      } else if (target.isPlayer) {
        this.addBattleRibbon(type, label);
      }
    };

    const r = Math.random();

    if (zoneName.includes('Корма корпусу')) {
      if (r < 0.55) {
        target.modules.engine = target.modules.engine === 'damaged' ? 'destroyed' : 'damaged';
        target.engineDamaged = true;
        reportCrit(target.isPlayer ? 'Двигун пошкоджено!' : 'Крит: Двигун!');
      } else {
        target.modules.fuelTank = 'damaged';
        reportCrit(target.isPlayer ? 'Паливний бак пробито!' : 'Крит: Паливний бак!');
      }
      if (!target.isOnFire && Math.random() < 0.36) {
        target.isOnFire = true;
        target.fireTimer = 5.0;
        reportCrit(target.isPlayer ? 'ПОЖЕЖА В ТАНКУ! [6]' : 'Ворог горить!', 'fire');
      }
    } else if (zoneName.includes('Борт корпусу') || zoneName.includes('башти')) {
      if (r < 0.42) {
        if (target.modules.ammoRack === 'damaged' && Math.random() < 0.55) {
          ammoRackDetonated = true;
        } else {
          target.modules.ammoRack = 'damaged';
          reportCrit(target.isPlayer ? 'Боєукладка пошкоджена!' : 'Крит: Боєукладка!');
        }
      } else if (r < 0.65 && zoneName.includes('Борт корпусу')) {
        target.modules.fuelTank = 'damaged';
        if (!target.isOnFire && Math.random() < 0.28) {
          target.isOnFire = true;
          target.fireTimer = 5.0;
          reportCrit(target.isPlayer ? 'ПОЖЕЖА В ТАНКУ! [6]' : 'Ворог горить!', 'fire');
        }
      } else if (zoneName.includes('башти') && r < 0.85) {
        target.crew.loader = 'injured';
        reportCrit(target.isPlayer ? 'Заряджаючий контужений! [5]' : 'Крит: Заряджаючий!');
      }
    } else if (zoneName.includes('Маска') || zoneName.includes('Щоки')) {
      if (r < 0.35) {
        target.modules.gun = 'damaged';
        target.gunDamaged = true;
        reportCrit(target.isPlayer ? 'Гармата пошкоджена!' : 'Крит: Гармата!');
      } else if (r < 0.6) {
        target.modules.turretRing = 'damaged';
        reportCrit(target.isPlayer ? 'Поворот башти заклинило!' : 'Крит: Механізм башти!');
      } else if (r < 0.82) {
        target.crew.gunner = 'injured';
        reportCrit(target.isPlayer ? 'Навідник поранений! [5]' : 'Крит: Навідник!');
      }
    } else if (zoneName.includes('Лючок')) {
      if (r < 0.55) {
        target.crew.commander = 'injured';
        reportCrit(target.isPlayer ? 'Командир поранений! [5]' : 'Крит: Командир!');
      } else {
        target.modules.optics = 'damaged';
        reportCrit(target.isPlayer ? 'Прилади спостереження розбиті!' : 'Крит: Триплекси!');
      }
    } else if (zoneName.includes('ВЛД') || zoneName.includes('НЛД')) {
      if (r < 0.38) {
        target.crew.driver = 'injured';
        reportCrit(target.isPlayer ? 'Мехвод поранений! [5]' : 'Крит: Мехвод!');
      } else if (r < 0.58) {
        target.modules.engine = 'damaged';
        target.engineDamaged = true;
        reportCrit(target.isPlayer ? 'Двигун зачеплено!' : 'Крит: Двигун!');
      } else if (r < 0.72) {
        if (target.modules.ammoRack === 'damaged' && Math.random() < 0.35) {
          ammoRackDetonated = true;
        } else {
          target.modules.ammoRack = 'damaged';
        }
      }
    }

    if (ammoRackDetonated) {
      target.ammoRackDetonated = true;
      const bonusDmg = target.currentHP;
      if (shooter) shooter.damageDealt += bonusDmg;
      target.currentHP = 0;
      if (isShooterPlayer) {
        this.addBattleRibbon('ammo_rack', `БОЄУКЛАДКА! -${bonusDmg} HP`, bonusDmg);
      } else if (target.isPlayer) {
        this.addBattleRibbon('ammo_rack', 'ВИБУХ БОЄУКЛАДКИ!');
      }
    }

    return ammoRackDetonated;
  }

  private processArmorHit(
    proj: Projectile,
    target: BattleParticipant,
    worldHitPoint?: THREE.Vector3,
    worldHitNormal?: THREE.Vector3,
    hitObject?: THREE.Object3D
  ) {
    const isShooterPlayer = proj.shooterId === this.player.id;
    if (isShooterPlayer) this.playerShotsHit++;

    const shooter = this.participants.find((p) => p.id === proj.shooterId);

    const hitPoint = worldHitPoint ? worldHitPoint.clone() : new THREE.Vector3(proj.x, proj.y, proj.z);
    const hitNormal = worldHitNormal
      ? worldHitNormal.clone()
      : new THREE.Vector3(-proj.vx, -proj.vy, -proj.vz).normalize();
    const shotDir = this._scratchVec6.set(proj.vx, proj.vy, proj.vz).normalize();
    const zoneInfo = this.getArmorZoneAtHit(target, hitPoint, shotDir);

    // Track damage handling
    if (zoneInfo.isTrackHit) {
      target.modules.tracks = 'destroyed';
      if (!target.tracksDamaged) {
        target.tracksDamaged = true;
        target.tracksRepairTimer = 6.0;
        this.spawnHitEffect(hitPoint.x, hitPoint.y, hitPoint.z, 'track_break', '#fbbf24', undefined, 'ГУСЕНИЦЯ ЗБИТА');
        if (isShooterPlayer) {
          soundEngine.playTrackBreak();
          soundEngine.playRadioCue('track_damaged');
          this.addBattleRibbon('crit', 'Гусениця збита!');
        }
      }
    }

    // Check Auto-ricochet
    if (zoneInfo.isRicochet && proj.shellType !== 'HE' && !zoneInfo.isTrackHit) {
      target.damageBlocked += proj.damage;
      this.spawnArmorImpactHole(target, hitPoint, hitNormal, false, hitObject);
      this.spawn3DBurst(hitPoint.x, hitPoint.y, hitPoint.z, 'ricochet', 9);
      this.spawnHitEffect(
        hitPoint.x,
        hitPoint.y,
        hitPoint.z,
        'ricochet',
        '#f59e0b',
        undefined,
        `РИКОШЕТ: ${zoneInfo.zoneName}`
      );
      if (isShooterPlayer) {
        soundEngine.playRicochet();
        soundEngine.playRadioCue('ricochet');
        this.addBattleRibbon('ricochet', `Рикошет (${zoneInfo.zoneName})`);
      }
      return;
    }

    // WoT RNG (+/- 15%) for penetration roll
    const penRng = 0.85 + Math.random() * 0.3;
    const rolledPen = proj.penetration * penRng;

    const isPenetrated = proj.shellType === 'HE' || rolledPen >= zoneInfo.effectiveArmor;

    if (isPenetrated) {
      const dmgRng = 0.85 + Math.random() * 0.3;
      let finalDamage = Math.round(proj.damage * dmgRng);

      if (proj.shellType === 'HE' && rolledPen < zoneInfo.effectiveArmor) {
        finalDamage = Math.round(finalDamage * 0.45);
      }

      target.currentHP = Math.max(0, target.currentHP - finalDamage);

      // Permanent 3D penetration hole at exact impact site!
      this.spawnArmorImpactHole(target, hitPoint, hitNormal, true, hitObject);
      this.spawn3DBurst(hitPoint.x, hitPoint.y, hitPoint.z, 'penetration', 11);

      // Internal Module & Crew damage roll
      const detonated = this.rollInternalModuleAndCrewDamage(
        target,
        zoneInfo.zoneName,
        isShooterPlayer,
        shooter
      );

      if (target.baseCapturePoints > 0) {
        target.baseCapturePoints = 0;
        if (isShooterPlayer) {
          this.addBattleRibbon('defense', 'Захист бази!');
        }
      }

      if (shooter) {
        shooter.damageDealt += finalDamage;
      }

      if (isShooterPlayer) {
        this.playerPenetrations++;
        soundEngine.playPenetration();
        soundEngine.playRadioCue('penetration');
        this.addBattleRibbon('damage', `${zoneInfo.zoneName}: -${finalDamage} HP`, finalDamage);
      }

      this.spawnHitEffect(
        hitPoint.x,
        hitPoint.y,
        hitPoint.z,
        'penetration',
        '#ef4444',
        finalDamage,
        `${zoneInfo.zoneName}`
      );

      if (target.currentHP <= 0 && target.isAlive) {
        target.isAlive = false;
        if (shooter) shooter.kills++;
        this.spawn3DBurst(target.x, target.y + 1.2, target.z, 'explosion', detonated ? 24 : 16);
        this.spawnHitEffect(target.x, target.y + 1, target.z, 'explosion', '#dc2626');
        soundEngine.playExplosion();

        if (isShooterPlayer) {
          soundEngine.playRadioCue('kill');
          this.addBattleRibbon('kill', `Знищено: ${target.name}`);
        }
      }
    } else {
      // Non-penetration armor scar!
      target.damageBlocked += proj.damage;
      this.spawnArmorImpactHole(target, hitPoint, hitNormal, false, hitObject);
      this.spawn3DBurst(hitPoint.x, hitPoint.y, hitPoint.z, 'ricochet', 7);
      this.spawnHitEffect(
        hitPoint.x,
        hitPoint.y,
        hitPoint.z,
        'ricochet',
        '#94a3b8',
        undefined,
        `НЕ ПРОБИТО: ${zoneInfo.zoneName}`
      );
      if (isShooterPlayer) {
        soundEngine.playRicochet();
        soundEngine.playRadioCue('ricochet');
        this.addBattleRibbon('ricochet', `Не пробито: ${zoneInfo.zoneName}`);
      }
    }
  }

  private updateSpotting(dt: number) {
    const playerDef = this.player.tankDef;
    const playerTurret =
      playerDef.turrets.find((t) => t.id === playerDef.installedTurretId) || playerDef.turrets[0];
    let playerViewRange = playerTurret.viewRange;
    if (playerDef.equippedGear.includes('optics')) playerViewRange *= 1.15;
    if (this.player.modules.optics === 'damaged') playerViewRange *= 0.65;
    if (this.player.crew.commander === 'injured') playerViewRange *= 0.85;

    for (const tank of this.participants) {
      if (tank.isPlayer || tank.team === 'green') {
        tank.isSpotted = true;
        continue;
      }

      if (tank.spotTimer > 0) {
        tank.spotTimer -= dt;
        if (tank.spotTimer <= 0) {
          tank.isSpotted = false;
        }
      }

      for (const ally of this.participants) {
        if (!ally.isAlive || ally.team !== 'green') continue;

        const dist = Math.hypot(tank.x - ally.x, tank.z - ally.z);
        const effectiveView = ally.isPlayer ? playerViewRange : 330;

        if (dist <= effectiveView) {
          const midX = (tank.x + ally.x) * 0.5;
          const midZ = (tank.z + ally.z) * 0.5;
          const midGroundY = this.terrain.getHeight(midX, midZ);
          const lineY = (tank.y + ally.y) * 0.5 + 1.2;

          if (midGroundY < lineY + 4.0) {
            const wasSpotted = tank.isSpotted;
            tank.isSpotted = true;
            tank.spotTimer = 10.0;

            if (!wasSpotted && ally.isPlayer) {
              this.player.spottedCount++;
              this.addBattleRibbon('spot', `Виявлено: ${tank.name}`);
            }
          }
        }
      }
    }
  }

  private updateBaseCapture(dt: number) {
    const greenBase = this.mapData.greenBase;
    const redBase = this.mapData.redBase;

    let greenInRedBase = 0;
    let redInGreenBase = 0;

    for (const tank of this.participants) {
      if (!tank.isAlive) continue;

      const distToRedBase = Math.hypot(tank.x - redBase.x, tank.z - redBase.z);
      if (distToRedBase <= redBase.radius && tank.team === 'green') {
        greenInRedBase++;
        tank.baseCapturePoints += dt * 1.5;
      }

      const distToGreenBase = Math.hypot(tank.x - greenBase.x, tank.z - greenBase.z);
      if (distToGreenBase <= greenBase.radius && tank.team === 'red') {
        redInGreenBase++;
        tank.baseCapturePoints += dt * 1.5;
      }
    }

    this.greenCapturingCount = greenInRedBase;
    this.redCapturingCount = redInGreenBase;

    if (greenInRedBase > 0) {
      this.greenCaptureProgress = Math.min(100, this.greenCaptureProgress + greenInRedBase * 1.2 * dt);
      if (this.greenCaptureProgress >= 100) {
        this.finishBattle('capture');
        return;
      }
    }

    if (redInGreenBase > 0) {
      this.redCaptureProgress = Math.min(100, this.redCaptureProgress + redInGreenBase * 1.2 * dt);
      soundEngine.playBaseAlarm();
      if (this.redCaptureProgress >= 100) {
        this.finishBattle('capture');
        return;
      }
    }
  }

  private update3DMeshes(dt: number) {
    for (const tank of this.participants) {
      const bundle = this.tankMeshes.get(tank.id);
      if (!bundle) continue;

      bundle.rootGroup.position.set(tank.x, tank.y, tank.z);
      bundle.rootGroup.rotation.order = 'YXZ';
      bundle.rootGroup.rotation.y = tank.rotationY;
      bundle.rootGroup.rotation.x = tank.pitch;
      bundle.rootGroup.rotation.z = tank.roll;

      bundle.turretGroup.rotation.y = tank.turretRotationY;
      bundle.mantletGroup.rotation.x = tank.gunElevation;

      // Blown turret fly-off animation on Ammo Rack Detonation!
      if (!tank.isAlive && tank.ammoRackDetonated) {
        if (bundle.turretGroup.position.y < 14) {
          bundle.turretGroup.position.y += 14 * dt;
          bundle.turretGroup.rotation.x += 2.8 * dt;
          bundle.turretGroup.rotation.z += 1.6 * dt;
        }
      }

      if (bundle.recoilOffset > 0) {
        bundle.recoilOffset = Math.max(0, bundle.recoilOffset - 2.5 * dt);
        bundle.gunBarrelMesh.position.z = -bundle.recoilOffset;
      }

      if (!tank.isAlive) {
        bundle.rootGroup.visible = true;
      } else {
        bundle.rootGroup.visible = tank.team === 'green' || tank.isSpotted;
      }
    }
  }

  private updateCamera(dt: number) {
    if (!this.player) return;

    const mouseSens = this.isSniperMode ? 0.0014 : 0.0022;
    this.cameraYaw -= this.mouseLookDelta.x * mouseSens;
    this.cameraPitch = Math.max(
      -0.42,
      Math.min(0.78, this.cameraPitch + this.mouseLookDelta.y * mouseSens)
    );
    this.mouseLookDelta.x = 0;
    this.mouseLookDelta.y = 0;

    const playerMesh = this.tankMeshes.get(this.player.id);
    if (!playerMesh) return;

    const tankDef = this.player.tankDef;
    const installedTurret =
      tankDef.turrets.find((t) => t.id === tankDef.installedTurretId) || tankDef.turrets[0];

    // Gun elevation limits (in Three.js +Z forward right-hand rule: negative rotX = barrel UP, positive rotX = barrel DOWN)
    const minRotX = -THREE.MathUtils.degToRad(tankDef.gunElevationDeg || 24);
    const maxRotX = THREE.MathUtils.degToRad(tankDef.gunDepressionDeg || 9);

    const turretMult =
      this.player.modules.turretRing === 'destroyed'
        ? 0.25
        : this.player.modules.turretRing === 'damaged'
        ? 0.55
        : 1.0;
    const gunnerMult = this.player.crew.gunner === 'injured' ? 0.8 : 1.0;
    const turretTraverseRate =
      THREE.MathUtils.degToRad(installedTurret.traverseSpeed || 38) * turretMult * gunnerMult;

    if (this.isSniperMode) {
      playerMesh.rootGroup.updateMatrixWorld(true);
      const mantletPos = new THREE.Vector3();
      playerMesh.mantletGroup.getWorldPosition(mantletPos);

      this.camera.position.set(mantletPos.x, mantletPos.y + 0.55, mantletPos.z);
      this.camera.fov = 42 / this.sniperZoomLevel;
      this.camera.updateProjectionMatrix();

      // Look direction from cameraYaw & cameraPitch: negative cameraPitch = look UP
      const lookDir = new THREE.Vector3(
        -Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
        -Math.sin(this.cameraPitch),
        -Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)
      ).normalize();

      this.aimTargetPoint.copy(this.camera.position).addScaledVector(lookDir, 380);
      this.camera.lookAt(this.aimTargetPoint);

      let relYaw = this.cameraYaw - this.player.rotationY + Math.PI;
      while (relYaw > Math.PI) relYaw -= Math.PI * 2;
      while (relYaw < -Math.PI) relYaw += Math.PI * 2;

      if (tankDef.tankClass === 'destroyer') {
        relYaw = THREE.MathUtils.clamp(relYaw, -0.32, 0.32);
      }

      const yawDiff = relYaw - this.player.turretRotationY;
      this.player.turretRotationY +=
        Math.sign(yawDiff) * Math.min(Math.abs(yawDiff), turretTraverseRate * 1.4 * dt);

      // In sniper mode: +cameraPitch directly equals mantlet rotation.x!
      const desiredRotX = this.cameraPitch;
      const clampedRotX = THREE.MathUtils.clamp(desiredRotX, minRotX, maxRotX);
      this.isAimBlockedByUBN = Math.abs(desiredRotX - clampedRotX) > 0.015;
      this.player.gunElevation = THREE.MathUtils.damp(this.player.gunElevation, clampedRotX, 16, dt);
    } else {
      // Elevated Third-Person Chase Camera (higher WoT commander perspective)
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();

      const targetPos = new THREE.Vector3(this.player.x, this.player.y + 3.0, this.player.z);
      const camOffset = new THREE.Vector3(
        Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch) * this.cameraDistance,
        Math.sin(this.cameraPitch) * this.cameraDistance + 2.6,
        Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch) * this.cameraDistance
      );

      const desiredCamPos = targetPos.clone().add(camOffset);
      const terrainAtCam = this.terrain.getHeight(desiredCamPos.x, desiredCamPos.z) + 1.5;
      if (desiredCamPos.y < terrainAtCam) {
        desiredCamPos.y = terrainAtCam;
      }

      this.camera.position.copy(desiredCamPos);
      this.camera.lookAt(targetPos);

      // Raycast from camera center against BOTH spotted enemy tanks AND terrain so aiming at a tank locks accurately!
      this._scratchRaycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
      this._scratchRaycaster.near = 2.0;
      this._scratchRaycaster.far = 550;

      const rayTargets: THREE.Object3D[] = [this.terrain.terrainMesh];
      for (const enemy of this.participants) {
        if (!enemy.isAlive || enemy.team === 'green' || !enemy.isSpotted) continue;
        const bundle = this.tankMeshes.get(enemy.id);
        if (bundle) {
          rayTargets.push(bundle.hullGroup, bundle.turretGroup);
        }
      }

      const hits = this._scratchRaycaster.intersectObjects(rayTargets, true);
      if (hits.length > 0) {
        this.aimTargetPoint.copy(hits[0].point);
      } else {
        this._scratchRaycaster.ray.at(380, this.aimTargetPoint);
      }

      // Compute Horizontal Turret Aim Angle
      playerMesh.rootGroup.updateMatrixWorld(true);
      const turretWorldPos = new THREE.Vector3();
      playerMesh.turretGroup.getWorldPosition(turretWorldPos);

      const targetWorldYaw = Math.atan2(
        this.aimTargetPoint.x - turretWorldPos.x,
        this.aimTargetPoint.z - turretWorldPos.z
      );

      let targetRelAngle = targetWorldYaw - this.player.rotationY;
      while (targetRelAngle > Math.PI) targetRelAngle -= Math.PI * 2;
      while (targetRelAngle < -Math.PI) targetRelAngle += Math.PI * 2;

      if (tankDef.tankClass === 'destroyer') {
        targetRelAngle = THREE.MathUtils.clamp(targetRelAngle, -0.32, 0.32);
      }

      const diff = targetRelAngle - this.player.turretRotationY;
      if (Math.abs(diff) > 0.005) {
        this.player.turretRotationY +=
          Math.sign(diff) * Math.min(Math.abs(diff), turretTraverseRate * dt);
      }

      // Apply horizontal turret yaw before computing mantlet local elevation pitch!
      playerMesh.turretGroup.rotation.y = this.player.turretRotationY;
      playerMesh.rootGroup.updateMatrixWorld(true);

      const localAimInTurret = playerMesh.turretGroup.worldToLocal(
        this._scratchVec2.copy(this.aimTargetPoint)
      );
      const dy = localAimInTurret.y - playerMesh.mantletGroup.position.y;
      const dz = localAimInTurret.z - playerMesh.mantletGroup.position.z;
      const dx = localAimInTurret.x - playerMesh.mantletGroup.position.x;
      const horizDist = Math.max(1.0, Math.hypot(dx, dz));

      // Negative atan2(dy, horizDist): positive dy (aim UP) -> negative rot.x (barrel UP)!
      const desiredRotX = -Math.atan2(dy, horizDist);
      const clampedRotX = THREE.MathUtils.clamp(desiredRotX, minRotX, maxRotX);
      this.isAimBlockedByUBN = Math.abs(desiredRotX - clampedRotX) > 0.015;
      this.player.gunElevation = THREE.MathUtils.damp(this.player.gunElevation, clampedRotX, 14, dt);
    }

    this.updatePenetrationIndicator();
  }

  private updatePenetrationIndicator() {
    this._scratchRaycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this._scratchRaycaster.near = 2.0;
    this._scratchRaycaster.far = 550;

    let foundTarget: BattleParticipant | null = null;
    let hitPoint: THREE.Vector3 | null = null;

    for (const enemy of this.participants) {
      if (!enemy.isAlive || enemy.team === 'green' || !enemy.isSpotted) continue;
      const meshBundle = this.tankMeshes.get(enemy.id);
      if (!meshBundle) continue;

      const intersects = this._scratchRaycaster.intersectObjects(
        [meshBundle.hullGroup, meshBundle.turretGroup],
        true
      );
      if (intersects.length > 0) {
        foundTarget = enemy;
        hitPoint = intersects[0].point;
        break;
      }
    }

    if (foundTarget && hitPoint) {
      const cameraDir = this._scratchRaycaster.ray.direction;
      const zoneInfo = this.getArmorZoneAtHit(foundTarget, hitPoint, cameraDir);

      this.targetTankName = `${foundTarget.name} [${zoneInfo.zoneName}: ${zoneInfo.nominalArmor}мм]`;

      const playerGun =
        this.player.tankDef.guns.find((g) => g.id === this.player.tankDef.installedGunId) ||
        this.player.tankDef.guns[0];

      const currentPen =
        this.player.activeShell === 'APCR'
          ? playerGun.penetrationAPCR
          : this.player.activeShell === 'HE'
          ? playerGun.penetrationAP * 0.45
          : playerGun.penetrationAP;

      const penRatio = currentPen / zoneInfo.effectiveArmor;

      if (zoneInfo.isRicochet && this.player.activeShell !== 'HE') {
        this.penetrationIndicator = 'red';
      } else if (penRatio >= 1.15) {
        this.penetrationIndicator = 'green';
      } else if (penRatio >= 0.88) {
        this.penetrationIndicator = 'orange';
      } else {
        this.penetrationIndicator = 'red';
      }
    } else {
      this.penetrationIndicator = 'none';
      this.targetTankName = '';
    }
  }

  private checkObstacleCollision(x: number, z: number, tankRadius: number): boolean {
    for (const obs of this.terrain.coverObstacles) {
      const d = Math.hypot(x - obs.x, z - obs.z);
      if (d < obs.radius + tankRadius) {
        return true;
      }
    }
    return false;
  }

  private spawnHitEffect(
    x: number,
    y: number,
    z: number,
    type: 'penetration' | 'ricochet' | 'explosion' | 'track_break',
    color: string,
    damageNumber?: number,
    text?: string
  ) {
    this.hitEffects.push({
      id: `fx_${Date.now()}_${Math.random()}`,
      x,
      y,
      z,
      type,
      color,
      life: 0,
      maxLife: 1.2,
      damageNumber,
      text,
    });
  }

  private updateEffects(dt: number) {
    for (let i = this.hitEffects.length - 1; i >= 0; i--) {
      const fx = this.hitEffects[i];
      fx.life += dt;
      if (fx.life >= fx.maxLife) {
        this.hitEffects.splice(i, 1);
      }
    }

    // Update 3D particles (sparks, smoke, dust, explosions)
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.effectsGroup.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.activeParticles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const t = p.life / p.maxLife;
      const s = THREE.MathUtils.lerp(p.scaleStart, p.scaleEnd, t);
      p.mesh.scale.setScalar(s);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
    }

    const now = Date.now();
    for (let i = this.battleRibbons.length - 1; i >= 0; i--) {
      if (now - this.battleRibbons[i].timestamp > 4500) {
        this.battleRibbons.splice(i, 1);
      }
    }
  }

  public addBattleRibbon(
    type: BattleRibbon['type'],
    title: string,
    value?: number
  ) {
    this.battleRibbons.unshift({
      id: `ribbon_${Date.now()}_${Math.random()}`,
      type,
      title,
      value,
      timestamp: Date.now(),
    });
    if (this.battleRibbons.length > 5) {
      this.battleRibbons.pop();
    }
  }

  private checkBattleStatus() {
    const aliveGreen = this.participants.filter((p) => p.team === 'green' && p.isAlive).length;
    const aliveRed = this.participants.filter((p) => p.team === 'red' && p.isAlive).length;

    if (aliveRed === 0) {
      this.finishBattle('annihilation');
    } else if (aliveGreen === 0) {
      this.finishBattle('annihilation');
    }
  }

  private finishBattle(reason: 'annihilation' | 'capture' | 'timeout') {
    if (this.isBattleOver) return;
    this.isBattleOver = true;

    const aliveGreen = this.participants.filter((p) => p.team === 'green' && p.isAlive).length;
    const aliveRed = this.participants.filter((p) => p.team === 'red' && p.isAlive).length;

    let result: 'victory' | 'defeat' | 'draw' = 'draw';
    if (reason === 'capture') {
      result = this.greenCaptureProgress >= 100 ? 'victory' : 'defeat';
    } else if (reason === 'annihilation') {
      result = aliveRed === 0 ? 'victory' : 'defeat';
    } else {
      result = aliveGreen > aliveRed ? 'victory' : aliveRed > aliveGreen ? 'defeat' : 'draw';
    }

    const victoryBonus = result === 'victory' ? 2.0 : result === 'draw' ? 1.0 : 0.6;
    const creditsEarned = Math.round(
      (this.player.damageDealt * 25 +
        this.player.kills * 4500 +
        this.player.spottedCount * 800 +
        this.player.baseCapturePoints * 120 +
        12000) *
        victoryBonus
    );

    const xpEarned = Math.round(
      (this.player.damageDealt * 1.8 +
        this.player.kills * 350 +
        this.player.spottedCount * 120 +
        this.player.baseCapturePoints * 25 +
        800) *
        victoryBonus
    );

    this.battleSummary = {
      result,
      reason,
      durationSeconds: Math.round(600 - this.battleTimeRemaining),
      greenScore: 15 - aliveRed,
      redScore: 15 - aliveGreen,
      creditsEarned,
      xpEarned,
      playerStats: {
        damageDealt: this.player.damageDealt,
        kills: this.player.kills,
        spotted: this.player.spottedCount,
        damageBlocked: this.player.damageBlocked,
        shotsFired: this.playerShotsFired,
        shotsHit: this.playerShotsHit,
        penetrations: this.playerPenetrations,
        capturePoints: Math.round(this.player.baseCapturePoints),
      },
      teamRoster: [...this.participants],
    };

    if (this.onBattleEndCallback) {
      this.onBattleEndCallback(this.battleSummary);
    }
  }

  public dispose() {
    for (const id of Array.from(this.projectileMeshes.keys())) {
      this.removeProjectileVisual(id);
    }
    for (const p of this.activeParticles) {
      this.effectsGroup.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.activeParticles = [];
    for (const list of this.tankDecals.values()) {
      for (const m of list) {
        if (m.parent) m.parent.remove(m);
        m.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.geometry.dispose();
            (c.material as THREE.Material).dispose();
          }
        });
      }
    }
    this.tankDecals.clear();
    this.terrain.dispose();
    this.tankMeshes.clear();
  }
}
