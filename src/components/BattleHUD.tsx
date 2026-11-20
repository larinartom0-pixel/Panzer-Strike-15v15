/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BattleEngine } from '../game/battleEngine.ts';
import { ShellType } from '../types.ts';
import { soundEngine } from '../game/audio.ts';
import { Shield, Crosshair, Wrench, Flame, Eye, Volume2, VolumeX, Users, Zap, Map as MapIcon, ChevronDown, ChevronUp, Monitor, Smartphone, Lock, Unlock } from 'lucide-react';
import { detectDevice } from '../utils/device.ts';
import { MobileControls } from './MobileControls.tsx';

interface BattleHUDProps {
  engine: BattleEngine;
  isTouchMode: boolean;
  isPointerLocked: boolean;
  pointerLockBlocked: boolean;
  onRequestMouseLock: () => void;
  onToggleTouchMode: () => void;
  onExitBattle: () => void;
}

export const BattleHUD: React.FC<BattleHUDProps> = ({
  engine,
  isTouchMode,
  isPointerLocked,
  pointerLockBlocked,
  onRequestMouseLock,
  onToggleTouchMode,
  onExitBattle,
}) => {
  const [, setTick] = useState(0);
  const [showRoster, setShowRoster] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(detectDevice());
  const [isMinimapOpen, setIsMinimapOpen] = useState(true);

  // Resize and orientation listener
  useEffect(() => {
    const handleResize = () => {
      setDeviceInfo(detectDevice());
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // High-frequency UI tick (synchronized with simulation frames)
  useEffect(() => {
    let animId: number;
    const loop = () => {
      setTick((t) => (t + 1) % 10000);
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Keyboard shortcut listener for Tab (team roster), 1-3 shells, 4-6 consumables
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setShowRoster(true);
      } else if (e.code === 'Digit1') {
        engine.player.activeShell = 'AP';
      } else if (e.code === 'Digit2') {
        engine.player.activeShell = 'APCR';
      } else if (e.code === 'Digit3') {
        engine.player.activeShell = 'HE';
      } else if (e.code === 'Digit4') {
        engine.useConsumable('repairKit');
      } else if (e.code === 'Digit5') {
        engine.useConsumable('medKit');
      } else if (e.code === 'Digit6') {
        engine.useConsumable('fireExtinguisher');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        setShowRoster(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [engine]);

  const player = engine.player;
  const aliveGreen = engine.participants.filter((p) => p.team === 'green' && p.isAlive).length;
  const aliveRed = engine.participants.filter((p) => p.team === 'red' && p.isAlive).length;

  const totalGreenHP = engine.participants
    .filter((p) => p.team === 'green')
    .reduce((sum, p) => sum + (p.isAlive ? p.currentHP : 0), 0);
  const totalRedHP = engine.participants
    .filter((p) => p.team === 'red')
    .reduce((sum, p) => sum + (p.isAlive ? p.currentHP : 0), 0);

  const maxGreenHP = engine.participants
    .filter((p) => p.team === 'green')
    .reduce((sum, p) => sum + p.maxHP, 0);
  const maxRedHP = engine.participants
    .filter((p) => p.team === 'red')
    .reduce((sum, p) => sum + p.maxHP, 0);

  const minutes = Math.floor(Math.max(0, engine.battleTimeRemaining) / 60);
  const seconds = Math.floor(Math.max(0, engine.battleTimeRemaining) % 60);

  const playerHpRatio = player ? Math.max(0, player.currentHP / player.maxHP) : 1;
  const speedKmh = player ? Math.round(Math.abs(player.speed) * 3.6) : 0;

  // Minimap size based on active control mode (PC vs Touch)
  const isTouchDevice = isTouchMode;
  const minimapPx = isTouchDevice ? 130 : 190;

  // Minimap scale parameters (1000m map mapped to square)
  const mapSize = engine.mapData.size;
  const toMinimap = (wx: number, wz: number) => {
    const nx = (wx + mapSize * 0.5) / mapSize;
    const nz = (wz + mapSize * 0.5) / mapSize;
    return {
      x: Math.max(0, Math.min(minimapPx, nx * minimapPx)),
      y: Math.max(0, Math.min(minimapPx, nz * minimapPx)),
    };
  };

  const handleMuteToggle = () => {
    const muted = soundEngine.toggleMute();
    setIsMuted(muted);
  };

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden font-sans text-white">
      {/* 1. TOP STATUS & SCORE BAR (15 vs 15) */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-auto max-w-[95vw]">
        <div className="bg-neutral-900/90 border border-neutral-700/80 rounded-lg px-3 sm:px-6 py-1.5 sm:py-2 shadow-2xl flex items-center gap-3 sm:gap-8 backdrop-blur-none">
          {/* Green Team */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
            <span className="text-base sm:text-xl font-black tabular-nums text-emerald-400">
              {15 - aliveRed}
            </span>
            <div className="hidden sm:block text-xs text-neutral-400 font-medium">
              СОЮЗНИКИ ({aliveGreen}/15)
            </div>
            {/* Green total HP bar */}
            <div className="w-14 sm:w-24 h-2 bg-neutral-800 rounded-full overflow-hidden border border-neutral-700">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${(totalGreenHP / maxGreenHP) * 100}%` }}
              />
            </div>
          </div>

          {/* Timer */}
          <div className="flex flex-col items-center px-2 sm:px-4 border-x border-neutral-700">
            <span className="text-[10px] sm:text-xs text-neutral-400 tracking-wider">ЧАС</span>
            <span className="text-sm sm:text-lg font-mono font-bold text-amber-300 tabular-nums">
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
          </div>

          {/* Red Team */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            {/* Red total HP bar */}
            <div className="w-14 sm:w-24 h-2 bg-neutral-800 rounded-full overflow-hidden border border-neutral-700">
              <div
                className="h-full bg-rose-500 transition-all duration-300"
                style={{ width: `${(totalRedHP / maxRedHP) * 100}%` }}
              />
            </div>
            <div className="hidden sm:block text-xs text-neutral-400 font-medium">
              ВОРОГИ ({aliveRed}/15)
            </div>
            <span className="text-base sm:text-xl font-black tabular-nums text-rose-400">
              {15 - aliveGreen}
            </span>
            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
          </div>
        </div>

        {/* Base Capture Indicators (Active when base is contested) */}
        {(engine.greenCaptureProgress > 0 || engine.redCaptureProgress > 0) && (
          <div className="mt-1.5 flex flex-wrap justify-center gap-2">
            {engine.greenCaptureProgress > 0 && (
              <div className="bg-emerald-950/90 border border-emerald-600 rounded px-2.5 py-0.5 flex items-center gap-2">
                <span className="text-[10px] sm:text-xs font-bold text-emerald-400">ВОРОЖА БАЗА:</span>
                <span className="text-xs sm:text-sm font-black tabular-nums text-white">
                  {Math.round(engine.greenCaptureProgress)}%
                </span>
                <div className="w-16 sm:w-24 h-1.5 bg-emerald-900 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-400"
                    style={{ width: `${engine.greenCaptureProgress}%` }}
                  />
                </div>
              </div>
            )}
            {engine.redCaptureProgress > 0 && (
              <div className="bg-rose-950/95 border border-rose-600 rounded px-2.5 py-0.5 flex items-center gap-2 animate-bounce">
                <span className="text-[10px] sm:text-xs font-bold text-rose-300">НАША БАЗА:</span>
                <span className="text-xs sm:text-sm font-black tabular-nums text-white">
                  {Math.round(engine.redCaptureProgress)}%
                </span>
                <div className="w-16 sm:w-24 h-1.5 bg-rose-900 rounded overflow-hidden">
                  <div
                    className="h-full bg-rose-500"
                    style={{ width: `${engine.redCaptureProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* TOP-LEFT PLAYER STATS & TARGET READOUT */}
      <div className="absolute top-2 left-2 sm:left-4 flex flex-col gap-1 pointer-events-auto">
        <div className="bg-neutral-900/80 border border-neutral-700/80 rounded px-2.5 py-1 flex items-center gap-2 text-[10px] sm:text-xs">
          <span className="font-bold text-amber-400 truncate max-w-[120px] sm:max-w-none">
            {engine.player.tankDef.name}
          </span>
          <span className="text-neutral-500">|</span>
          <span className="text-neutral-300">
            Шкода: <strong className="text-emerald-400 font-mono">{engine.player.damageDealt}</strong>
          </span>
          <span className="text-neutral-300">
            Фраги: <strong className="text-rose-400 font-mono">{engine.player.kills}</strong>
          </span>
        </div>

        {engine.targetTankName && (
          <div className="bg-neutral-950/90 border border-rose-500/80 rounded px-2.5 py-1 text-[10px] sm:text-xs font-bold text-rose-300 flex items-center gap-1.5 max-w-[200px] sm:max-w-none truncate">
            <Crosshair className="w-3 h-3 text-rose-400 flex-shrink-0" />
            <span className="truncate">{engine.targetTankName}</span>
          </div>
        )}
      </div>

      {/* TOP-RIGHT BUTTONS (Mode Switch, Mouse Lock, Roster, Mute, Leave) */}
      <div className="absolute top-2 right-2 sm:right-4 flex items-center gap-1.5 pointer-events-auto">
        {!isTouchDevice && !isPointerLocked && !pointerLockBlocked && (
          <button
            onClick={(e) => {
              e.currentTarget.blur();
              onRequestMouseLock();
            }}
            className="bg-amber-600/90 hover:bg-amber-500 text-neutral-950 border border-amber-400 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded flex items-center gap-1 text-[10px] sm:text-xs font-bold cursor-pointer shadow-lg"
            title="Увімкнути захоплення миші [M]"
          >
            <Lock className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Mouse Lock [M]</span>
          </button>
        )}

        <button
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleTouchMode();
          }}
          className="bg-neutral-900/90 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-700 px-2 py-1 sm:py-1.5 rounded flex items-center gap-1 text-[10px] sm:text-xs font-medium cursor-pointer"
          title={isTouchDevice ? 'Перемкнути на ПК керування' : 'Перемкнути на сенсорне керування'}
        >
          {isTouchDevice ? <Monitor className="w-3.5 h-3.5 text-sky-400" /> : <Smartphone className="w-3.5 h-3.5 text-amber-400" />}
          <span className="hidden lg:inline">{isTouchDevice ? 'ПК' : 'Сенсор'}</span>
        </button>

        <button
          onClick={(e) => {
            e.currentTarget.blur();
            setShowRoster((v) => !v);
          }}
          className="bg-neutral-900/90 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-700 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded flex items-center gap-1 text-[10px] sm:text-xs font-medium cursor-pointer"
          title="Склад команд"
        >
          <Users className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">15v15 [Tab]</span>
        </button>

        <button
          onClick={(e) => {
            e.currentTarget.blur();
            handleMuteToggle();
          }}
          className="bg-neutral-900/90 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-700 p-1 sm:p-1.5 rounded cursor-pointer"
          title="Звук"
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
        </button>

        <button
          onClick={(e) => {
            e.currentTarget.blur();
            onExitBattle();
          }}
          className="bg-rose-900/80 hover:bg-rose-800 text-rose-200 border border-rose-700 px-2 sm:px-3 py-1 sm:py-1.5 rounded text-[10px] sm:text-xs font-bold cursor-pointer"
        >
          Ангар
        </button>
      </div>

      {/* 2. DYNAMIC CROSSHAIR & RETICLE (Exact concentric center screen) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative w-0 h-0 flex items-center justify-center">
          {/* Dynamic Dispersion Circle (aiming bloom) centered */}
          <div
            className="absolute rounded-full border border-dashed border-emerald-400/70 pointer-events-none transition-all duration-75"
            style={{
              width: `${Math.max(16, Math.min(54, engine.currentDispersion * 65))}px`,
              height: `${Math.max(16, Math.min(54, engine.currentDispersion * 65))}px`,
            }}
          />

          {/* Crosshair lines - compact WoT style */}
          <div className="absolute w-3.5 h-[1.5px] -left-5 bg-emerald-400/90 shadow-[0_0_2px_black]" />
          <div className="absolute w-3.5 h-[1.5px] -right-5 bg-emerald-400/90 shadow-[0_0_2px_black]" />
          <div className="absolute h-3.5 w-[1.5px] -top-5 bg-emerald-400/90 shadow-[0_0_2px_black]" />
          <div className="absolute h-3.5 w-[1.5px] -bottom-5 bg-emerald-400/90 shadow-[0_0_2px_black]" />

          {/* Center Penetration Marker with Armor Indicator */}
          <div
            className={`w-2.5 h-2.5 rounded-full border border-black transition-colors duration-100 ${
              engine.penetrationIndicator === 'green'
                ? 'bg-emerald-400 shadow-[0_0_10px_#10b981]'
                : engine.penetrationIndicator === 'orange'
                ? 'bg-amber-400 shadow-[0_0_10px_#f59e0b]'
                : engine.penetrationIndicator === 'red'
                ? 'bg-rose-500 shadow-[0_0_10px_#ef4444]'
                : 'bg-emerald-400/50'
            }`}
          />

          {/* Real-time Target Armor Zone Badge (Right below reticle) */}
          {engine.targetTankName && (
            <div className="absolute top-7 bg-neutral-950/90 border border-neutral-700/80 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap shadow-xl flex items-center gap-1.5 animate-in fade-in duration-100">
              <span
                className={`w-2 h-2 rounded-full ${
                  engine.penetrationIndicator === 'green'
                    ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]'
                    : engine.penetrationIndicator === 'orange'
                    ? 'bg-amber-400 shadow-[0_0_6px_#f59e0b]'
                    : 'bg-rose-500 shadow-[0_0_6px_#ef4444]'
                }`}
              />
              <span className="text-white">{engine.targetTankName}</span>
            </div>
          )}

          {/* Reload Circular Progress Ring around Reticle */}
          {player && player.reloadProgress < 1.0 && (
            <div className="absolute -bottom-8 text-[10px] font-mono font-bold text-amber-300 bg-neutral-950/85 px-1.5 py-0.5 rounded border border-amber-500/40 whitespace-nowrap shadow">
              ЗАРЯДКА: {Math.round(player.reloadProgress * 100)}%
            </div>
          )}

          {/* Sniper Mode indicator */}
          {engine.isSniperMode && (
            <div className="absolute -top-8 text-[10px] font-bold tracking-wider text-emerald-400 bg-black/85 px-2 py-0.5 rounded border border-emerald-500/80 whitespace-nowrap shadow">
              СНАЙПЕР [x{engine.sniperZoomLevel}]
            </div>
          )}

          {/* Gun Depression / Elevation Limit Indicator (УВН) */}
          {engine.isAimBlockedByUBN && (
            <div className="absolute left-7 top-0 text-[9px] font-bold tracking-wider text-amber-300 bg-neutral-950/90 px-1.5 py-0.5 rounded border border-amber-500/70 whitespace-nowrap">
              УВН
            </div>
          )}
        </div>
      </div>

      {/* Active Fire Emergency Banner */}
      {player && player.isOnFire && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-orange-950/95 border-2 border-orange-500 rounded-lg px-4 py-1.5 flex items-center gap-2 shadow-2xl pointer-events-none">
          <Flame className="w-4 h-4 text-orange-400 fill-orange-400" />
          <span className="text-xs sm:text-sm font-black text-orange-200 tracking-wide">
            ПОЖЕЖА! Натисніть [6] Вогнегасник ({Math.ceil(player.fireTimer)}с)
          </span>
        </div>
      )}

      {/* 3. BATTLE RIBBONS (Mid-Right) */}
      <div className="absolute right-4 top-24 flex flex-col items-end gap-1.5 pointer-events-none">
        {engine.battleRibbons.map((ribbon) => (
          <div
            key={ribbon.id}
            className={`bg-neutral-900/95 border rounded px-2.5 py-1 flex items-center gap-1.5 shadow-lg ${
              ribbon.type === 'fire' || ribbon.type === 'ammo_rack'
                ? 'border-orange-500'
                : 'border-amber-500/80'
            }`}
          >
            {ribbon.type === 'damage' && <Zap className="w-3.5 h-3.5 text-amber-400" />}
            {ribbon.type === 'kill' && <Flame className="w-3.5 h-3.5 text-rose-500" />}
            {ribbon.type === 'fire' && <Flame className="w-3.5 h-3.5 text-orange-500" />}
            {ribbon.type === 'ammo_rack' && <Zap className="w-3.5 h-3.5 text-rose-400" />}
            {ribbon.type === 'spot' && <Eye className="w-3.5 h-3.5 text-sky-400" />}
            {ribbon.type === 'ricochet' && <Shield className="w-3.5 h-3.5 text-blue-400" />}
            {ribbon.type === 'ram' && <Shield className="w-3.5 h-3.5 text-orange-400" />}
            {ribbon.type === 'crit' && <Wrench className="w-3.5 h-3.5 text-amber-400" />}
            <span className="text-[11px] font-bold text-amber-200">{ribbon.title}</span>
          </div>
        ))}
      </div>

      {/* 4. VEHICLE HP & SPEEDOMETER CARD */}
      <div
        className={`absolute pointer-events-auto ${
          isTouchDevice
            ? 'top-14 left-2 min-w-[150px]'
            : 'bottom-4 left-6 min-w-[240px]'
        }`}
      >
        <div className="bg-neutral-900/90 border border-neutral-700/80 rounded-xl p-2 sm:p-3 shadow-2xl flex flex-col gap-1.5">
          {/* Tank HP bar */}
          <div className="flex flex-col gap-0.5">
            <div className="flex justify-between items-center text-[10px] sm:text-xs">
              <span className="font-bold text-neutral-400">МІЦНІСТЬ</span>
              <span className="font-mono font-bold text-emerald-400 tabular-nums">
                {player ? player.currentHP : 0} / {player ? player.maxHP : 0}
              </span>
            </div>
            <div className="w-full h-2 sm:h-3 bg-neutral-800 rounded-full overflow-hidden border border-neutral-700">
              <div
                className={`h-full transition-all duration-200 ${
                  playerHpRatio > 0.5
                    ? 'bg-emerald-500'
                    : playerHpRatio > 0.25
                    ? 'bg-amber-500'
                    : 'bg-rose-600'
                }`}
                style={{ width: `${playerHpRatio * 100}%` }}
              />
            </div>
          </div>

          {/* Speedometer */}
          <div className="flex items-center justify-between border-t border-neutral-800 pt-1">
            <div className="flex items-baseline gap-1">
              <span className="text-lg sm:text-2xl font-black font-mono text-white tabular-nums">
                {speedKmh}
              </span>
              <span className="text-[10px] sm:text-xs text-neutral-400 font-medium">км/г</span>
            </div>

            {/* Module damage badges */}
            <div className="flex items-center gap-1">
              {player && player.isFlipped && (
                <div className="bg-amber-950 border border-amber-500 text-amber-300 text-[9px] sm:text-[10px] font-black px-2 py-0.5 rounded">
                  ПЕРЕВЕРНУТО ({Math.ceil(player.flipTimer)}с / [R])
                </div>
              )}
              {player && player.tracksDamaged ? (
                <div className="bg-rose-950 border border-rose-600 text-rose-300 text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                  <Wrench className="w-2.5 h-2.5 text-rose-400" />
                  ГУС. {Math.ceil(player.tracksRepairTimer)}с
                </div>
              ) : (
                <div className="text-neutral-500 text-[9px] sm:text-[10px] font-medium">
                  Хід норма
                </div>
              )}
            </div>
          </div>

          {/* Internal Modules & Crew Status Grid */}
          {player && (
            <div className="border-t border-neutral-800 pt-1.5 flex flex-col gap-1">
              <div className="grid grid-cols-4 gap-1 text-[9px] font-bold">
                {(
                  [
                    ['Двиг', player.modules.engine],
                    ['БК', player.modules.ammoRack],
                    ['Гарм', player.modules.gun],
                    ['Вежа', player.modules.turretRing],
                    ['Бак', player.modules.fuelTank],
                    ['Опт', player.modules.optics],
                    ['Гус', player.tracksDamaged ? 'destroyed' : player.modules.tracks],
                  ] as const
                ).map(([label, state]) => (
                  <div
                    key={label}
                    className={`px-1 py-0.5 rounded text-center border ${
                      state === 'destroyed'
                        ? 'bg-rose-950/90 border-rose-500 text-rose-300'
                        : state === 'damaged'
                        ? 'bg-amber-950/90 border-amber-500 text-amber-300'
                        : 'bg-neutral-800/70 border-neutral-700/60 text-neutral-400'
                    }`}
                  >
                    {label}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-1 text-[9px] font-medium">
                {(
                  [
                    ['Ком', player.crew.commander],
                    ['Нав', player.crew.gunner],
                    ['Мех', player.crew.driver],
                    ['Зар', player.crew.loader],
                  ] as const
                ).map(([label, state]) => (
                  <div
                    key={label}
                    className={`px-1 py-0.5 rounded text-center border ${
                      state === 'injured'
                        ? 'bg-rose-950/90 border-rose-500 text-rose-300 font-bold'
                        : 'bg-neutral-900/80 border-neutral-800 text-neutral-500'
                    }`}
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Desktop-only Ammo & Consumables Selector */}
        {!isTouchDevice && (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-1.5 bg-neutral-900/90 border border-neutral-700/80 p-1.5 rounded-xl">
              {(['AP', 'APCR', 'HE'] as ShellType[]).map((type, idx) => {
                const count = player ? player.shellsRemaining[type] : 0;
                const isSelected = player ? player.activeShell === type : false;

                return (
                  <button
                    key={type}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      if (player) player.activeShell = type;
                    }}
                    className={`px-2.5 py-1.5 rounded-lg flex flex-col items-center gap-0.5 border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-amber-600/30 border-amber-500 text-amber-300 font-bold'
                        : 'bg-neutral-800/80 border-neutral-700 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-[10px] opacity-70">[{idx + 1}]</span>
                      <span>{type}</span>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Consumables [4] [5] [6] */}
            {player && (
              <div className="flex items-center gap-1.5 bg-neutral-900/90 border border-neutral-700/80 p-1.5 rounded-xl">
                <button
                  onClick={(e) => {
                    e.currentTarget.blur();
                    engine.useConsumable('repairKit');
                  }}
                  className={`px-2 py-1.5 rounded-lg flex flex-col items-center border cursor-pointer text-[10px] ${
                    player.consumableCooldowns.repairKit > 0
                      ? 'bg-neutral-900 border-neutral-800 text-neutral-500'
                      : player.tracksDamaged ||
                        player.engineDamaged ||
                        player.gunDamaged ||
                        Object.values(player.modules).some((m) => m !== 'intact')
                      ? 'bg-amber-600/30 border-amber-400 text-amber-200 font-bold'
                      : 'bg-neutral-800/80 border-neutral-700 text-neutral-300'
                  }`}
                  title="Ремкомплект [4]"
                >
                  <span className="font-bold">[4] Рем</span>
                  <span className="font-mono text-[9px]">
                    {player.consumableCooldowns.repairKit > 0
                      ? `${Math.ceil(player.consumableCooldowns.repairKit)}с`
                      : 'Готово'}
                  </span>
                </button>

                <button
                  onClick={(e) => {
                    e.currentTarget.blur();
                    engine.useConsumable('medKit');
                  }}
                  className={`px-2 py-1.5 rounded-lg flex flex-col items-center border cursor-pointer text-[10px] ${
                    player.consumableCooldowns.medKit > 0
                      ? 'bg-neutral-900 border-neutral-800 text-neutral-500'
                      : Object.values(player.crew).some((c) => c === 'injured')
                      ? 'bg-sky-600/30 border-sky-400 text-sky-200 font-bold'
                      : 'bg-neutral-800/80 border-neutral-700 text-neutral-300'
                  }`}
                  title="Аптечка [5]"
                >
                  <span className="font-bold">[5] Мед</span>
                  <span className="font-mono text-[9px]">
                    {player.consumableCooldowns.medKit > 0
                      ? `${Math.ceil(player.consumableCooldowns.medKit)}с`
                      : 'Готово'}
                  </span>
                </button>

                <button
                  onClick={(e) => {
                    e.currentTarget.blur();
                    engine.useConsumable('fireExtinguisher');
                  }}
                  className={`px-2 py-1.5 rounded-lg flex flex-col items-center border cursor-pointer text-[10px] ${
                    player.consumableCooldowns.fireExtinguisher > 0
                      ? 'bg-neutral-900 border-neutral-800 text-neutral-500'
                      : player.isOnFire
                      ? 'bg-orange-600/40 border-orange-400 text-orange-200 font-bold'
                      : 'bg-neutral-800/80 border-neutral-700 text-neutral-300'
                  }`}
                  title="Вогнегасник [6]"
                >
                  <span className="font-bold">[6] Вог</span>
                  <span className="font-mono text-[9px]">
                    {player.consumableCooldowns.fireExtinguisher > 0
                      ? `${Math.ceil(player.consumableCooldowns.fireExtinguisher)}с`
                      : 'Готово'}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 5. MINIMAP */}
      <div
        className={`absolute pointer-events-auto ${
          isTouchDevice
            ? 'top-14 right-2'
            : 'bottom-4 right-6'
        }`}
      >
        <div className="bg-neutral-950/95 border border-neutral-700 rounded-lg p-1.5 shadow-2xl relative">
          <div className="flex justify-between items-center mb-1 text-[9px] text-neutral-400 px-1">
            <span className="font-bold flex items-center gap-1">
              <MapIcon className="w-2.5 h-2.5 text-amber-400" />
              Радар 15v15
            </span>
            {isTouchDevice && (
              <button
                onClick={() => setIsMinimapOpen((v) => !v)}
                className="text-neutral-400 hover:text-white cursor-pointer"
              >
                {isMinimapOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>

          {isMinimapOpen && (
            <div
              className="bg-neutral-900 rounded overflow-hidden relative border border-neutral-800"
              style={{ width: `${minimapPx}px`, height: `${minimapPx}px` }}
            >
              {/* Grid Coordinates (Lines) */}
              <div className="absolute inset-0 grid grid-cols-4 grid-rows-4 opacity-15 pointer-events-none">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className="border border-white/20" />
                ))}
              </div>

              {/* Green Base Zone */}
              {(() => {
                const gb = toMinimap(engine.mapData.greenBase.x, engine.mapData.greenBase.z);
                return (
                  <div
                    className="absolute w-4 h-4 rounded-full border border-emerald-500 bg-emerald-500/20 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none"
                    style={{ left: `${gb.x}px`, top: `${gb.y}px` }}
                  >
                    <span className="text-[8px] font-black text-emerald-400">Б1</span>
                  </div>
                );
              })()}

              {/* Red Base Zone */}
              {(() => {
                const rb = toMinimap(engine.mapData.redBase.x, engine.mapData.redBase.z);
                return (
                  <div
                    className="absolute w-4 h-4 rounded-full border border-rose-500 bg-rose-500/20 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none"
                    style={{ left: `${rb.x}px`, top: `${rb.y}px` }}
                  >
                    <span className="text-[8px] font-black text-rose-400">Б2</span>
                  </div>
                );
              })()}

              {/* Tanks Markers (15 Allied + Spotted Enemy) */}
              {engine.participants.map((tank) => {
                if (!tank.isAlive) return null;
                // Only draw enemy if spotted
                if (tank.team === 'red' && !tank.isSpotted) return null;

                const pos = toMinimap(tank.x, tank.z);
                const isPlayerTank = tank.isPlayer;

                return (
                  <div
                    key={tank.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-75"
                    style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
                  >
                    {isPlayerTank ? (
                      <div className="relative flex items-center justify-center">
                        <div className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 rounded-full bg-white border-2 border-emerald-500 shadow-[0_0_6px_#fff]" />
                        {/* Heading needle accurately oriented to Three.js world forward */}
                        <div
                          className="absolute w-0.5 h-2.5 sm:h-3.5 bg-amber-300 origin-bottom -top-2 sm:-top-2.5"
                          style={{ transform: `rotate(${Math.PI - tank.rotationY}rad)` }}
                        />
                      </div>
                    ) : tank.team === 'green' ? (
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-sm bg-emerald-400 border border-emerald-600 shadow-[0_0_3px_#10b981]" />
                    ) : (
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-sm bg-rose-500 border border-rose-700 shadow-[0_0_4px_#ef4444]" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 6. BOTTOM CONTROL HINT DOCK (Desktop only) */}
      {!isTouchDevice && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-auto max-w-[54vw]">
          <div className="bg-neutral-900/90 border border-neutral-700/80 rounded-lg px-3 py-1.5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[10px] xl:text-[11px] text-neutral-300 shadow-xl">
            {isPointerLocked ? (
              <span className="flex items-center gap-1 text-emerald-400 font-bold">
                <Lock className="w-3 h-3" />
                Миша захоплена [ESC]
              </span>
            ) : pointerLockBlocked ? (
              <span className="flex items-center gap-1 text-amber-300 font-bold">
                <Unlock className="w-3 h-3" />
                Вільний приціл мишею
              </span>
            ) : (
              <button
                onClick={(e) => {
                  e.currentTarget.blur();
                  onRequestMouseLock();
                }}
                className="flex items-center gap-1 bg-amber-600/25 hover:bg-amber-600/40 border border-amber-500/70 text-amber-300 font-bold px-2 py-0.5 rounded cursor-pointer"
              >
                <Lock className="w-3 h-3" />
                Mouse Lock [M]
              </button>
            )}
            <span className="text-neutral-600">|</span>
            <span><strong className="text-amber-400">WASD</strong> Рух</span>
            <span><strong className="text-amber-400">Миша</strong> Приціл</span>
            <span><strong className="text-amber-400">ЛКМ/F</strong> Постріл</span>
            <span><strong className="text-amber-400">Space</strong> Ручник</span>
            <span><strong className="text-amber-400">Shift/ПКМ</strong> Снайпер</span>
            <span><strong className="text-amber-400">1-3</strong> Снаряди</span>
            <span><strong className="text-amber-400">4-6</strong> Спорядж.</span>
            <span><strong className="text-amber-400">Tab</strong> 15v15</span>
          </div>
        </div>
      )}

      {/* 7. MOBILE TOUCH CONTROLS (Rendered whenever touch / mobile device is active) */}
      {isTouchDevice && (
        <MobileControls engine={engine} isPortrait={deviceInfo.isPortrait} />
      )}

      {/* 8. FULL 15 vs 15 TEAM ROSTER OVERLAY (Activated on Tab or Roster Button) */}
      {showRoster && (
        <div className="absolute inset-0 bg-black/85 flex items-center justify-center p-3 sm:p-6 z-50 pointer-events-auto">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 sm:p-6 w-full max-w-4xl shadow-2xl flex flex-col gap-3 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-neutral-700 pb-2.5">
              <div>
                <h2 className="text-base sm:text-lg font-black text-amber-400">СКЛАД КОМАНД 15 НА 15</h2>
                <p className="text-[10px] sm:text-xs text-neutral-400">
                  Карта: {engine.mapData.nameUk} • Режим: Стандартний Бій
                </p>
              </div>
              <button
                onClick={() => setShowRoster(false)}
                className="text-xs bg-amber-600 hover:bg-amber-500 text-neutral-950 font-bold px-3 py-1 rounded cursor-pointer"
              >
                Закрити
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Green Allies */}
              <div className="flex flex-col gap-1">
                <div className="text-[11px] sm:text-xs font-bold text-emerald-400 border-b border-emerald-900/60 pb-1 flex justify-between">
                  <span>СОЮЗНИКИ (ЗЕЛЕНІ)</span>
                  <span>ШКОДА / ФРАГИ</span>
                </div>
                {engine.participants
                  .filter((p) => p.team === 'green')
                  .map((p) => (
                    <div
                      key={p.id}
                      className={`text-[10px] sm:text-xs px-2 py-1 rounded flex justify-between items-center border ${
                        p.isPlayer
                          ? 'bg-emerald-950/80 border-emerald-500 font-bold text-emerald-200'
                          : p.isAlive
                          ? 'bg-neutral-800/60 border-neutral-700/60 text-neutral-200'
                          : 'bg-neutral-900/40 border-neutral-800 text-neutral-500 line-through'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-neutral-400">[{p.tankDef.tier}]</span>
                        <span className="truncate max-w-[110px] sm:max-w-none">{p.name}</span>
                        <span className="text-[9px] text-neutral-400 hidden sm:inline">({p.tankDef.name})</span>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 font-mono">
                        <span className="text-amber-400">{p.damageDealt}</span>
                        <span className="text-rose-400">{p.kills} к</span>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Red Enemies */}
              <div className="flex flex-col gap-1">
                <div className="text-[11px] sm:text-xs font-bold text-rose-400 border-b border-rose-900/60 pb-1 flex justify-between">
                  <span>ВОРОГИ (ЧЕРВОНІ)</span>
                  <span>ШКОДА / ФРАГИ</span>
                </div>
                {engine.participants
                  .filter((p) => p.team === 'red')
                  .map((p) => (
                    <div
                      key={p.id}
                      className={`text-[10px] sm:text-xs px-2 py-1 rounded flex justify-between items-center border ${
                        p.isAlive
                          ? 'bg-neutral-800/60 border-neutral-700/60 text-neutral-200'
                          : 'bg-neutral-900/40 border-neutral-800 text-neutral-500 line-through'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-neutral-400">[{p.tankDef.tier}]</span>
                        <span className="truncate max-w-[110px] sm:max-w-none">{p.name}</span>
                        <span className="text-[9px] text-neutral-400 hidden sm:inline">({p.tankDef.name})</span>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 font-mono">
                        <span className="text-amber-400">{p.damageDealt}</span>
                        <span className="text-rose-400">{p.kills} к</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
