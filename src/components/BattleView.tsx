/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BattleEngine } from '../game/battleEngine.ts';
import { BattleHUD } from './BattleHUD.tsx';
import { PostBattleModal } from './PostBattleModal.tsx';
import { BattleSummary, MapData, TankDefinition } from '../types.ts';
import { soundEngine } from '../game/audio.ts';
import { detectDevice, tryRequestFullscreen } from '../utils/device.ts';

interface BattleViewProps {
  playerTank: TankDefinition;
  selectedMap: MapData;
  onExitToHangar: (summary?: BattleSummary) => void;
  onBattleAgain: () => void;
}

export const BattleView: React.FC<BattleViewProps> = ({
  playerTank,
  selectedMap,
  onExitToHangar,
  onBattleAgain,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<BattleEngine | null>(null);
  const [battleSummary, setBattleSummary] = useState<BattleSummary | null>(null);
  const [isPointerLocked, setIsPointerLocked] = useState<boolean>(false);
  const engineRef = useRef<BattleEngine | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    soundEngine.init();

    // Software WebGL detection
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
    scene.background = new THREE.Color(selectedMap.skyColor);
    scene.fog = new THREE.FogExp2(selectedMap.fogColor, 0.0018);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1500);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    // Studio Environment Reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Natural Outdoor Sun & Sky Lighting Rig
    const sunLight = new THREE.DirectionalLight(0xfffaed, 2.4);
    sunLight.position.set(280, 450, 200);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 50;
    sunLight.shadow.camera.far = 900;
    const shadowD = 250;
    sunLight.shadow.camera.left = -shadowD;
    sunLight.shadow.camera.right = shadowD;
    sunLight.shadow.camera.top = shadowD;
    sunLight.shadow.camera.bottom = -shadowD;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x9fc5e8, 0x48583c, 1.1);
    scene.add(hemiLight);

    // Instantiate Battle Engine
    const battleEngine = new BattleEngine(
      scene,
      camera,
      renderer,
      selectedMap,
      playerTank
    );
    battleEngine.onBattleEndCallback = (summary) => {
      setBattleSummary(summary);
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    };

    engineRef.current = battleEngine;
    setEngine(battleEngine);

    // Animation & Physics Loop
    let animId = 0;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          animId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          animId = window.setTimeout(cb, 80);
        }
      };
      animId = window.setTimeout(poll, 5);
    }

    const loop = () => {
      const now = performance.now();
      const dt = (now - lastTime) * 0.001;
      lastTime = now;

      battleEngine.update(dt);
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(loop);
      } else {
        animId = requestAnimationFrame(loop);
      }
    };

    if (isSoftwareGl) {
      loop();
    } else {
      animId = requestAnimationFrame(loop);
    }

    // Input Handlers: Keyboard
    const handleKeyDown = (e: KeyboardEvent) => {
      battleEngine.keys[e.code] = true;

      // Toggle Sniper mode on Shift
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        battleEngine.isSniperMode = !battleEngine.isSniperMode;
        if (!battleEngine.isSniperMode) {
          battleEngine.sniperZoomLevel = 1;
        }
      }

      // Quick flip recovery on R
      if (e.code === 'KeyR' && battleEngine.player && battleEngine.player.isFlipped) {
        battleEngine.player.isFlipped = false;
        battleEngine.player.pitch = 0;
        battleEngine.player.roll = 0;
        battleEngine.player.flipTimer = 0;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      battleEngine.keys[e.code] = false;
    };

    // Mouse Pointer Lock & Aiming
    const handlePointerLockChange = () => {
      setIsPointerLocked(document.pointerLockElement === renderer.domElement);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === renderer.domElement) {
        battleEngine.mouseLookDelta.x += e.movementX;
        battleEngine.mouseLookDelta.y += e.movementY;
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Ignore mouse events on mobile/touch devices to prevent inadvertent firing
      if (detectDevice().isMobile || detectDevice().hasTouch) {
        return;
      }

      if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
        return;
      }

      if (e.button === 0) {
        // Left Click -> Fire gun
        battleEngine.isFiringRequested = true;
      } else if (e.button === 2) {
        // Right Click -> Toggle sniper zoom
        e.preventDefault();
        battleEngine.isSniperMode = !battleEngine.isSniperMode;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (battleEngine.isSniperMode) {
        // Cycle zoom in sniper mode
        if (e.deltaY < 0) {
          battleEngine.sniperZoomLevel = Math.min(8, battleEngine.sniperZoomLevel * 2);
        } else {
          if (battleEngine.sniperZoomLevel > 1) {
            battleEngine.sniperZoomLevel = Math.max(1, battleEngine.sniperZoomLevel / 2);
          } else {
            battleEngine.isSniperMode = false;
          }
        }
      } else {
        // Third person distance
        if (e.deltaY < 0 && battleEngine.cameraDistance <= 7) {
          battleEngine.isSniperMode = true;
          battleEngine.sniperZoomLevel = 2;
        } else {
          battleEngine.cameraDistance = THREE.MathUtils.clamp(
            battleEngine.cameraDistance + e.deltaY * 0.015,
            6,
            24
          );
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('resize', handleResize);

      cancelAnimationFrame(animId);
      clearTimeout(animId);
      battleEngine.dispose();

      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [playerTank, selectedMap]);

  const deviceInfo = detectDevice();
  const isTouchDevice = deviceInfo.isMobile || deviceInfo.hasTouch;

  return (
    <div className="relative w-full h-screen overflow-hidden select-none bg-neutral-950 font-sans">
      {/* 3D Battle Canvas Container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-crosshair" />

      {/* Pointer Lock Helper overlay (Desktop only) */}
      {!isTouchDevice && !isPointerLocked && !battleSummary && (
        <div
          onClick={() => {
            const canvas = mountRef.current?.querySelector('canvas');
            canvas?.requestPointerLock();
          }}
          className="absolute inset-0 bg-black/40 flex items-center justify-center cursor-pointer z-40 backdrop-blur-none"
        >
          <div className="bg-neutral-900/95 border border-amber-500/80 rounded-xl px-8 py-5 text-center shadow-2xl flex flex-col items-center gap-2 max-w-md">
            <span className="text-xl font-black text-amber-400 uppercase tracking-wider">
              Керування Боєм
            </span>
            <p className="text-xs text-neutral-300">
              Натисніть на екран, щоб активувати поворот камери та наведення гармати мишею.
            </p>
            <div className="mt-2 text-[11px] text-amber-300 font-bold border-t border-neutral-700 pt-2">
              ЛКМ — Постріл • Shift / ПКМ — Снайпер • WASD — Рух • Space — Ручник
            </div>
          </div>
        </div>
      )}

      {/* Live Tactical HUD */}
      {engine && (
        <BattleHUD
          engine={engine}
          onExitBattle={() => onExitToHangar(battleSummary || undefined)}
        />
      )}

      {/* Post Battle Modal on Victory / Defeat */}
      {battleSummary && (
        <PostBattleModal
          summary={battleSummary}
          onReturnToHangar={() => onExitToHangar(battleSummary)}
          onBattleAgain={onBattleAgain}
        />
      )}
    </div>
  );
};
