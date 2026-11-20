/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { TankDefinition } from '../types.ts';

// Cache procedural camo textures so we don't recreate them needlessly
const camoTextureCache: Record<string, THREE.CanvasTexture> = {};

function getProceduralCamoTexture(baseHex: string, pattern: string): THREE.CanvasTexture {
  const key = `${baseHex}_${pattern}`;
  if (camoTextureCache[key]) return camoTextureCache[key];

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 512, 512);

  // Military camouflage blotches & panel lines
  const secondaryColor = pattern === 'desert' ? '#6b5438' : '#283824';
  const tertiaryColor = pattern === 'desert' ? '#8a7251' : '#1c2818';

  ctx.fillStyle = secondaryColor;
  for (let i = 0; i < 28; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const rx = 30 + Math.random() * 60;
    const ry = 20 + Math.random() * 45;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = tertiaryColor;
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const rx = 20 + Math.random() * 40;
    const ry = 15 + Math.random() * 30;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Steel plate rivets & subtle edge wear
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, 504, 504);
  ctx.strokeRect(60, 60, 392, 392);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  camoTextureCache[key] = texture;
  return texture;
}

// Contact shadow texture
let contactShadowTexture: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture {
  if (contactShadowTexture) return contactShadowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(128, 128, 30, 128, 128, 120);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
  gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.35)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  contactShadowTexture = new THREE.CanvasTexture(canvas);
  return contactShadowTexture;
}

export interface TankMeshBundle {
  rootGroup: THREE.Group;
  hullGroup: THREE.Group;
  turretGroup: THREE.Group;
  mantletGroup: THREE.Group;
  gunBarrelMesh: THREE.Mesh;
  muzzlePoint: THREE.Object3D;
  leftTracks: THREE.Group;
  rightTracks: THREE.Group;
  recoilOffset: number;
}

