/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { BattleEngine } from '../game/battleEngine.ts';
import { ShellType } from '../types.ts';
import { Crosshair, Flame, Wrench, Shield, Maximize, Minimize } from 'lucide-react';
import { soundEngine } from '../game/audio.ts';
import { tryRequestFullscreen, exitFullscreen } from '../utils/device.ts';

interface MobileControlsProps {
  engine: BattleEngine;
  isPortrait: boolean;
}

export const MobileControls: React.FC<MobileControlsProps> = ({ engine, isPortrait }) => {
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isJoystickActive, setIsJoystickActive] = useState<boolean>(false);
  const joystickTouchIdRef = useRef<number | null>(null);
  const lookTouchIdRef = useRef<number | null>(null);
  const lastLookPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(Boolean(document.fullscreenElement));

  const player = engine.player;
  const isReloading = player ? player.reloadProgress < 1.0 : false;
  const reloadPct = player ? Math.round(player.reloadProgress * 100) : 100;

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Left Joystick Touch Handlers
  const handleJoystickTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (joystickTouchIdRef.current !== null) return;
    const touch = e.changedTouches[0];
    joystickTouchIdRef.current = touch.identifier;
    setIsJoystickActive(true);
    updateJoystickPos(touch.clientX, touch.clientY);
  };

  const handleJoystickTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchIdRef.current) {
        updateJoystickPos(touch.clientX, touch.clientY);
        break;
      }
    }
  };

  const handleJoystickTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchIdRef.current) {
        joystickTouchIdRef.current = null;
        setIsJoystickActive(false);
        setKnobPos({ x: 0, y: 0 });
        engine.virtualThrottle = 0;
        engine.virtualSteer = 0;
        break;
      }
    }
  };

  const updateJoystickPos = (touchX: number, touchY: number) => {
    if (!joystickBaseRef.current) return;
    const rect = joystickBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const maxRadius = rect.width / 2;
    let dx = touchX - centerX;
    let dy = touchY - centerY;

    const dist = Math.hypot(dx, dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }

    setKnobPos({ x: dx, y: dy });

    // Invert Y so up is positive forward throttle; invert X because +rotationY turns left (+X forward heading)
    const normX = dx / maxRadius;
    const normY = -dy / maxRadius;

    engine.virtualSteer = -normX;
    engine.virtualThrottle = normY;
  };

  // Right-side Touch Look / Aim Touch Handlers
  const handleAimTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (lookTouchIdRef.current !== null) return;
    const touch = e.changedTouches[0];
    lookTouchIdRef.current = touch.identifier;
    lastLookPosRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleAimTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === lookTouchIdRef.current) {
        const dx = touch.clientX - lastLookPosRef.current.x;
        const dy = touch.clientY - lastLookPosRef.current.y;
        lastLookPosRef.current = { x: touch.clientX, y: touch.clientY };

        // Scale touch move to camera delta
        const touchSens = engine.isSniperMode ? 0.9 : 1.4;
        engine.mouseLookDelta.x += dx * touchSens;
        engine.mouseLookDelta.y += dy * touchSens;
        break;
      }
    }
  };

  const handleAimTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === lookTouchIdRef.current) {
        lookTouchIdRef.current = null;
        break;
      }
    }
  };

  const handleFirePress = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();
    if ('cancelable' in e && e.cancelable) {
      e.preventDefault();
    }
    if (player && player.reloadProgress >= 1.0) {
      engine.isFiringRequested = true;
    }
  };

  const handleToggleSniper = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();
    if (!engine.isSniperMode) {
      engine.isSniperMode = true;
      engine.sniperZoomLevel = 2;
    } else {
      if (engine.sniperZoomLevel === 2) engine.sniperZoomLevel = 4;
      else if (engine.sniperZoomLevel === 4) engine.sniperZoomLevel = 8;
      else {
        engine.isSniperMode = false;
        engine.sniperZoomLevel = 1;
      }
    }
  };

  const handleSelectShell = (type: ShellType) => {
    if (player) {
      player.activeShell = type;
    }
  };

  const handleUseConsumable = (
    e: React.TouchEvent | React.MouseEvent,
    type: 'repairKit' | 'medKit' | 'fireExtinguisher'
  ) => {
    e.stopPropagation();
    if ('cancelable' in e && e.cancelable) e.preventDefault();
    engine.useConsumable(type);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      exitFullscreen();
    } else {
      tryRequestFullscreen();
    }
  };

  return (
    <div className="absolute inset-0 pointer-events-none select-none z-30 overflow-hidden font-sans">
      {/* Portrait Orientation Suggestion Prompt */}
      {isPortrait && (
        <div className="absolute top-16 left-4 right-4 bg-amber-950/95 border border-amber-500 rounded-xl p-3 text-center pointer-events-auto z-50 shadow-2xl animate-pulse">
          <span className="text-xs font-bold text-amber-300">
            🔄 Рекомендація: переверніть пристрій у горизонтальний режим (Landscape) для повного огляду та зручного керування!
          </span>
        </div>
      )}

      {/* Fullscreen Button (Top-Right under status) */}
      <button
        onClick={toggleFullscreen}
        className="absolute top-16 right-4 bg-neutral-900/90 border border-neutral-700 active:bg-amber-600 active:text-neutral-950 text-neutral-300 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 pointer-events-auto shadow-lg"
      >
        {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
        <span>{isFullscreen ? 'Вікно' : 'На весь екран'}</span>
      </button>

      {/* RIGHT-SIDE TOUCH AIM ZONE (Swiping anywhere on right half of screen aims gun) */}
      <div
        onTouchStart={handleAimTouchStart}
        onTouchMove={handleAimTouchMove}
        onTouchEnd={handleAimTouchEnd}
        onTouchCancel={handleAimTouchEnd}
        className="absolute top-0 right-0 w-1/2 h-full pointer-events-auto opacity-0"
      />

      {/* LEFT VIRTUAL JOYSTICK FOR TANK MOVEMENT */}
      <div className="absolute bottom-6 left-6 pointer-events-auto flex flex-col items-center">
        <div
          ref={joystickBaseRef}
          onTouchStart={handleJoystickTouchStart}
          onTouchMove={handleJoystickTouchMove}
          onTouchEnd={handleJoystickTouchEnd}
          onTouchCancel={handleJoystickTouchEnd}
          className={`relative w-36 h-36 rounded-full border-2 transition-colors flex items-center justify-center ${
            isJoystickActive
              ? 'bg-neutral-900/80 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
              : 'bg-neutral-900/60 border-neutral-600'
          }`}
          style={{ touchAction: 'none' }}
        >
          {/* Direction indicators */}
          <span className="absolute top-2 text-[10px] font-black text-neutral-400">Вперед</span>
          <span className="absolute bottom-2 text-[10px] font-black text-neutral-400">Назад</span>
          <span className="absolute left-2 text-[10px] font-black text-neutral-400">◀</span>
          <span className="absolute right-2 text-[10px] font-black text-neutral-400">▶</span>

          {/* Central Thumb Knob */}
          <div
            className={`w-14 h-14 rounded-full border-2 shadow-xl flex items-center justify-center transition-transform ${
              isJoystickActive
                ? 'bg-amber-500 border-white shadow-[0_0_12px_#f59e0b]'
                : 'bg-neutral-700/80 border-neutral-400'
            }`}
            style={{
              transform: `translate(${knobPos.x}px, ${knobPos.y}px)`,
              touchAction: 'none',
            }}
          >
            <div className="w-4 h-4 rounded-full bg-neutral-900/60" />
          </div>
        </div>

        <span className="text-[10px] text-neutral-400 mt-1 font-bold">КЕРУВАННЯ ТАНКОМ</span>
      </div>

      {/* RIGHT COMBAT BUTTONS CLUSTER (Thumb reachable) */}
      <div className="absolute bottom-6 right-6 pointer-events-auto flex items-end gap-3">
        {/* Shell Quick Switchers (AP / APCR / HE) */}
        <div className="flex flex-col gap-1.5 bg-neutral-950/80 border border-neutral-800 p-1 rounded-xl">
          {(['AP', 'APCR', 'HE'] as ShellType[]).map((type) => {
            const count = player ? player.shellsRemaining[type] : 0;
            const isSelected = player ? player.activeShell === type : false;

            return (
              <button
                key={type}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  handleSelectShell(type);
                }}
                onClick={() => handleSelectShell(type)}
                className={`px-2 py-1.5 rounded-lg border text-xs flex flex-col items-center ${
                  isSelected
                    ? 'bg-amber-500 text-neutral-950 font-black border-amber-400 shadow-md'
                    : 'bg-neutral-800 text-neutral-300 border-neutral-700'
                }`}
              >
                <span className="text-[11px] font-bold">{type}</span>
                <span className="text-[9px] font-mono opacity-80">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Action Buttons: Sniper Scope + Track Repair */}
        <div className="flex flex-col gap-2">
          {/* Quick Flip Rescue Button */}
          {player && player.isFlipped && (
            <button
              onTouchStart={(e) => {
                e.stopPropagation();
                if (e.cancelable) e.preventDefault();
                player.isFlipped = false;
                player.pitch = 0;
                player.roll = 0;
                player.flipTimer = 0;
              }}
              onClick={() => {
                player.isFlipped = false;
                player.pitch = 0;
                player.roll = 0;
                player.flipTimer = 0;
              }}
              className="w-14 h-14 rounded-2xl bg-amber-600 active:bg-amber-500 border-2 border-white text-white font-black text-[9px] flex flex-col items-center justify-center shadow-2xl animate-bounce"
            >
              🔄 НА КОЛЕСА
            </button>
          )}

          {/* Mobile Consumable Quick-Action Buttons */}
          {player && player.isOnFire && (
            <button
              onTouchStart={(e) => handleUseConsumable(e, 'fireExtinguisher')}
              onClick={(e) => handleUseConsumable(e, 'fireExtinguisher')}
              disabled={player.consumableCooldowns.fireExtinguisher > 0}
              className="w-14 h-14 rounded-2xl bg-orange-600 active:bg-orange-500 border-2 border-white text-white font-black text-[9px] flex flex-col items-center justify-center shadow-2xl"
            >
              <Flame className="w-5 h-5" />
              ГАСИТИ
            </button>
          )}

          {player &&
            (player.tracksDamaged ||
              player.engineDamaged ||
              player.gunDamaged ||
              Object.values(player.modules).some((m) => m !== 'intact')) && (
              <button
                onTouchStart={(e) => handleUseConsumable(e, 'repairKit')}
                onClick={(e) => handleUseConsumable(e, 'repairKit')}
                disabled={player.consumableCooldowns.repairKit > 0}
                className="w-14 h-14 rounded-2xl bg-rose-600 active:bg-rose-500 border-2 border-white text-white font-black text-[9px] flex flex-col items-center justify-center shadow-2xl disabled:opacity-50"
              >
                <Wrench className="w-5 h-5" />
                {player.consumableCooldowns.repairKit > 0
                  ? `${Math.ceil(player.consumableCooldowns.repairKit)}с`
                  : 'РЕМОНТ'}
              </button>
            )}

          {player && Object.values(player.crew).some((c) => c === 'injured') && (
            <button
              onTouchStart={(e) => handleUseConsumable(e, 'medKit')}
              onClick={(e) => handleUseConsumable(e, 'medKit')}
              disabled={player.consumableCooldowns.medKit > 0}
              className="w-14 h-14 rounded-2xl bg-sky-600 active:bg-sky-500 border-2 border-white text-white font-black text-[9px] flex flex-col items-center justify-center shadow-2xl disabled:opacity-50"
            >
              <Shield className="w-5 h-5" />
              {player.consumableCooldowns.medKit > 0
                ? `${Math.ceil(player.consumableCooldowns.medKit)}с`
                : 'АПТЕЧКА'}
            </button>
          )}

          {/* Sniper Mode Toggle */}
          <button
            onTouchStart={handleToggleSniper}
            onClick={handleToggleSniper}
            className={`w-14 h-14 rounded-2xl border-2 flex flex-col items-center justify-center shadow-xl transition-all ${
              engine.isSniperMode
                ? 'bg-emerald-600 border-white text-white shadow-[0_0_15px_#10b981]'
                : 'bg-neutral-800/90 active:bg-neutral-700 border-neutral-600 text-neutral-200'
            }`}
          >
            <Crosshair className="w-5 h-5" />
            <span className="text-[10px] font-bold tracking-tight">
              {engine.isSniperMode ? `x${engine.sniperZoomLevel}` : 'ПРИЦІЛ'}
            </span>
          </button>
        </div>

        {/* Big FIRE (ВОГОНЬ) Button */}
        <div className="relative">
          <button
            onTouchStart={handleFirePress}
            onClick={handleFirePress}
            disabled={isReloading}
            className={`w-20 h-20 rounded-full border-4 flex flex-col items-center justify-center shadow-2xl transition-all ${
              !isReloading
                ? 'bg-gradient-to-tr from-rose-600 to-amber-500 active:scale-95 border-white text-white shadow-[0_0_20px_rgba(244,63,94,0.6)] cursor-pointer'
                : 'bg-neutral-800 border-neutral-700 text-neutral-500 cursor-not-allowed opacity-80'
            }`}
          >
            <Flame className="w-7 h-7 fill-current" />
            <span className="text-[11px] font-black tracking-wider uppercase mt-0.5">
              {!isReloading ? 'ВОГОНЬ' : `${reloadPct}%`}
            </span>
          </button>

          {/* Circular reload progress meter */}
          {isReloading && (
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-amber-300 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-700 whitespace-nowrap">
              ЗАРЯДЖАННЯ
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
