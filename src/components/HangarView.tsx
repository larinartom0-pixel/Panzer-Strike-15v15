/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TankDefinition, TankEquipment, MapData } from '../types.ts';
import { buildTank3D, TankMeshBundle } from '../game/proceduralModels.ts';
import { AVAILABLE_EQUIPMENT, BATTLE_MAPS } from '../game/tanksData.ts';
import {
  Shield,
  Zap,
  Gauge,
  Crosshair,
  Coins,
  Flame,
  Volume2,
  VolumeX,
  Smartphone,
  Tablet,
  Monitor,
  Maximize,
  Minimize,
  SlidersHorizontal,
  X,
  GitBranch,
  Lock,
  CheckCircle2,
  ArrowRight,
  RotateCw,
} from 'lucide-react';
import { soundEngine } from '../game/audio.ts';
import { detectDevice, tryRequestFullscreen, exitFullscreen } from '../utils/device.ts';

interface HangarViewProps {
  tanks: TankDefinition[];
  selectedTank: TankDefinition;
  onSelectTank: (tank: TankDefinition) => void;
  onUpdateTank: (tank: TankDefinition) => void;
  playerCredits: number;
  playerXP: number;
  onSpendCurrency: (credits: number, xp: number) => boolean;
  selectedMap: MapData;
  onSelectMap: (map: MapData) => void;
  onStartBattle: () => void;
  playerStats: { battles: number; victories: number; totalDamage: number; totalKills: number };
}

const CLASS_LABEL_UK: Record<TankDefinition['tankClass'], string> = {
  light: 'ЛТ',
  medium: 'СТ',
  heavy: 'ВТ',
  destroyer: 'ПТ',
};

