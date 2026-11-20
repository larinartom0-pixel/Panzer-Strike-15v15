/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { MapData } from '../types.ts';

// Smooth noise generator for battlefield terrain
function pseudoNoise(x: number, z: number): number {
  return (
    Math.sin(x * 0.008 + 1.2) * Math.cos(z * 0.008 - 0.7) * 18 +
    Math.sin(x * 0.018 - 2.1) * Math.sin(z * 0.015 + 1.8) * 8 +
    Math.cos(x * 0.04 + z * 0.03) * 3.5
  );
}

export class BattleTerrain {
  public mapData: MapData;
  public terrainMesh!: THREE.Mesh;
  public coverObstacles: { x: number; z: number; radius: number; height: number; type: string }[] = [];
  public propGroup: THREE.Group = new THREE.Group();
  public greenFlagGroup: THREE.Group = new THREE.Group();
  public redFlagGroup: THREE.Group = new THREE.Group();
  private baseGreenPos: { x: number; z: number; radius: number };
  private baseRedPos: { x: number; z: number; radius: number };

  constructor(mapData: MapData) {
    this.mapData = mapData;
    this.baseGreenPos = mapData.greenBase;
    this.baseRedPos = mapData.redBase;
  }

  // Exact elevation calculation at any world coordinate (x, z)
  getHeight(x: number, z: number): number {
    const halfSize = this.mapData.size * 0.5;
    const distFromCenter = Math.sqrt(x * x + z * z);
    
    // Natural perimeter mountain ridge bounds
    const edgeDist = Math.max(Math.abs(x), Math.abs(z));
    let edgeCliffs = 0;
    if (edgeDist > halfSize - 90) {
      const t = (edgeDist - (halfSize - 90)) / 90;
      edgeCliffs = Math.pow(t, 2) * 55;
    }

    // Flatten bases so tanks spawn and capture on stable ground
    const distGreen = Math.hypot(x - this.baseGreenPos.x, z - this.baseGreenPos.z);
    const distRed = Math.hypot(x - this.baseRedPos.x, z - this.baseRedPos.z);
    let baseFlatten = 1.0;
    if (distGreen < 75) {
      baseFlatten = Math.min(baseFlatten, Math.max(0, (distGreen - 35) / 40));
    }
    if (distRed < 75) {
      baseFlatten = Math.min(baseFlatten, Math.max(0, (distRed - 35) / 40));
    }

    // Biome-specific contour
    let rawHeight = 0;
    if (this.mapData.biome === 'valley') {
      // Central sunken valley with flanking hill plateaus
      const ridge = Math.sin(x * 0.01) * 14;
      const pass = Math.cos(z * 0.007) * 10;
      rawHeight = (pseudoNoise(x, z) + ridge + pass) * baseFlatten;
    } else if (this.mapData.biome === 'steppe') {
      // Rolling plains with long central ridge
      const centralRidge = Math.exp(-Math.pow(x * 0.006, 2)) * 12;
      rawHeight = (pseudoNoise(x * 0.7, z * 0.7) * 0.7 + centralRidge) * baseFlatten;
    } else {
      // Desert sand dunes
      const dunes = (Math.sin(x * 0.015 + z * 0.01) + Math.cos(x * 0.008 - z * 0.018)) * 12;
      rawHeight = (pseudoNoise(x, z) * 0.8 + dunes) * baseFlatten;
    }

    return rawHeight + edgeCliffs;
  }

  getNormal(x: number, z: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const eps = 0.8;
    const hL = this.getHeight(x - eps, z);
    const hR = this.getHeight(x + eps, z);
    const hD = this.getHeight(x, z - eps);
    const hU = this.getHeight(x, z + eps);

    out.set(hL - hR, 2 * eps, hD - hU).normalize();
    return out;
  }

  build(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const size = this.mapData.size;
    const segments = 128; // high-resolution terrain mesh
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const posAttr = geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      posAttr.setY(i, this.getHeight(x, z));
    }
    geometry.computeVertexNormals();

    // Procedural terrain texture
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Base color
    ctx.fillStyle = this.mapData.biome === 'desert' ? '#a58656' : '#465a38';
    ctx.fillRect(0, 0, 512, 512);

