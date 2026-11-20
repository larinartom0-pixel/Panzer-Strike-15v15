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
  const [isControlsDismissed, setIsControlsDismissed] = useState<boolean>(false);
  const [pointerLockBlocked, setPointerLockBlocked] = useState<boolean>(false);
  const [isTouchMode, setIsTouchMode] = useState<boolean>(() => {
    const dev = detectDevice();
    return dev.isMobile || dev.isTablet;
  });
  const engineRef = useRef<BattleEngine | null>(null);
  const rendererDomRef = useRef<HTMLCanvasElement | null>(null);
  const lastTouchTimeRef = useRef<number>(0);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const edgeTurnDirRef = useRef<number>(0);

  const requestMouseLock = () => {
    const el = rendererDomRef.current;
    if (!el) return;
    try {
      const result = el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          setPointerLockBlocked(true);
        });
      }
    } catch {
      setPointerLockBlocked(true);
    }
  };

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    soundEngine.init();

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
    rendererDomRef.current = renderer.domElement;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

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

      // Edge-turn helper when running in fallback cursor-aim mode (e.g., restricted iframe)
      if (edgeTurnDirRef.current !== 0 && !document.pointerLockElement) {
        battleEngine.mouseLookDelta.x += edgeTurnDirRef.current * 480 * Math.min(dt, 0.05);
      }

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

    // Input Handlers: PC Keyboard
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
      battleEngine.keys[e.code] = true;

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        battleEngine.isSniperMode = !battleEngine.isSniperMode;
        if (!battleEngine.isSniperMode) {
          battleEngine.sniperZoomLevel = 1;
        }
      }

      // Keyboard fire fallback (F) for trackpad PC players
      if (e.code === 'KeyF') {
        battleEngine.isFiringRequested = true;
      }

      // Quick flip recovery on R
      if (e.code === 'KeyR' && battleEngine.player && battleEngine.player.isFlipped) {
        battleEngine.player.isFlipped = false;
        battleEngine.player.pitch = 0;
        battleEngine.player.roll = 0;
        battleEngine.player.flipTimer = 0;
      }

      // Toggle/request Mouse Lock on M
      if (e.code === 'KeyM') {
        if (document.pointerLockElement === renderer.domElement) {
          document.exitPointerLock();
        } else {
          setIsControlsDismissed(true);
          requestMouseLock();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      battleEngine.keys[e.code] = false;
    };

    const handleBlur = () => {
      battleEngine.keys = {};
      edgeTurnDirRef.current = 0;
    };

    // Touch vs Mouse detection so hybrid touch-laptops work seamlessly with mouse
    const handleTouchStartGlobal = () => {
      lastTouchTimeRef.current = performance.now();
    };

    // Pointer Lock & Mouse Aiming
    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      setIsPointerLocked(locked);
      if (locked) {
        setIsControlsDismissed(true);
        setPointerLockBlocked(false);
        edgeTurnDirRef.current = 0;
      }
    };

    const handlePointerLockError = () => {
      setPointerLockBlocked(true);
      setIsPointerLocked(false);
    };

    const handleMouseMove = (e: MouseEvent) => {
      // Ignore simulated mouse move right after touch
      if (performance.now() - lastTouchTimeRef.current < 600) return;

      if (document.pointerLockElement === renderer.domElement) {
        battleEngine.mouseLookDelta.x += e.movementX;
        battleEngine.mouseLookDelta.y += e.movementY;
        edgeTurnDirRef.current = 0;
        return;
      }

      // Fallback PC mouse-aiming when controls are active without Pointer Lock (e.g. iframe restriction)
      if (isControlsDismissedRef.current) {
        if (lastMousePosRef.current) {
          const dx = e.clientX - lastMousePosRef.current.x;
          const dy = e.clientY - lastMousePosRef.current.y;
          battleEngine.mouseLookDelta.x += dx * 1.35;
          battleEngine.mouseLookDelta.y += dy * 1.15;
        }
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };

        const w = window.innerWidth;
        if (e.clientX < w * 0.06) edgeTurnDirRef.current = -1;
        else if (e.clientX > w * 0.94) edgeTurnDirRef.current = 1;
        else edgeTurnDirRef.current = 0;
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Ignore browser-synthesized mouse events from mobile touch taps
      if (performance.now() - lastTouchTimeRef.current < 700) {
        return;
      }
      // Only handle clicks targeted at the 3D battle canvas (ignore HUD buttons)
      if (e.target !== renderer.domElement) {
        return;
      }

      // Blur any previously focused HUD button so Spacebar doesn't trigger it
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      setIsTouchMode(false);
      setIsControlsDismissed(true);

      const locked = document.pointerLockElement === renderer.domElement;
      if (!locked && !pointerLockBlockedRef.current) {
        requestMouseLock();
        // If lock wasn't already active, also fire if already playing in fallback or just lock
        if (!isControlsDismissedRef.current) return;
      }

      if (e.button === 0) {
        battleEngine.isFiringRequested = true;
      } else if (e.button === 2) {
        e.preventDefault();
        battleEngine.isSniperMode = !battleEngine.isSniperMode;
        if (!battleEngine.isSniperMode) {
          battleEngine.sniperZoomLevel = 1;
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (battleEngine.isSniperMode) {
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
    window.addEventListener('blur', handleBlur);
    window.addEventListener('touchstart', handleTouchStartGlobal, { passive: true });
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('pointerlockerror', handlePointerLockError);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('touchstart', handleTouchStartGlobal);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('pointerlockerror', handlePointerLockError);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('resize', handleResize);

      cancelAnimationFrame(animId);
      clearTimeout(animId);
      battleEngine.dispose();
      rendererDomRef.current = null;

      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [playerTank, selectedMap]);

  const isControlsDismissedRef = useRef(isControlsDismissed);
  isControlsDismissedRef.current = isControlsDismissed;
  const pointerLockBlockedRef = useRef(pointerLockBlocked);
  pointerLockBlockedRef.current = pointerLockBlocked;

  return (
    <div className="relative w-full h-screen overflow-hidden select-none bg-neutral-950 font-sans">
      {/* 3D Battle Canvas Container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-crosshair" />

      {/* Pointer Lock / PC Start Helper Overlay (Desktop & Laptops) */}
      {!isTouchMode && !isPointerLocked && !isControlsDismissed && !battleSummary && (
        <div
          onClick={() => {
            setIsControlsDismissed(true);
            requestMouseLock();
          }}
          className="absolute inset-0 bg-black/45 flex items-center justify-center cursor-pointer z-40 backdrop-blur-none"
        >
          <div className="bg-neutral-900/95 border border-amber-500/80 rounded-xl px-8 py-5 text-center shadow-2xl flex flex-col items-center gap-2.5 max-w-lg">
            <span className="text-xl font-black text-amber-400 uppercase tracking-wider">
              Керування на ПК (Mouse Lock)
            </span>
            <p className="text-xs text-neutral-300">
              Натисніть сюди, щоб увімкнути захоплення миші та наведення гармати на 360°.
              Натисніть <strong className="text-white">ESC</strong>, щоб звільнити курсор.
            </p>
            <div className="mt-1 text-[11px] text-amber-300 font-bold border-t border-neutral-700 pt-2.5 leading-relaxed">
              WASD / Стрілки — Рух · ЛКМ / F — Постріл · Shift / ПКМ — Снайпер · Space — Ручник · 1-3 Снаряди · 4-6 Спорядження
            </div>
          </div>
        </div>
      )}

      {/* Live Tactical HUD */}
      {engine && (
        <BattleHUD
          engine={engine}
          isTouchMode={isTouchMode}
          isPointerLocked={isPointerLocked}
          pointerLockBlocked={pointerLockBlocked}
          onRequestMouseLock={() => {
            setIsControlsDismissed(true);
            requestMouseLock();
          }}
          onToggleTouchMode={() => setIsTouchMode((v) => !v)}
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
