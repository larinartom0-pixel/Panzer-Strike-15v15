/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TankClass = 'medium' | 'heavy' | 'destroyer' | 'light';

export type ShellType = 'AP' | 'APCR' | 'HE';

export interface ShellInfo {
  type: ShellType;
  name: string;
  penetration: number; // mm
  damage: number; // HP
  velocity: number; // m/s
  cost: number; // credits per round
  description: string;
}

export interface TankModule {
  id: string;
  name: string;
  tier: number;
  costXP: number;
  costCredits: number;
  unlocked: boolean;
  installed: boolean;
}

export interface GunModule extends TankModule {
  caliber: string;
  penetrationAP: number;
  penetrationAPCR: number;
  damageAP: number;
  damageHE: number;
  reloadTime: number; // seconds
  aimTime: number; // seconds
  dispersion: number; // accuracy (lower is better)
  barrelLength: number; // 3D scale
}

export interface TurretModule extends TankModule {
  armorFront: number;
  armorSides: number;
  armorRear: number;
  hpBonus: number;
  traverseSpeed: number; // deg/s
  viewRange: number; // meters
}

export interface EngineModule extends TankModule {
  horsepower: number;
  topSpeed: number; // km/h
  reverseSpeed: number;
  acceleration: number;
  fireChance: number; // %
}

export interface SuspensionModule extends TankModule {
  traverseSpeed: number; // deg/s
  loadLimit: number; // tons
  passability: number; // 1.0 = base
  trackHP: number;
}

export interface TankEquipment {
  id: string;
  name: string;
  icon: string;
  description: string;
  costCredits: number;
  equipped: boolean;
  effect: {
    reloadMult?: number;
    viewRangeMult?: number;
    speedBonus?: number;
    repairSpeedMult?: number;
    camoBonus?: number;
  };
}

export type ModuleHealthState = 'intact' | 'damaged' | 'destroyed';
export type CrewHealthState = 'healthy' | 'injured';

export interface TankInternalModules {
  engine: ModuleHealthState;
  ammoRack: ModuleHealthState;
  fuelTank: ModuleHealthState;
  gun: ModuleHealthState;
  turretRing: ModuleHealthState;
  optics: ModuleHealthState;
  tracks: ModuleHealthState;
}

export interface TankCrewStatus {
  commander: CrewHealthState;
  gunner: CrewHealthState;
  driver: CrewHealthState;
  loader: CrewHealthState;
  radioOperator: CrewHealthState;
}

export interface TankDefinition {
  id: string;
  name: string;
  nation: 'UA' | 'Allied' | 'Continental';
  tankClass: TankClass;
  tier: number;
  description: string;
  priceCredits: number;
  priceXP: number;
  unlocked: boolean; // Purchased and in hangar
  researched?: boolean; // Researched with XP in Tech Tree
  requiredTankId?: string; // Prerequisite tank in Tech Tree
  baseColor: string;
  accentColor: string;
  camoPattern: 'summer' | 'desert' | 'winter';
  
  // Dimensions & Weight
  hullLength: number;
  hullWidth: number;
  hullHeight: number;
  weightTons: number;

  // Gun Elevation/Depression limits (УВН in degrees)
  gunDepressionDeg: number; // e.g. 8 to 12 deg down
  gunElevationDeg: number; // e.g. 20 to 26 deg up

  // Armor (mm) across distinct tank zones
  armorHullFront: number; // Верхня лобова деталь (ВЛД)
  armorHullLowerGlacis: number; // Нижня лобова деталь (НЛД - слабка зона)
  armorHullSides: number; // Борти корпусу
  armorHullRear: number; // Корма корпусу
  armorTurretFront: number; // Лоб вежі
  armorTurretSides: number; // Борти вежі
  armorTurretRear: number; // Корма вежі
  armorTurretMantlet: number; // Маска гармати (найтовстіша зона)
  armorCupola: number; // Лючок командира (вразлива точка)
  armorTracks: number; // Екрани гусениць (поглинання фугасів/кумулятивів)

  // Modules available
  guns: GunModule[];
  turrets: TurretModule[];
  engines: EngineModule[];
  suspensions: SuspensionModule[];

  // Current shell loadout (counts)
  shellLoadout: {
    AP: number;
    APCR: number;
    HE: number;
  };

  // Upgrades
  installedGunId: string;
  installedTurretId: string;
  installedEngineId: string;
  installedSuspensionId: string;

