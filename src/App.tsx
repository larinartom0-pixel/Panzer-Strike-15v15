/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BattleSummary, MapData, TankDefinition } from './types.ts';
import { INITIAL_TANKS, BATTLE_MAPS } from './game/tanksData.ts';
import { HangarView } from './components/HangarView.tsx';
import { BattleView } from './components/BattleView.tsx';

const STORAGE_KEY_TANKS = 'panzer_strike_tanks_v1';
const STORAGE_KEY_CURRENCY = 'panzer_strike_currency_v1';
const STORAGE_KEY_STATS = 'panzer_strike_stats_v1';

export default function App() {
  const [gameMode, setGameMode] = useState<'hangar' | 'battle'>('hangar');

  // Load saved progression merged with latest INITIAL_TANKS schema (preserves new tanks & fields)
  const [tanks, setTanks] = useState<TankDefinition[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TANKS);
      if (saved) {
        const parsed = JSON.parse(saved) as TankDefinition[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const savedMap = new Map(parsed.map((t) => [t.id, t]));
          return INITIAL_TANKS.map((baseTank) => {
            const existing = savedMap.get(baseTank.id);
            if (!existing) return baseTank;
            return {
              ...baseTank,
              ...existing,
              researched: existing.researched ?? (existing.unlocked || baseTank.researched),
              requiredTankId: baseTank.requiredTankId,
              gunDepressionDeg: baseTank.gunDepressionDeg,
              gunElevationDeg: baseTank.gunElevationDeg,
            };
          });
        }
      }
    } catch {
      // fallback
    }
    return INITIAL_TANKS;
  });

  const [selectedTankId, setSelectedTankId] = useState<string>('t34_85');

  const [currency, setCurrency] = useState<{ credits: number; xp: number }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CURRENCY);
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return { credits: 45000, xp: 8500 }; // Starter funds
  });

  const [playerStats, setPlayerStats] = useState<{
    battles: number;
    victories: number;
    totalDamage: number;
    totalKills: number;
  }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STATS);
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return { battles: 0, victories: 0, totalDamage: 0, totalKills: 0 };
  });

  const [selectedMap, setSelectedMap] = useState<MapData>(BATTLE_MAPS[0]);

  // Persist progression
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_TANKS, JSON.stringify(tanks));
    } catch {
      // storage error fallback
    }
  }, [tanks]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CURRENCY, JSON.stringify(currency));
    } catch {
      // storage error fallback
    }
  }, [currency]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(playerStats));
    } catch {
      // storage error fallback
    }
  }, [playerStats]);

  const selectedTank = tanks.find((t) => t.id === selectedTankId) || tanks[0];

  const handleUpdateTank = (updatedTank: TankDefinition) => {
    setTanks((prev) => prev.map((t) => (t.id === updatedTank.id ? updatedTank : t)));
  };

  const handleSpendCurrency = (credits: number, xp: number): boolean => {
    if (currency.credits < credits || currency.xp < xp) return false;
    setCurrency((prev) => ({
      credits: prev.credits - credits,
      xp: prev.xp - xp,
    }));
    return true;
  };

  const handleExitToHangar = (summary?: BattleSummary) => {
    if (summary) {
      // Award battle rewards
      setCurrency((prev) => ({
        credits: prev.credits + summary.creditsEarned,
        xp: prev.xp + summary.xpEarned,
      }));

      setPlayerStats((prev) => ({
        battles: prev.battles + 1,
        victories: prev.victories + (summary.result === 'victory' ? 1 : 0),
        totalDamage: prev.totalDamage + summary.playerStats.damageDealt,
        totalKills: prev.totalKills + summary.playerStats.kills,
      }));
    }
    setGameMode('hangar');
  };

  const handleBattleAgain = () => {
    // Re-mount fresh battle instance
    setGameMode('hangar');
    setTimeout(() => {
      setGameMode('battle');
    }, 50);
  };

  return (
    <div className="w-screen h-screen bg-neutral-950 overflow-hidden font-sans select-none">
      {gameMode === 'hangar' ? (
        <HangarView
          tanks={tanks}
          selectedTank={selectedTank}
          onSelectTank={(t) => setSelectedTankId(t.id)}
          onUpdateTank={handleUpdateTank}
          playerCredits={currency.credits}
          playerXP={currency.xp}
          onSpendCurrency={handleSpendCurrency}
          selectedMap={selectedMap}
          onSelectMap={setSelectedMap}
          onStartBattle={() => setGameMode('battle')}
          playerStats={playerStats}
        />
      ) : (
        <BattleView
          playerTank={selectedTank}
          selectedMap={selectedMap}
          onExitToHangar={handleExitToHangar}
          onBattleAgain={handleBattleAgain}
        />
      )}
    </div>
  );
}