    // Fine mud, gravel and grass variations
    for (let i = 0; i < 4000; i++) {
      const rx = Math.random() * 512;
      const ry = Math.random() * 512;
      const rad = 2 + Math.random() * 8;
      ctx.fillStyle =
        this.mapData.biome === 'desert'
          ? Math.random() > 0.5 ? '#b8996b' : '#8c6f44'
          : Math.random() > 0.5 ? '#364929' : '#5d7348';
      ctx.beginPath();
      ctx.arc(rx, ry, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    const terrainTexture = new THREE.CanvasTexture(canvas);
    terrainTexture.wrapS = THREE.RepeatWrapping;
    terrainTexture.wrapT = THREE.RepeatWrapping;
    terrainTexture.repeat.set(32, 32);
    terrainTexture.colorSpace = THREE.SRGBColorSpace;
    terrainTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainTexture,
      roughness: 0.9,
      metalness: 0.05,
      flatShading: false,
    });

    this.terrainMesh = new THREE.Mesh(geometry, terrainMat);
    this.terrainMesh.receiveShadow = true;
    scene.add(this.terrainMesh);

    // Build Bases & Flags
    this.buildBaseRing(scene, this.baseGreenPos, 0x22c55e, true);
    this.buildBaseRing(scene, this.baseRedPos, 0xef4444, false);