export function buildTank3D(
  tankDef: TankDefinition,
  team: 'green' | 'red',
  isPlayer: boolean
): TankMeshBundle {
  const root = new THREE.Group();
  root.name = `tank_${tankDef.id}_${team}`;

  const isDestroyer = tankDef.tankClass === 'destroyer';
  const isHeavy = tankDef.tankClass === 'heavy';
  const isLight = tankDef.tankClass === 'light';

  const installedGun =
    tankDef.guns.find((g) => g.id === tankDef.installedGunId) || tankDef.guns[0];
  const barrelScale = installedGun ? installedGun.barrelLength : 4.0;

  // Materials
  const camoMap = getProceduralCamoTexture(tankDef.baseColor, tankDef.camoPattern);
  const armorMat = new THREE.MeshStandardMaterial({
    map: camoMap,
    roughness: 0.75,
    metalness: 0.25,
  });

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x24282c,
    roughness: 0.6,
    metalness: 0.7,
  });

  const rubberTrackMat = new THREE.MeshStandardMaterial({
    color: 0x181a1d,
    roughness: 0.9,
    metalness: 0.1,
  });

  const insigniaColor = team === 'green' ? 0x22c55e : 0xef4444;
  const insigniaMat = new THREE.MeshStandardMaterial({
    color: insigniaColor,
    roughness: 0.4,
    metalness: 0.5,
  });

  // 1. Soft Contact Shadow Plane
  const shadowGeo = new THREE.PlaneGeometry(tankDef.hullWidth * 1.6, tankDef.hullLength * 1.4);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.05;
  root.add(shadowMesh);

  // 2. Chassis / Lower Hull
  const hullGroup = new THREE.Group();
  hullGroup.position.y = 0.5; // ground clearance
  root.add(hullGroup);

  // Main Hull Body
  const hullL = tankDef.hullLength;
  const hullW = tankDef.hullWidth;
  const hullH = tankDef.hullHeight;

  // Upper sloped glacis plate
  const hullGeo = new THREE.BoxGeometry(hullW, hullH, hullL);
  const hullMesh = new THREE.Mesh(hullGeo, armorMat);
  hullMesh.position.y = hullH * 0.5 + 0.3;
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  hullGroup.add(hullMesh);

  // Sloped Front Glacis Plate
  const glacisGeo = new THREE.BoxGeometry(hullW * 0.96, hullH * 0.8, hullL * 0.35);
  glacisGeo.rotateX(Math.PI * 0.18);
  const glacisMesh = new THREE.Mesh(glacisGeo, armorMat);
  glacisMesh.position.set(0, hullH * 0.5 + 0.25, hullL * 0.42);
  glacisMesh.castShadow = true;
  glacisMesh.receiveShadow = true;
  hullGroup.add(glacisMesh);

  // Rear Engine Deck & Exhaust pipes
  const engineDeckGeo = new THREE.BoxGeometry(hullW * 0.85, 0.25, hullL * 0.35);
  const engineDeckMesh = new THREE.Mesh(engineDeckGeo, steelMat);
  engineDeckMesh.position.set(0, hullH + 0.35, -hullL * 0.28);
  engineDeckMesh.castShadow = true;
  hullGroup.add(engineDeckMesh);

  // Dual Exhaust pipes
  for (const side of [-1, 1]) {
    const exhaustGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.8, 8);
    exhaustGeo.rotateX(Math.PI * 0.25 * side);
    const exhaustMesh = new THREE.Mesh(exhaustGeo, steelMat);
    exhaustMesh.position.set(side * (hullW * 0.35), hullH + 0.4, -hullL * 0.48);
    hullGroup.add(exhaustMesh);
  }

  // 3. Tracks & Roadwheels (Left and Right)
  const leftTracks = new THREE.Group();
  const rightTracks = new THREE.Group();
  hullGroup.add(leftTracks);
  hullGroup.add(rightTracks);

  const trackWidth = hullW * 0.2;
  const wheelCount = isHeavy ? 6 : isLight ? 4 : 5;
  const wheelRadius = 0.42;

  for (const side of [-1, 1]) {
    const trackGroup = side === -1 ? leftTracks : rightTracks;
    const trackX = side * (hullW * 0.5 + trackWidth * 0.3);

    // Continuous track belt outer shroud
    const beltGeo = new THREE.BoxGeometry(trackWidth, 0.65, hullL * 0.98);
    const beltMesh = new THREE.Mesh(beltGeo, rubberTrackMat);
    beltMesh.position.set(trackX, 0.35, 0);
    beltMesh.castShadow = true;
    beltMesh.receiveShadow = true;
    trackGroup.add(beltMesh);

    // Mudguard / Track skirt armor
    const skirtGeo = new THREE.BoxGeometry(0.08, 0.35, hullL * 0.95);
    const skirtMesh = new THREE.Mesh(skirtGeo, armorMat);
    skirtMesh.position.set(trackX + side * (trackWidth * 0.5 + 0.04), 0.72, 0);
    skirtMesh.castShadow = true;
    trackGroup.add(skirtMesh);

    // Road wheels
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, trackWidth * 0.85, 12);
    wheelGeo.rotateZ(Math.PI / 2);

    for (let w = 0; w < wheelCount; w++) {
      const wz = ((w / (wheelCount - 1)) - 0.5) * (hullL * 0.75);
      const wheelMesh = new THREE.Mesh(wheelGeo, steelMat);
      wheelMesh.position.set(trackX, 0.32, wz);
      wheelMesh.castShadow = true;
      trackGroup.add(wheelMesh);
    }
  }

  // 4. Team Badge / National Roundel on Hull Sides
  for (const side of [-1, 1]) {
    const badgeGeo = new THREE.BoxGeometry(0.05, 0.4, 0.4);
    const badgeMesh = new THREE.Mesh(badgeGeo, insigniaMat);
    badgeMesh.position.set(side * (hullW * 0.52), hullH * 0.8, 0);
    hullGroup.add(badgeMesh);
  }

  // 5. Turret Assembly (or Casemate if Tank Destroyer)
  const turretGroup = new THREE.Group();
  const turretBaseY = hullH + 0.3;
  turretGroup.position.set(0, turretBaseY, isDestroyer ? hullL * 0.08 : 0);
  hullGroup.add(turretGroup);

  let turretBodyMesh: THREE.Mesh;
  const turretWidth = isHeavy ? hullW * 0.75 : hullW * 0.65;
  const turretHeight = isHeavy ? 0.9 : 0.75;
  const turretLength = isHeavy ? hullL * 0.55 : hullL * 0.45;

  if (isDestroyer) {
    // Casemate superstructure
    const casemateGeo = new THREE.BoxGeometry(hullW * 0.85, 1.1, hullL * 0.5);
    turretBodyMesh = new THREE.Mesh(casemateGeo, armorMat);
    turretBodyMesh.position.set(0, 0.55, 0);
  } else if (isHeavy && tankDef.id === 'is3_heavy') {
    // Rounded hemispherical dome turret (IS-3 style)
    const domeGeo = new THREE.SphereGeometry(turretWidth * 0.55, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
    turretBodyMesh = new THREE.Mesh(domeGeo, armorMat);
    turretBodyMesh.scale.set(1.1, 0.7, 1.3);
    turretBodyMesh.position.set(0, 0.1, -0.1);
  } else {
    // Standard faceted cast turret
    const bodyGeo = new THREE.CylinderGeometry(turretWidth * 0.45, turretWidth * 0.55, turretHeight, 14);
    turretBodyMesh = new THREE.Mesh(bodyGeo, armorMat);
    turretBodyMesh.scale.set(1.0, 1.0, 1.25);
    turretBodyMesh.position.set(0, turretHeight * 0.5, 0);
  }

  turretBodyMesh.castShadow = true;
  turretBodyMesh.receiveShadow = true;
  turretGroup.add(turretBodyMesh);

  // Commander Cupola & Hatch
  if (!isDestroyer) {
    const cupolaGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.3, 10);
    const cupolaMesh = new THREE.Mesh(cupolaGeo, steelMat);
    cupolaMesh.position.set(turretWidth * 0.25, turretHeight + 0.1, -turretLength * 0.15);
    cupolaMesh.castShadow = true;
    turretGroup.add(cupolaMesh);

    // Radio Antenna
    const antennaGeo = new THREE.CylinderGeometry(0.02, 0.03, 2.2, 6);
    antennaGeo.translate(0, 1.1, 0);
    const antennaMesh = new THREE.Mesh(antennaGeo, steelMat);
    antennaMesh.position.set(-turretWidth * 0.3, turretHeight, -turretLength * 0.25);
    turretGroup.add(antennaMesh);
  }

  // 6. Gun Mantlet (elevation pivot)
  const mantletGroup = new THREE.Group();
  const mantletZ = isDestroyer ? hullL * 0.28 : turretLength * 0.5;
  const mantletY = isDestroyer ? 0.6 : turretHeight * 0.5;
  mantletGroup.position.set(0, mantletY, mantletZ);
  turretGroup.add(mantletGroup);

  // Armored Gun Collar / Mantlet
  const mantletGeo = new THREE.BoxGeometry(0.7, 0.5, 0.4);
  const mantletMesh = new THREE.Mesh(mantletGeo, steelMat);
  mantletMesh.castShadow = true;
  mantletGroup.add(mantletMesh);

  // 7. Gun Barrel with realistic taper & Muzzle Brake
  const barrelGroup = new THREE.Group();
  mantletGroup.add(barrelGroup);

  const barrelLength = barrelScale;
  const barrelGeo = new THREE.CylinderGeometry(0.08, 0.14, barrelLength, 12);
  barrelGeo.rotateX(Math.PI / 2);
  barrelGeo.translate(0, 0, barrelLength * 0.5);

  const gunBarrelMesh = new THREE.Mesh(barrelGeo, steelMat);
  gunBarrelMesh.castShadow = true;
  barrelGroup.add(gunBarrelMesh);

  // Muzzle Brake at tip
  const muzzleGeo = new THREE.BoxGeometry(0.3, 0.24, 0.45);
  const muzzleMesh = new THREE.Mesh(muzzleGeo, steelMat);
  muzzleMesh.position.set(0, 0, barrelLength);
  muzzleMesh.castShadow = true;
  barrelGroup.add(muzzleMesh);

  // Muzzle Tip (Shell spawn point)
  const muzzlePoint = new THREE.Object3D();
  muzzlePoint.position.set(0, 0, barrelLength + 0.3);
  barrelGroup.add(muzzlePoint);

  return {
    rootGroup: root,
    hullGroup,
    turretGroup,
    mantletGroup,
    gunBarrelMesh,
    muzzlePoint,
    leftTracks,
    rightTracks,
    recoilOffset: 0,
  };
}