export const HangarView: React.FC<HangarViewProps> = ({
  tanks,
  selectedTank,
  onSelectTank,
  onUpdateTank,
  playerCredits,
  playerXP,
  onSpendCurrency,
  selectedMap,
  onSelectMap,
  onStartBattle,
  playerStats,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hangarMode, setHangarMode] = useState<'garage' | 'techtree'>('garage');
  const [activeTab, setActiveTab] = useState<'modules' | 'ammo' | 'equipment' | 'specs'>('modules');
  const [isMuted, setIsMuted] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(detectDevice());
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [isUpgradePanelOpen, setIsUpgradePanelOpen] = useState(!detectDevice().isMobile);

  // Interactive 3D Hangar Orbit Camera refs
  const orbitYawRef = useRef(0.55);
  const orbitPitchRef = useRef(0.28);
  const orbitDistRef = useRef(12.2);
  const isDraggingRef = useRef(false);
  const lastDragPosRef = useRef({ x: 0, y: 0 });
  const autoSpinRef = useRef(true);

  useEffect(() => {
    const handleResize = () => {
      setDeviceInfo(detectDevice());
    };
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // 3D Hangar Scene references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const tankMeshRef = useRef<TankMeshBundle | null>(null);
  const animFrameRef = useRef<number>(0);

  // Initialize 3D Hangar
  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16181c);
    scene.fog = new THREE.FogExp2(0x16181c, 0.022);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.8);
    keyLight.position.set(8, 14, 10);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x90b0e0, 1.2);
    fillLight.position.set(-10, 6, -8);
    scene.add(fillLight);

    const hemiLight = new THREE.HemisphereLight(0x506575, 0x1f2428, 1.0);
    scene.add(hemiLight);

    const floorGeo = new THREE.PlaneGeometry(60, 60);
    floorGeo.rotateX(-Math.PI / 2);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#202328';
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = '#2d333b';
    ctx.lineWidth = 3;
    for (let i = 0; i < 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(256, 256, 180, 0, Math.PI * 2);
    ctx.stroke();

    const floorTex = new THREE.CanvasTexture(canvas);
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(4, 4);
    floorTex.colorSpace = THREE.SRGBColorSpace;

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.45,
      metalness: 0.35,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.receiveShadow = !isSoftwareGl;
    scene.add(floorMesh);

    const pedestalGeo = new THREE.CylinderGeometry(4.8, 5.0, 0.2, 32);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: 0x2b3038,
      roughness: 0.5,
      metalness: 0.5,
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.y = 0.1;
    pedestal.receiveShadow = true;
    scene.add(pedestal);

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);

      if (autoSpinRef.current && !isDraggingRef.current) {
        orbitYawRef.current += 0.0025;
      }

      const yaw = orbitYawRef.current;
      const pitch = orbitPitchRef.current;
      const dist = orbitDistRef.current;

      camera.position.set(
        Math.sin(yaw) * Math.cos(pitch) * dist,
        Math.sin(pitch) * dist + 1.3,
        Math.cos(yaw) * Math.cos(pitch) * dist
      );
      camera.lookAt(0, 1.35, 0);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animFrameRef.current);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Update 3D Tank Mesh whenever selectedTank or installed modules change
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    if (tankMeshRef.current) {
      scene.remove(tankMeshRef.current.rootGroup);
    }

    const bundle = buildTank3D(selectedTank, 'green', true);
    bundle.rootGroup.position.set(0, 0.2, 0);
    scene.add(bundle.rootGroup);
    tankMeshRef.current = bundle;
  }, [selectedTank]);

  // Drag orbit handlers on Hangar canvas
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (hangarMode !== 'garage') return;
    isDraggingRef.current = true;
    autoSpinRef.current = false;
    lastDragPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastDragPosRef.current.x;
    const dy = e.clientY - lastDragPosRef.current.y;
    lastDragPosRef.current = { x: e.clientX, y: e.clientY };

    orbitYawRef.current -= dx * 0.008;
    orbitPitchRef.current = THREE.MathUtils.clamp(
      orbitPitchRef.current + dy * 0.006,
      0.06,
      0.85
    );
  };

  const handleCanvasPointerUp = () => {
    isDraggingRef.current = false;
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (hangarMode !== 'garage') return;
    orbitDistRef.current = THREE.MathUtils.clamp(orbitDistRef.current + e.deltaY * 0.01, 7.5, 19);
  };

  // Derived current stats for selected tank
  const currentGun =
    selectedTank.guns.find((g) => g.id === selectedTank.installedGunId) || selectedTank.guns[0];
  const currentTurret =
    selectedTank.turrets.find((t) => t.id === selectedTank.installedTurretId) ||
    selectedTank.turrets[0];
  const currentEngine =
    selectedTank.engines.find((e) => e.id === selectedTank.installedEngineId) ||
    selectedTank.engines[0];
  const currentSuspension =
    selectedTank.suspensions.find((s) => s.id === selectedTank.installedSuspensionId) ||
    selectedTank.suspensions[0];

  const handleInstallGun = (gunId: string) => {
    onUpdateTank({ ...selectedTank, installedGunId: gunId });
    soundEngine.playReloadFinish();
  };

  const handleUnlockGun = (gun: (typeof selectedTank.guns)[0]) => {
    if (playerXP < gun.costXP || playerCredits < gun.costCredits) return;
    if (onSpendCurrency(gun.costCredits, gun.costXP)) {
      const updatedGuns = selectedTank.guns.map((g) =>
        g.id === gun.id ? { ...g, unlocked: true } : g
      );
      onUpdateTank({ ...selectedTank, guns: updatedGuns, installedGunId: gun.id });
      soundEngine.playReloadFinish();
    }
  };

  const handleInstallTurret = (turretId: string) => {
    onUpdateTank({ ...selectedTank, installedTurretId: turretId });
  };

  const handleUnlockTurret = (turret: (typeof selectedTank.turrets)[0]) => {
    if (playerXP < turret.costXP || playerCredits < turret.costCredits) return;
    if (onSpendCurrency(turret.costCredits, turret.costXP)) {
      const updatedTurrets = selectedTank.turrets.map((t) =>
        t.id === turret.id ? { ...t, unlocked: true } : t
      );
      onUpdateTank({ ...selectedTank, turrets: updatedTurrets, installedTurretId: turret.id });
    }
  };

  const handleInstallEngine = (engineId: string) => {
    onUpdateTank({ ...selectedTank, installedEngineId: engineId });
  };

  const handleUnlockEngine = (eng: (typeof selectedTank.engines)[0]) => {
    if (playerXP < eng.costXP || playerCredits < eng.costCredits) return;
    if (onSpendCurrency(eng.costCredits, eng.costXP)) {
      const updatedEngines = selectedTank.engines.map((e) =>
        e.id === eng.id ? { ...e, unlocked: true } : e
      );
      onUpdateTank({ ...selectedTank, engines: updatedEngines, installedEngineId: eng.id });
    }
  };

  const handleToggleEquipment = (eq: TankEquipment) => {
    const hasGear = selectedTank.equippedGear.includes(eq.id);
    let newGear: string[];
    if (hasGear) {
      newGear = selectedTank.equippedGear.filter((id) => id !== eq.id);
    } else {
      if (selectedTank.equippedGear.length >= 3) return;
      if (playerCredits < eq.costCredits) return;
      if (onSpendCurrency(eq.costCredits, 0)) {
        newGear = [...selectedTank.equippedGear, eq.id];
      } else {
        return;
      }
    }
    onUpdateTank({ ...selectedTank, equippedGear: newGear });
  };

  // Step 1 in WoT: Research Tank with XP
  const handleResearchTank = (tank: TankDefinition) => {
    if (tank.researched) return;
    if (tank.requiredTankId) {
      const prereq = tanks.find((t) => t.id === tank.requiredTankId);
      if (prereq && !prereq.researched && !prereq.unlocked) return;
    }
    if (playerXP < tank.priceXP) return;
    if (onSpendCurrency(0, tank.priceXP)) {
      const updated = { ...tank, researched: true };
      onUpdateTank(updated);
      onSelectTank(updated);
      soundEngine.playReloadFinish();
    }
  };

  // Step 2 in WoT: Purchase Researched Tank with Silver Credits
  const handleBuyTank = (tank: TankDefinition) => {
    if (!tank.researched || tank.unlocked) return;
    if (playerCredits < tank.priceCredits) return;
    if (onSpendCurrency(tank.priceCredits, 0)) {
      const updated = { ...tank, unlocked: true };
      onUpdateTank(updated);
      onSelectTank(updated);
      soundEngine.playRadioCue('penetration');
    }
  };

  const winRate =
    playerStats.battles > 0
      ? Math.round((playerStats.victories / playerStats.battles) * 100)
      : 0;

  // Derived TTX stats
  const specificPower = (currentEngine.horsepower / selectedTank.weightTons).toFixed(1);
  const dpm = Math.round((60 / currentGun.reloadTime) * currentGun.damageAP);

  const prerequisiteTank = selectedTank.requiredTankId
    ? tanks.find((t) => t.id === selectedTank.requiredTankId)
    : undefined;
  const isPrerequisiteMet =
    !prerequisiteTank || Boolean(prerequisiteTank.researched || prerequisiteTank.unlocked);

  return (
    <div className="relative w-full h-screen overflow-hidden select-none bg-neutral-950 font-sans text-white">
      {/* 3D Hangar Interactive Canvas Viewport */}
      <div
        ref={mountRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerUp}
        onWheel={handleCanvasWheel}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* 1. TOP BAR */}
      <div className="absolute top-0 left-0 right-0 px-3 sm:px-5 py-2.5 flex flex-wrap justify-between items-center bg-gradient-to-b from-neutral-950/95 via-neutral-950/75 to-transparent pointer-events-auto gap-2 z-30">
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
            <span className="font-black text-xs sm:text-sm tracking-wider text-amber-400 uppercase">
              PANZER STRIKE 15v15
            </span>
          </div>

          {/* Main WoT Mode Switcher: ГАРАЖ vs ДЕРЕВО ДОСЛІДЖЕНЬ */}
          <div className="flex items-center bg-neutral-900 border border-neutral-700 rounded-lg p-0.5">
            <button
              onClick={() => setHangarMode('garage')}
              className={`px-2.5 sm:px-3.5 py-1 rounded-md text-[11px] sm:text-xs font-black tracking-wide uppercase cursor-pointer transition-colors ${
                hangarMode === 'garage'
                  ? 'bg-amber-500 text-neutral-950'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Ангар
            </button>
            <button
              onClick={() => setHangarMode('techtree')}
              className={`px-2.5 sm:px-3.5 py-1 rounded-md text-[11px] sm:text-xs font-black tracking-wide uppercase cursor-pointer transition-colors flex items-center gap-1.5 ${
                hangarMode === 'techtree'
                  ? 'bg-amber-500 text-neutral-950'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              Дослідження
            </button>
          </div>

          {/* Device indicator (clean typographic separator, no pill enclosure) */}
          <div className="hidden md:flex items-center gap-1.5 text-xs text-neutral-400">
            {deviceInfo.isMobile ? (
              <Smartphone className="w-3.5 h-3.5 text-amber-400" />
            ) : deviceInfo.isTablet ? (
              <Tablet className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Monitor className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>{deviceInfo.labelUk}</span>
            <span className="text-neutral-600 mx-1">·</span>
            <span>
              Боїв: <strong className="text-white font-mono tabular-nums">{playerStats.battles}</strong>
            </span>
            <span className="text-neutral-600 mx-1">·</span>
            <span>
              Перемог: <strong className="text-emerald-400 font-mono tabular-nums">{winRate}%</strong>
            </span>
          </div>
        </div>

        {/* Currency & Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-700 px-2.5 py-1 rounded-lg">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-mono font-black text-xs sm:text-sm text-amber-300 tabular-nums">
              {playerCredits.toLocaleString()}
            </span>
            <span className="text-[10px] text-neutral-400 uppercase hidden sm:inline">Срібло</span>
          </div>

          <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-700 px-2.5 py-1 rounded-lg">
            <Zap className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-mono font-black text-xs sm:text-sm text-sky-300 tabular-nums">
              {playerXP.toLocaleString()}
            </span>
            <span className="text-[10px] text-neutral-400 uppercase hidden sm:inline">Досвід</span>
          </div>

          <button
            onClick={() => {
              if (document.fullscreenElement) exitFullscreen();
              else tryRequestFullscreen();
            }}
            className="p-1.5 bg-neutral-900 border border-neutral-700 hover:bg-neutral-800 text-neutral-300 rounded-lg cursor-pointer"
            title="Повний екран"
          >
            {isFullscreen ? <Minimize className="w-4 h-4 text-amber-400" /> : <Maximize className="w-4 h-4" />}
          </button>

          <button
            onClick={() => {
              const muted = soundEngine.toggleMute();
              setIsMuted(muted);
            }}
            className="p-1.5 bg-neutral-900 border border-neutral-700 hover:bg-neutral-800 text-neutral-300 rounded-lg cursor-pointer"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>
        </div>
      </div>

      {/* 2. TOP-CENTER "В БІЙ!" LAUNCH DOCK */}
      <div className="absolute top-14 sm:top-16 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-auto z-20">
        <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-xl p-1 shadow-2xl">
          <div className="flex items-center gap-1.5 px-2 sm:px-3">
            <span className="text-[10px] sm:text-xs text-neutral-400">Карта:</span>
            <select
              value={selectedMap.id}
              onChange={(e) => {
                const map = BATTLE_MAPS.find((m) => m.id === e.target.value);
                if (map) onSelectMap(map);
              }}
              className="bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 text-[11px] sm:text-xs font-bold text-amber-300 cursor-pointer focus:outline-none"
            >
              {BATTLE_MAPS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nameUk}
                </option>
              ))}
            </select>
          </div>

          {selectedTank.unlocked ? (
            <button
              onClick={() => {
                tryRequestFullscreen();
                onStartBattle();
              }}
              className="px-5 sm:px-8 py-2 sm:py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-black text-sm sm:text-base tracking-wider uppercase cursor-pointer shadow-[0_0_20px_rgba(245,158,11,0.35)] transition-all flex items-center gap-1.5"
            >
              <Flame className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-950 fill-neutral-950" />
              В БІЙ! (15v15)
            </button>
          ) : !selectedTank.researched ? (
            <button
              onClick={() => handleResearchTank(selectedTank)}
              disabled={!isPrerequisiteMet || playerXP < selectedTank.priceXP}
              className={`px-4 sm:px-6 py-2 rounded-lg font-black text-xs sm:text-sm uppercase cursor-pointer flex items-center gap-1.5 ${
                isPrerequisiteMet && playerXP >= selectedTank.priceXP
                  ? 'bg-sky-600 hover:bg-sky-500 text-white'
                  : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
              }`}
            >
              <Zap className="w-4 h-4" />
              {isPrerequisiteMet
                ? `Дослідити (${selectedTank.priceXP.toLocaleString()} XP)`
                : `Потрібен ${prerequisiteTank?.name}`}
            </button>
          ) : (
            <button
              onClick={() => handleBuyTank(selectedTank)}
              disabled={playerCredits < selectedTank.priceCredits}
              className={`px-4 sm:px-6 py-2 rounded-lg font-black text-xs sm:text-sm uppercase cursor-pointer flex items-center gap-1.5 ${
                playerCredits >= selectedTank.priceCredits
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
              }`}
            >
              <Coins className="w-4 h-4" />
              Придбати ({selectedTank.priceCredits.toLocaleString()} ср.)
            </button>
          )}
        </div>

        {hangarMode === 'garage' && (
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-neutral-400">
            <RotateCw className="w-3 h-3 text-amber-400" />
            <span>Тягніть мишею або пальцем для огляду 3D-броні</span>
          </div>
        )}
      </div>

      {/* GARAGE MODE PANELS */}
      {hangarMode === 'garage' && (
        <>
          {/* Mobile Toggle Button for Upgrades */}
          <button
            onClick={() => setIsUpgradePanelOpen((v) => !v)}
            className="md:hidden absolute top-28 right-3 z-30 bg-amber-500 active:bg-amber-400 text-neutral-950 font-black px-3 py-1.5 rounded-xl shadow-2xl flex items-center gap-1.5 text-xs pointer-events-auto border border-amber-300"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>{isUpgradePanelOpen ? 'Сховати' : 'Модулі / ТТХ'}</span>
          </button>

          {/* LEFT COMPACT TTX SUMMARY (Desktop) */}
          <div className="hidden lg:flex absolute top-24 left-6 w-64 bg-neutral-900/95 border border-neutral-800 rounded-xl p-3.5 flex-col gap-2.5 pointer-events-auto z-20">
            <div className="flex justify-between items-center border-b border-neutral-800 pb-2">
              <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                Бойові ТТХ
              </span>
              <span className="text-[11px] font-mono font-bold text-amber-400">
                {CLASS_LABEL_UK[selectedTank.tankClass]} · Рів. {selectedTank.tier}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div className="text-neutral-400">Урон / хв</div>
              <div className="text-right font-mono font-bold text-rose-400 tabular-nums">{dpm}</div>

              <div className="text-neutral-400">Пробиття ББ</div>
              <div className="text-right font-mono font-bold text-amber-300 tabular-nums">
                {currentGun.penetrationAP} мм
              </div>

              <div className="text-neutral-400">Перезарядка</div>
              <div className="text-right font-mono font-bold text-white tabular-nums">
                {currentGun.reloadTime} с
              </div>

              <div className="text-neutral-400">Кути (УВН)</div>
              <div className="text-right font-mono font-bold text-emerald-400 tabular-nums">
                -{selectedTank.gunDepressionDeg}° / +{selectedTank.gunElevationDeg}°
              </div>

              <div className="text-neutral-400">Потужність</div>
              <div className="text-right font-mono font-bold text-sky-300 tabular-nums">
                {specificPower} к.с./т
              </div>

              <div className="text-neutral-400">Макс. швидк.</div>
              <div className="text-right font-mono font-bold text-white tabular-nums">
                {currentEngine.topSpeed} км/г
              </div>
            </div>

            <div className="border-t border-neutral-800 pt-2">
              <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1">
                Зони бронювання (мм)
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                <div className="text-neutral-400">ВЛД: <strong className="text-white">{selectedTank.armorHullFront}</strong></div>
                <div className="text-neutral-400">НЛД: <strong className="text-rose-300">{selectedTank.armorHullLowerGlacis}</strong></div>
                <div className="text-neutral-400">Вежа: <strong className="text-blue-300">{currentTurret.armorFront}</strong></div>
                <div className="text-neutral-400">Маска: <strong className="text-emerald-300">{selectedTank.armorTurretMantlet}</strong></div>
                <div className="text-neutral-400">Борт: <strong className="text-white">{selectedTank.armorHullSides}</strong></div>
                <div className="text-neutral-400">Лючок: <strong className="text-amber-300">{selectedTank.armorCupola}</strong></div>
              </div>
            </div>
          </div>

          {/* 3. RIGHT PANEL: TANK UPGRADES & MODIFICATIONS */}
          {isUpgradePanelOpen && (
            <div className="absolute top-28 md:top-20 right-2 md:right-6 w-[calc(100vw-1rem)] md:w-96 max-h-[calc(100vh-210px)] bg-neutral-900/95 border border-neutral-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto z-30">
              <div className="p-3 sm:p-4 border-b border-neutral-800 flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-bold">
                    <span className="text-amber-400">Рівень {selectedTank.tier}</span>
                    <span className="text-neutral-600">·</span>
                    <span className="uppercase text-neutral-400">
                      {selectedTank.tankClass === 'medium'
                        ? 'Середній Танк'
                        : selectedTank.tankClass === 'heavy'
                        ? 'Важкий Танк'
                        : selectedTank.tankClass === 'destroyer'
                        ? 'ПТ-САУ'
                        : 'Легкий Танк'}
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-black text-white mt-0.5">
                    {selectedTank.name}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <span className="text-[10px] text-neutral-400">Міцність</span>
                    <div className="text-base sm:text-lg font-bold font-mono text-emerald-400 tabular-nums">
                      {currentTurret.hpBonus} HP
                    </div>
                  </div>
                  <button
                    onClick={() => setIsUpgradePanelOpen(false)}
                    className="md:hidden p-1 text-neutral-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Tab Selection */}
              <div className="grid grid-cols-4 border-b border-neutral-800 bg-neutral-950 text-[11px] font-bold">
                {(
                  [
                    ['modules', 'Модулі'],
                    ['ammo', 'Снаряди'],
                    ['equipment', 'Обладн.'],
                    ['specs', 'Броня'],
                  ] as const
                ).map(([tabId, label]) => (
                  <button
                    key={tabId}
                    onClick={() => setActiveTab(tabId)}
                    className={`py-2.5 cursor-pointer text-center border-b-2 transition-colors ${
                      activeTab === tabId
                        ? 'border-amber-500 text-amber-400'
                        : 'border-transparent text-neutral-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-4 text-xs">
                {activeTab === 'modules' && (
                  <>
                    {/* Guns */}
                    <div className="flex flex-col gap-2">
                      <span className="font-bold text-neutral-400 flex items-center gap-1.5">
                        <Crosshair className="w-3.5 h-3.5 text-amber-400" />
                        Гармати
                      </span>
                      {selectedTank.guns.map((gun) => {
                        const isInstalled = selectedTank.installedGunId === gun.id;
                        return (
                          <div
                            key={gun.id}
                            className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
                              isInstalled
                                ? 'bg-amber-950/30 border-amber-500/80'
                                : 'bg-neutral-800/60 border-neutral-700/60'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-white">{gun.name}</span>
                              {isInstalled && (
                                <span className="text-[10px] text-amber-400 font-black uppercase">
                                  Встановлено
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-3 gap-1 text-[11px] text-neutral-300 font-mono">
                              <div>
                                Проб.: <strong className="text-amber-300">{gun.penetrationAP}</strong>мм
                              </div>
                              <div>
                                Шкода: <strong className="text-rose-400">{gun.damageAP}</strong>
                              </div>
                              <div>
                                КД: <strong className="text-sky-400">{gun.reloadTime}</strong>с
                              </div>
                            </div>

                            {!isInstalled && selectedTank.unlocked && (
                              <div className="pt-1 flex justify-end">
                                {gun.unlocked ? (
                                  <button
                                    onClick={() => handleInstallGun(gun.id)}
                                    className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-neutral-950 font-bold rounded text-xs cursor-pointer"
                                  >
                                    Встановити
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleUnlockGun(gun)}
                                    disabled={playerXP < gun.costXP || playerCredits < gun.costCredits}
                                    className={`px-3 py-1 font-bold rounded text-xs cursor-pointer flex items-center gap-1.5 ${
                                      playerXP >= gun.costXP && playerCredits >= gun.costCredits
                                        ? 'bg-sky-600 hover:bg-sky-500 text-white'
                                        : 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                                    }`}
                                  >
                                    <span>Дослідити: {gun.costXP} XP + {gun.costCredits} ср.</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Turrets */}
                    <div className="flex flex-col gap-2">
                      <span className="font-bold text-neutral-400 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-blue-400" />
                        Вежі
                      </span>
                      {selectedTank.turrets.map((turret) => {
                        const isInstalled = selectedTank.installedTurretId === turret.id;
                        return (
                          <div
                            key={turret.id}
                            className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
                              isInstalled
                                ? 'bg-blue-950/30 border-blue-500/80'
                                : 'bg-neutral-800/60 border-neutral-700/60'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-white">{turret.name}</span>
                              {isInstalled && (
                                <span className="text-[10px] text-blue-400 font-black uppercase">
                                  Встановлено
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-3 gap-1 text-[11px] text-neutral-300 font-mono">
                              <div>
                                Броня: <strong className="text-blue-300">{turret.armorFront}</strong>мм
                              </div>
                              <div>
                                HP: <strong className="text-emerald-400">{turret.hpBonus}</strong>
                              </div>
                              <div>
                                Огляд: <strong className="text-sky-300">{turret.viewRange}</strong>м
                              </div>
                            </div>

                            {!isInstalled && selectedTank.unlocked && (
                              <div className="pt-1 flex justify-end">
                                {turret.unlocked ? (
                                  <button
                                    onClick={() => handleInstallTurret(turret.id)}
                                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-xs cursor-pointer"
                                  >
                                    Встановити
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleUnlockTurret(turret)}
                                    disabled={
                                      playerXP < turret.costXP || playerCredits < turret.costCredits
                                    }
                                    className={`px-3 py-1 font-bold rounded text-xs cursor-pointer ${
                                      playerXP >= turret.costXP && playerCredits >= turret.costCredits
                                        ? 'bg-sky-600 hover:bg-sky-500 text-white'
                                        : 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                                    }`}
                                  >
                                    Дослідити ({turret.costXP} XP + {turret.costCredits} ср.)
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Engines */}
                    <div className="flex flex-col gap-2">
                      <span className="font-bold text-neutral-400 flex items-center gap-1.5">
                        <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                        Двигуни
                      </span>
                      {selectedTank.engines.map((eng) => {
                        const isInstalled = selectedTank.installedEngineId === eng.id;
                        return (
                          <div
                            key={eng.id}
                            className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
                              isInstalled
                                ? 'bg-emerald-950/30 border-emerald-500/80'
                                : 'bg-neutral-800/60 border-neutral-700/60'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-white">{eng.name}</span>
                              {isInstalled && (
                                <span className="text-[10px] text-emerald-400 font-black uppercase">
                                  Встановлено
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-1 text-[11px] text-neutral-300 font-mono">
                              <div>
                                Швидк.: <strong className="text-white">{eng.topSpeed}</strong> км/г
                              </div>
                              <div>
                                Потужн.: <strong className="text-emerald-300">{eng.horsepower}</strong> к.с.
                              </div>
                            </div>

                            {!isInstalled && selectedTank.unlocked && (
                              <div className="pt-1 flex justify-end">
                                {eng.unlocked ? (
                                  <button
                                    onClick={() => handleInstallEngine(eng.id)}
                                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs cursor-pointer"
                                  >
                                    Встановити
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleUnlockEngine(eng)}
                                    disabled={
                                      playerXP < eng.costXP || playerCredits < eng.costCredits
                                    }
                                    className={`px-3 py-1 font-bold rounded text-xs cursor-pointer ${
                                      playerXP >= eng.costXP && playerCredits >= eng.costCredits
                                        ? 'bg-sky-600 hover:bg-sky-500 text-white'
                                        : 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                                    }`}
                                  >
                                    Дослідити ({eng.costXP} XP + {eng.costCredits} ср.)
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {activeTab === 'ammo' && (
                  <div className="flex flex-col gap-4">
                    <span className="text-neutral-400">
                      Налаштуйте боєкомплект перед боєм:
                    </span>

                    <div className="bg-neutral-800/80 border border-neutral-700 p-3 rounded-xl flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-amber-300">Бронебійні (AP)</span>
                        <span className="font-mono font-bold text-white tabular-nums">
                          {selectedTank.shellLoadout.AP} шт.
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="60"
                        value={selectedTank.shellLoadout.AP}
                        onChange={(e) => {
                          onUpdateTank({
                            ...selectedTank,
                            shellLoadout: {
                              ...selectedTank.shellLoadout,
                              AP: parseInt(e.target.value),
                            },
                          });
                        }}
                        className="accent-amber-500 cursor-pointer"
                      />
                    </div>

                    <div className="bg-neutral-800/80 border border-neutral-700 p-3 rounded-xl flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-sky-300">Підкаліберні (APCR)</span>
                        <span className="font-mono font-bold text-white tabular-nums">
                          {selectedTank.shellLoadout.APCR} шт.
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="40"
                        value={selectedTank.shellLoadout.APCR}
                        onChange={(e) => {
                          onUpdateTank({
                            ...selectedTank,
                            shellLoadout: {
                              ...selectedTank.shellLoadout,
                              APCR: parseInt(e.target.value),
                            },
                          });
                        }}
                        className="accent-sky-500 cursor-pointer"
                      />
                    </div>

                    <div className="bg-neutral-800/80 border border-neutral-700 p-3 rounded-xl flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-rose-300">Фугасні (HE)</span>
                        <span className="font-mono font-bold text-white tabular-nums">
                          {selectedTank.shellLoadout.HE} шт.
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="30"
                        value={selectedTank.shellLoadout.HE}
                        onChange={(e) => {
                          onUpdateTank({
                            ...selectedTank,
                            shellLoadout: {
                              ...selectedTank.shellLoadout,
                              HE: parseInt(e.target.value),
                            },
                          });
                        }}
                        className="accent-rose-500 cursor-pointer"
                      />
                    </div>
                  </div>
                )}

                {activeTab === 'equipment' && (
                  <div className="flex flex-col gap-3">
                    <span className="text-neutral-400">
                      Додаткове обладнання ({selectedTank.equippedGear.length}/3 слотів):
                    </span>

                    {AVAILABLE_EQUIPMENT.map((eq) => {
                      const isEquipped = selectedTank.equippedGear.includes(eq.id);
                      return (
                        <div
                          key={eq.id}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                            isEquipped
                              ? 'bg-amber-950/40 border-amber-500'
                              : 'bg-neutral-800/70 border-neutral-700'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">{eq.icon}</span>
                            <div>
                              <div className="font-bold text-white">{eq.name}</div>
                              <div className="text-[11px] text-neutral-400">{eq.description}</div>
                            </div>
                          </div>

                          <button
                            onClick={() => handleToggleEquipment(eq)}
                            className={`px-3 py-1.5 rounded text-xs font-bold cursor-pointer transition-colors ${
                              isEquipped
                                ? 'bg-rose-900/80 hover:bg-rose-800 text-rose-200 border border-rose-700'
                                : 'bg-amber-600 hover:bg-amber-500 text-neutral-950'
                            }`}
                          >
                            {isEquipped ? 'Зняти' : `${eq.costCredits.toLocaleString()} ср.`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {activeTab === 'specs' && (
                  <div className="flex flex-col gap-3">
                    <p className="text-neutral-300 leading-relaxed">{selectedTank.description}</p>

                    <div className="bg-neutral-800/70 border border-neutral-700 rounded-xl p-3 flex flex-col gap-2">
                      <div className="font-bold text-amber-400 uppercase text-[11px]">
                        Схема бронювання
                      </div>
                      <div className="grid grid-cols-2 gap-y-1.5 text-[11px] font-mono">
                        <span className="text-neutral-400">ВЛД (лоб корпус):</span>
                        <span className="text-right text-white font-bold">{selectedTank.armorHullFront} мм</span>
                        <span className="text-neutral-400">НЛД (нижній лист):</span>
                        <span className="text-right text-rose-300 font-bold">{selectedTank.armorHullLowerGlacis} мм</span>
                        <span className="text-neutral-400">Борт / Корма:</span>
                        <span className="text-right text-white font-bold">{selectedTank.armorHullSides} / {selectedTank.armorHullRear} мм</span>
                        <span className="text-neutral-400">Маска гармати:</span>
                        <span className="text-right text-emerald-300 font-bold">{selectedTank.armorTurretMantlet} мм</span>
                        <span className="text-neutral-400">Лоб / Борт вежі:</span>
                        <span className="text-right text-blue-300 font-bold">{currentTurret.armorFront} / {currentTurret.armorSides} мм</span>
                        <span className="text-neutral-400">Лючок командира:</span>
                        <span className="text-right text-amber-300 font-bold">{selectedTank.armorCupola} мм</span>
                      </div>
                    </div>

                    <div className="bg-neutral-800/70 border border-neutral-700 rounded-xl p-3 flex flex-col gap-1.5 text-[11px] font-mono">
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Кути верт. наведення (УВН):</span>
                        <span className="text-emerald-400 font-bold">
                          -{selectedTank.gunDepressionDeg}° / +{selectedTank.gunElevationDeg}°
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Маса / Питома потужність:</span>
                        <span className="text-white font-bold">
                          {selectedTank.weightTons} т · {specificPower} к.с./т
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Швидкість повороту шасі:</span>
                        <span className="text-white font-bold">{currentSuspension.traverseSpeed}°/с</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. BOTTOM TANK CAROUSEL DOCK */}
          <div className="absolute bottom-2 sm:bottom-4 left-2 right-2 sm:left-6 sm:right-6 flex items-center justify-center pointer-events-auto z-20">
            <div className="bg-neutral-900/95 border border-neutral-700/80 rounded-2xl p-1.5 sm:p-2.5 shadow-2xl flex items-center gap-2 sm:gap-3 max-w-6xl overflow-x-auto w-full sm:w-auto">
              {tanks.map((tank) => {
                const isSelected = selectedTank.id === tank.id;
                return (
                  <div
                    key={tank.id}
                    onClick={() => onSelectTank(tank)}
                    className={`relative px-3.5 py-2 rounded-xl border flex flex-col gap-1 min-w-[168px] cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-amber-500/20 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                        : tank.unlocked
                        ? 'bg-neutral-800/80 border-neutral-700 hover:border-neutral-500'
                        : 'bg-neutral-950/85 border-neutral-800 opacity-85 hover:opacity-100'
                    }`}
                  >
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-bold text-amber-400">Рівень {tank.tier}</span>
                      <span className="text-neutral-400 uppercase font-mono">
                        {CLASS_LABEL_UK[tank.tankClass]} · {tank.nation}
                      </span>
                    </div>

                    <span className="font-black text-xs text-white truncate">{tank.name}</span>

                    {tank.unlocked ? (
                      <div className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        В ангарі
                      </div>
                    ) : tank.researched ? (
                      <div className="text-[10px] text-amber-300 font-bold flex items-center gap-1">
                        <Coins className="w-3 h-3" />
                        {tank.priceCredits.toLocaleString()} ср.
                      </div>
                    ) : (
                      <div className="text-[10px] text-sky-400 font-bold flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        {tank.priceXP.toLocaleString()} XP
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* 5. WORLD OF TANKS STYLE TECH TREE VIEW (ДЕРЕВО ДОСЛІДЖЕНЬ) */}
      {hangarMode === 'techtree' && (
        <div className="absolute inset-0 top-24 sm:top-28 bottom-0 bg-neutral-950/92 z-20 overflow-y-auto p-4 sm:p-8 pointer-events-auto">
          <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-10">
            <div className="flex flex-wrap justify-between items-end border-b border-neutral-800 pb-4 gap-3">
              <div>
                <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wide text-amber-400">
                  Дерево Досліджень Техніки
                </h1>
                <p className="text-xs sm:text-sm text-neutral-400 mt-1">
                  Крок 1: Дослідіть машину за бойовий досвід (XP) · Крок 2: Придбайте за срібло у свій ангар
                </p>
              </div>
              <button
                onClick={() => setHangarMode('garage')}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 rounded-lg text-xs font-bold cursor-pointer"
              >
                Повернутись в Ангар
              </button>
            </div>

            {/* Branch 1: Східний Блок (UA) */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 sm:p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <span className="text-sm font-black uppercase tracking-wider text-emerald-400">
                  Гілка Східного Блоку (UA)
                </span>
                <span className="text-xs text-neutral-400 font-mono">Рівні V → VIII</span>
              </div>

              <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 overflow-x-auto pb-2">
                {(['kv1_heavy', 't34_85', 'su100_destroyer', 'is3_heavy'] as const).map(
                  (tankId, idx) => {
                    const tank = tanks.find((t) => t.id === tankId);
                    if (!tank) return null;
                    return (
                      <React.Fragment key={tank.id}>
                        {idx > 0 && (
                          <ArrowRight className="hidden lg:block w-5 h-5 text-neutral-600 flex-shrink-0" />
                        )}
                        <TechTreeCard
                          tank={tank}
                          allTanks={tanks}
                          isSelected={selectedTank.id === tank.id}
                          playerXP={playerXP}
                          playerCredits={playerCredits}
                          onInspect={() => {
                            onSelectTank(tank);
                            setHangarMode('garage');
                          }}
                          onResearch={() => handleResearchTank(tank)}
                          onBuy={() => handleBuyTank(tank)}
                        />
                      </React.Fragment>
                    );
                  }
                )}
              </div>
            </div>

            {/* Branch 2: Союзники та Континент */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 sm:p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <span className="text-sm font-black uppercase tracking-wider text-amber-400">
                  Гілка Союзників та Континенту
                </span>
                <span className="text-xs text-neutral-400 font-mono">Рівні VI → IX</span>
              </div>

              <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 overflow-x-auto pb-2">
                {(['sherman_fury', 'amx13_75', 'tiger_2', 'e75_heavy'] as const).map(
                  (tankId, idx) => {
                    const tank = tanks.find((t) => t.id === tankId);
                    if (!tank) return null;
                    return (
                      <React.Fragment key={tank.id}>
                        {idx > 0 && (
                          <ArrowRight className="hidden lg:block w-5 h-5 text-neutral-600 flex-shrink-0" />
                        )}
                        <TechTreeCard
                          tank={tank}
                          allTanks={tanks}
                          isSelected={selectedTank.id === tank.id}
                          playerXP={playerXP}
                          playerCredits={playerCredits}
                          onInspect={() => {
                            onSelectTank(tank);
                            setHangarMode('garage');
                          }}
                          onResearch={() => handleResearchTank(tank)}
                          onBuy={() => handleBuyTank(tank)}
                        />
                      </React.Fragment>
                    );
                  }
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface TechTreeCardProps {
  tank: TankDefinition;
  allTanks: TankDefinition[];
  isSelected: boolean;
  playerXP: number;
  playerCredits: number;
  onInspect: () => void;
  onResearch: () => void;
  onBuy: () => void;
}

const TechTreeCard: React.FC<TechTreeCardProps> = ({
  tank,
  allTanks,
  isSelected,
  playerXP,
  playerCredits,
  onInspect,
  onResearch,
  onBuy,
}) => {
  const reqTank = tank.requiredTankId
    ? allTanks.find((t) => t.id === tank.requiredTankId)
    : undefined;
  const reqMet = !reqTank || Boolean(reqTank.researched || reqTank.unlocked);
  const topGun = tank.guns[tank.guns.length - 1] || tank.guns[0];
  const topTurret = tank.turrets[tank.turrets.length - 1] || tank.turrets[0];

  return (
    <div
      onClick={onInspect}
      className={`flex-1 min-w-[230px] rounded-xl border p-3.5 flex flex-col justify-between gap-3 cursor-pointer transition-all ${
        tank.unlocked
          ? isSelected
            ? 'bg-amber-950/35 border-amber-400'
            : 'bg-neutral-800/80 border-emerald-500/50 hover:border-emerald-400'
          : tank.researched
          ? 'bg-neutral-800/70 border-amber-500/50 hover:border-amber-400'
          : 'bg-neutral-950/90 border-neutral-800 hover:border-neutral-600'
      }`}
    >
      <div>
        <div className="flex justify-between items-center text-[11px] font-mono">
          <span className="font-black text-amber-400">Рівень {tank.tier}</span>
          <span className="text-neutral-400">
            {CLASS_LABEL_UK[tank.tankClass]} · {tank.nation}
          </span>
        </div>

        <h3 className="text-sm font-black text-white mt-1">{tank.name}</h3>
        <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-neutral-400 font-mono">
          <span>HP: <strong className="text-emerald-400">{topTurret.hpBonus}</strong></span>
          <span>Проб: <strong className="text-amber-300">{topGun.penetrationAP}</strong></span>
          <span>Броня: <strong className="text-white">{tank.armorHullFront}/{tank.armorTurretFront}</strong></span>
          <span>УВН: <strong className="text-sky-300">-{tank.gunDepressionDeg}°</strong></span>
        </div>
      </div>

      <div className="pt-2 border-t border-neutral-800 flex items-center justify-between gap-2">
        {tank.unlocked ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInspect();
            }}
            className="w-full py-1.5 rounded-lg bg-emerald-600/25 border border-emerald-500/60 text-emerald-300 text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            В ангарі · Огляд
          </button>
        ) : tank.researched ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onBuy();
            }}
            disabled={playerCredits < tank.priceCredits}
            className={`w-full py-1.5 rounded-lg text-xs font-black cursor-pointer flex items-center justify-center gap-1.5 ${
              playerCredits >= tank.priceCredits
                ? 'bg-amber-500 hover:bg-amber-400 text-neutral-950'
                : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            Купити {tank.priceCredits.toLocaleString()} ср.
          </button>
        ) : reqMet ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onResearch();
            }}
            disabled={playerXP < tank.priceXP}
            className={`w-full py-1.5 rounded-lg text-xs font-black cursor-pointer flex items-center justify-center gap-1.5 ${
              playerXP >= tank.priceXP
                ? 'bg-sky-600 hover:bg-sky-500 text-white'
                : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Дослідити {tank.priceXP.toLocaleString()} XP
          </button>
        ) : (
          <div className="w-full py-1.5 px-2 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-500 text-[11px] font-medium flex items-center justify-center gap-1.5">
            <Lock className="w-3 h-3" />
            Спочатку {reqTank?.name}
          </div>
        )}
      </div>
    </div>
  );
};