    // Populate Cover & Scenery Props (Rocks, Ruins, Pine Trees)
    this.populateProps(scene);
  }

  private buildBaseRing(
    scene: THREE.Scene,
    base: { x: number; z: number; radius: number },
    colorHex: number,
    isGreen: boolean
  ) {
    const group = isGreen ? this.greenFlagGroup : this.redFlagGroup;
    group.position.set(base.x, this.getHeight(base.x, base.z), base.z);

    // 1. Glowing ground capture circle
    const ringGeo = new THREE.RingGeometry(base.radius - 1.2, base.radius + 0.8, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.2;
    group.add(ringMesh);

    // 2. Base capture soft fill disk
    const diskGeo = new THREE.CircleGeometry(base.radius - 1.2, 48);
    diskGeo.rotateX(-Math.PI / 2);
    const diskMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    const diskMesh = new THREE.Mesh(diskGeo, diskMat);
    diskMesh.position.y = 0.15;
    group.add(diskMesh);

    // 3. Central Flagpole
    const poleGeo = new THREE.CylinderGeometry(0.2, 0.3, 14, 12);
    poleGeo.translate(0, 7, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
    const poleMesh = new THREE.Mesh(poleGeo, poleMat);
    poleMesh.castShadow = true;
    group.add(poleMesh);

    // 4. Large Team Flag
    const flagGeo = new THREE.PlaneGeometry(5.0, 3.2, 12, 8);
    flagGeo.translate(2.5, 12, 0);
    const flagMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      roughness: 0.6,
    });
    const flagMesh = new THREE.Mesh(flagGeo, flagMat);
    flagMesh.name = 'teamFlag';
    group.add(flagMesh);

    // 5. Vertical Beacon Light Pillar
    const beaconGeo = new THREE.CylinderGeometry(1.2, 1.2, 80, 16, 1, true);
    beaconGeo.translate(0, 40, 0);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    group.add(beaconMesh);

    scene.add(group);
  }

  private populateProps(scene: THREE.Scene) {
    const countRocks = 45;
    const countTrees = 110;
    const countRuins = 12;

    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    const rockMat = new THREE.MeshStandardMaterial({
      color: this.mapData.biome === 'desert' ? 0x937852 : 0x5a5d5a,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: true,
    });

    // 1. Strategic Boulders / Rocks (Tank hull-down covers)
    for (let i = 0; i < countRocks; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 320;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      // Don't spawn on top of bases
      if (Math.hypot(x - this.baseGreenPos.x, z - this.baseGreenPos.z) < 55) continue;
      if (Math.hypot(x - this.baseRedPos.x, z - this.baseRedPos.z) < 55) continue;

      const y = this.getHeight(x, z);
      const scaleX = 4 + Math.random() * 5;
      const scaleY = 3 + Math.random() * 4;
      const scaleZ = 4 + Math.random() * 5;

      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(x, y + scaleY * 0.4, z);
      rock.scale.set(scaleX, scaleY, scaleZ);
      rock.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.4);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.propGroup.add(rock);

      this.coverObstacles.push({
        x,
        z,
        radius: Math.max(scaleX, scaleZ) * 0.8,
        height: scaleY,
        type: 'rock',
      });
    }

    // 2. Ruined Stone Structures / Bunkers
    const wallGeo = new THREE.BoxGeometry(10, 4, 1.8);
    const ruinMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.95,
      metalness: 0.05,
    });

    for (let i = 0; i < countRuins; i++) {
      // Concentrate ruins near center village area
      const rx = (Math.random() - 0.5) * 280;
      const rz = (Math.random() - 0.5) * 280;
      if (Math.hypot(rx, rz) < 30) continue;

      const ry = this.getHeight(rx, rz);
      const rot = Math.random() * Math.PI;

      const ruin = new THREE.Mesh(wallGeo, ruinMat);
      ruin.position.set(rx, ry + 2, rz);
      ruin.rotation.y = rot;
      ruin.castShadow = true;
      ruin.receiveShadow = true;
      this.propGroup.add(ruin);

      this.coverObstacles.push({
        x: rx,
        z: rz,
        radius: 5.5,
        height: 4,
        type: 'ruin',
      });
    }

    // 3. Composite 3-part Procedural Trees (Pine & Birch)
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.6, 5, 8);
    trunkGeo.translate(0, 2.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x422d1e, roughness: 0.9 });

    const foliageGeo1 = new THREE.ConeGeometry(3.5, 5, 7);
    foliageGeo1.translate(0, 5.5, 0);
    const foliageGeo2 = new THREE.ConeGeometry(2.5, 4, 7);
    foliageGeo2.translate(0, 8.5, 0);
    const foliageMat = new THREE.MeshStandardMaterial({
      color: this.mapData.biome === 'desert' ? 0x605634 : 0x224922,
      roughness: 0.85,
    });

    for (let i = 0; i < countTrees; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 380;
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;

      if (Math.hypot(tx - this.baseGreenPos.x, tz - this.baseGreenPos.z) < 50) continue;
      if (Math.hypot(tx - this.baseRedPos.x, tz - this.baseRedPos.z) < 50) continue;

      const ty = this.getHeight(tx, tz);
      const treeGroup = new THREE.Group();
      treeGroup.position.set(tx, ty, tz);

      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.castShadow = true;
      treeGroup.add(trunk);

      const f1 = new THREE.Mesh(foliageGeo1, foliageMat);
      f1.castShadow = true;
      treeGroup.add(f1);

      const f2 = new THREE.Mesh(foliageGeo2, foliageMat);
      f2.castShadow = true;
      treeGroup.add(f2);

      const scale = 0.8 + Math.random() * 0.5;
      treeGroup.scale.set(scale, scale, scale);
      treeGroup.rotation.y = Math.random() * Math.PI * 2;

      this.propGroup.add(treeGroup);

      this.coverObstacles.push({
        x: tx,
        z: tz,
        radius: 1.2,
        height: 8,
        type: 'tree',
      });
    }

    scene.add(this.propGroup);
  }

  update(delta: number) {
    // Wave the team flags in the wind
    const now = performance.now() * 0.003;
    const greenFlag = this.greenFlagGroup.getObjectByName('teamFlag') as THREE.Mesh;
    if (greenFlag) {
      greenFlag.rotation.y = Math.sin(now) * 0.15;
    }
    const redFlag = this.redFlagGroup.getObjectByName('teamFlag') as THREE.Mesh;
    if (redFlag) {
      redFlag.rotation.y = Math.sin(now + 1.5) * 0.15;
    }
  }

  dispose() {
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      if (Array.isArray(this.terrainMesh.material)) {
        this.terrainMesh.material.forEach((m) => m.dispose());
      } else {
        this.terrainMesh.material.dispose();
      }
    }
  }
}