  // Equipment slots (up to 3)
  equippedGear: string[];
}

export interface PlayerStats {
  credits: number;
  freeXP: number;
  battles: number;
  victories: number;
  defeats: number;
  totalDamage: number;
  totalKills: number;
  totalSpotted: number;
  masteryBadges: Record<string, number>; // tankId -> level (1-4)
}

export interface BattleParticipant {
  id: string;
  name: string;
  team: 'green' | 'red';
  isPlayer: boolean;
  tankDef: TankDefinition;
  
  // Position & Kinematics (Real 3D Rigid-Body Tank Physics)
  x: number;
  y: number;
  z: number;
  vx: number; // world velocity X (m/s)
  vz: number; // world velocity Z (m/s)
  verticalVel: number; // vertical velocity Y (m/s)
  isAirborne: boolean;
  rotationY: number; // hull heading in radians
  turretRotationY: number; // relative to hull
  gunElevation: number; // mantlet pitch in radians
  speed: number; // forward signed speed (m/s)
  currentTurnSpeed: number; // angular velocity rad/s
  pitch: number; // dynamic suspension pitch
  roll: number; // dynamic suspension roll
  pitchVel: number;
  rollVel: number;
  isFlipped: boolean; // tank flipped onto side or roof
  flipTimer: number;
  
  // Combat Status
  maxHP: number;
  currentHP: number;
  isAlive: boolean;
  isSpotted: boolean;
  spotTimer: number; // remaining spotted time
  ammoRackDetonated?: boolean;
  
  // Reload & Modules
  reloadProgress: number; // 0 to 1 (1 = ready to shoot)
  activeShell: ShellType;
  shellsRemaining: {
    AP: number;
    APCR: number;
    HE: number;
  };
  
  // Damageable Modules & Crew
  tracksDamaged: boolean;
  tracksRepairTimer: number;
  engineDamaged: boolean;
  gunDamaged: boolean;
  modules: TankInternalModules;
  crew: TankCrewStatus;
  isOnFire: boolean;
  fireTimer: number;
  consumableCooldowns: {
    repairKit: number;
    medKit: number;
    fireExtinguisher: number;
  };
  
  // Battle Performance
  damageDealt: number;
  kills: number;
  spottedCount: number;
  baseCapturePoints: number;
  damageBlocked: number;
  
  // AI Behavior state (for bots)
  aiRole?: 'brawler' | 'flanker' | 'sniper' | 'scout';
  aiTargetId?: string | null;
  aiWaypointIndex?: number;
  aiActionTimer?: number;
  aiRetreating?: boolean;
}

export interface Projectile {
  id: string;
  shooterId: string;
  shooterTeam: 'green' | 'red';
  shellType: ShellType;
  startX: number;
  startY: number;
  startZ: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  penetration: number;
  damage: number;
  alive: boolean;
  trail: { x: number; y: number; z: number }[];
}

export interface HitEffect {
  id: string;
  x: number;
  y: number;
  z: number;
  type: 'penetration' | 'ricochet' | 'explosion' | 'track_break';
  color: string;
  life: number;
  maxLife: number;
  damageNumber?: number;
  text?: string;
}

export interface BattleRibbon {
  id: string;
  type: 'spot' | 'damage' | 'penetration' | 'ricochet' | 'kill' | 'capture' | 'defense' | 'ram' | 'crit' | 'fire' | 'ammo_rack';
  title: string;
  value?: number;
  timestamp: number;
}

export interface MapData {
  id: string;
  name: string;
  nameUk: string;
  biome: 'steppe' | 'mountain' | 'valley' | 'desert';
  size: number; // meters e.g. 1000
  greenBase: { x: number; z: number; radius: number };
  redBase: { x: number; z: number; radius: number };
  fogColor: number;
  skyColor: number;
  groundTint: number;
  descriptionUk: string;
}

export type BattleResultType = 'victory' | 'defeat' | 'draw';

export interface BattleSummary {
  result: BattleResultType;
  reason: 'annihilation' | 'capture' | 'timeout';
  durationSeconds: number;
  greenScore: number;
  redScore: number;
  creditsEarned: number;
  xpEarned: number;
  playerStats: {
    damageDealt: number;
    kills: number;
    spotted: number;
    damageBlocked: number;
    shotsFired: number;
    shotsHit: number;
    penetrations: number;
    capturePoints: number;
  };
  teamRoster: BattleParticipant[];
}
