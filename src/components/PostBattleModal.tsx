/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BattleSummary } from '../types.ts';
import { Trophy, Skull, Coins, Zap, Shield, Target, Award, ArrowRight } from 'lucide-react';

interface PostBattleModalProps {
  summary: BattleSummary;
  onReturnToHangar: () => void;
  onBattleAgain: () => void;
}

export const PostBattleModal: React.FC<PostBattleModalProps> = ({
  summary,
  onReturnToHangar,
  onBattleAgain,
}) => {
  const [activeTab, setActiveTab] = useState<'personal' | 'team'>('personal');

  const isVictory = summary.result === 'victory';
  const isDefeat = summary.result === 'defeat';

  const reasonText =
    summary.reason === 'capture'
      ? isVictory
        ? 'Ворожу базу успішно захоплено!'
        : 'Союзну базу захопив противник!'
      : summary.reason === 'annihilation'
      ? isVictory
        ? 'Усі танки ворога знищено!'
        : 'Усю союзну команду знищено!'
      : 'Час бою вичерпано.';

  const accuracy =
    summary.playerStats.shotsFired > 0
      ? Math.round((summary.playerStats.shotsHit / summary.playerStats.shotsFired) * 100)
      : 0;

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 select-none">
      <div className="bg-neutral-900 border-2 border-neutral-700 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Banner Header */}
        <div
          className={`py-6 px-8 flex flex-col items-center justify-center text-center relative overflow-hidden ${
            isVictory
              ? 'bg-gradient-to-b from-amber-600/40 via-amber-900/30 to-neutral-900 border-b border-amber-500/50'
              : isDefeat
              ? 'bg-gradient-to-b from-rose-700/40 via-rose-950/30 to-neutral-900 border-b border-rose-600/50'
              : 'bg-gradient-to-b from-neutral-700/40 via-neutral-900 to-neutral-900 border-b border-neutral-600'
          }`}
        >
          <div className="flex items-center gap-3">
            {isVictory ? (
              <Trophy className="w-10 h-10 text-amber-400 animate-bounce" />
            ) : (
              <Skull className="w-10 h-10 text-rose-500" />
            )}
            <h1
              className={`text-4xl font-black tracking-wider uppercase ${
                isVictory ? 'text-amber-400' : isDefeat ? 'text-rose-500' : 'text-neutral-300'
              }`}
            >
              {isVictory ? 'ПЕРЕМОГА!' : isDefeat ? 'ПОРАЗКА' : 'НІЧИЯ'}
            </h1>
          </div>
          <p className="text-sm text-neutral-300 mt-1 font-medium">{reasonText}</p>
          <div className="mt-2 text-xs text-neutral-400">
            Рахунок 15v15: <span className="font-bold text-emerald-400">{summary.greenScore}</span> :{' '}
            <span className="font-bold text-rose-400">{summary.redScore}</span> • Тривалість:{' '}
            {Math.floor(summary.durationSeconds / 60)}хв {summary.durationSeconds % 60}с
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-neutral-800 bg-neutral-950 px-6 pt-3 gap-4">
          <button
            onClick={() => setActiveTab('personal')}
            className={`pb-2.5 text-xs font-bold uppercase tracking-wider border-b-2 cursor-pointer transition-colors ${
              activeTab === 'personal'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Особисті Результати та Нагороди
          </button>
          <button
            onClick={() => setActiveTab('team')}
            className={`pb-2.5 text-xs font-bold uppercase tracking-wider border-b-2 cursor-pointer transition-colors ${
              activeTab === 'team'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Командний Залік 15 на 15
          </button>
        </div>

        {/* Content Body */}
        <div className="p-3 sm:p-6 overflow-y-auto flex-1 flex flex-col gap-4 sm:gap-6">
          {activeTab === 'personal' ? (
            <>
              {/* Rewards Box */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-neutral-800/80 border border-neutral-700 rounded-xl p-3 sm:p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                      <Coins className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <div className="text-[10px] sm:text-xs text-neutral-400 uppercase font-bold">
                        Зароблено Кредитів
                      </div>
                      <div className="text-xl sm:text-2xl font-black font-mono text-amber-300 tabular-nums">
                        +{summary.creditsEarned.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] sm:text-xs text-neutral-500">Срібло</span>
                </div>

                <div className="bg-neutral-800/80 border border-neutral-700 rounded-xl p-3 sm:p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
                      <Zap className="w-5 h-5 text-sky-400" />
                    </div>
                    <div>
                      <div className="text-[10px] sm:text-xs text-neutral-400 uppercase font-bold">
                        Отримано Досвіду (XP)
                      </div>
                      <div className="text-xl sm:text-2xl font-black font-mono text-sky-300 tabular-nums">
                        +{summary.xpEarned.toLocaleString()} XP
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] sm:text-xs text-neutral-500">Для прокачки</span>
                </div>
              </div>

              {/* Personal Combat Metrics */}
              <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 sm:p-4 flex flex-col gap-2.5 sm:gap-3">
                <h3 className="text-[10px] sm:text-xs font-bold text-neutral-400 uppercase tracking-wider">
                  Бойова Ефективність
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-center">
                  <div className="bg-neutral-900 border border-neutral-800 p-2 sm:p-2.5 rounded-lg">
                    <div className="text-[10px] sm:text-[11px] text-neutral-400">Нанесено шкоди</div>
                    <div className="text-lg sm:text-xl font-bold font-mono text-amber-400 tabular-nums">
                      {summary.playerStats.damageDealt}
                    </div>
                  </div>
                  <div className="bg-neutral-900 border border-neutral-800 p-2 sm:p-2.5 rounded-lg">
                    <div className="text-[10px] sm:text-[11px] text-neutral-400">Знищено танків</div>
                    <div className="text-lg sm:text-xl font-bold font-mono text-rose-400 tabular-nums">
                      {summary.playerStats.kills}
                    </div>
                  </div>
                  <div className="bg-neutral-900 border border-neutral-800 p-2 sm:p-2.5 rounded-lg">
                    <div className="text-[10px] sm:text-[11px] text-neutral-400">Виявлено ворогів</div>
                    <div className="text-lg sm:text-xl font-bold font-mono text-sky-400 tabular-nums">
                      {summary.playerStats.spotted}
                    </div>
                  </div>
                  <div className="bg-neutral-900 border border-neutral-800 p-2 sm:p-2.5 rounded-lg">
                    <div className="text-[10px] sm:text-[11px] text-neutral-400">Заблоковано бронею</div>
                    <div className="text-lg sm:text-xl font-bold font-mono text-emerald-400 tabular-nums">
                      {summary.playerStats.damageBlocked}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center pt-2">
                  <div className="bg-neutral-900 border border-neutral-800 p-2 rounded-lg">
                    <div className="text-[11px] text-neutral-400">Пострілів / Влучань</div>
                    <div className="text-sm font-bold font-mono text-white tabular-nums">
                      {summary.playerStats.shotsFired} / {summary.playerStats.shotsHit} ({accuracy}%)
                    </div>
                  </div>
                  <div className="bg-neutral-900 border border-neutral-800 p-2 rounded-lg">
                    <div className="text-[11px] text-neutral-400">Пробиттів броні</div>
                    <div className="text-sm font-bold font-mono text-amber-400 tabular-nums">
                      {summary.playerStats.penetrations}
                    </div>
                  </div>
                  <div className="bg-neutral-900 border border-neutral-800 p-2 rounded-lg">
                    <div className="text-[11px] text-neutral-400">Очки захоплення бази</div>
                    <div className="text-sm font-bold font-mono text-blue-400 tabular-nums">
                      {summary.playerStats.capturePoints}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* 15 vs 15 Team Roster Table */
            <div className="grid grid-cols-2 gap-4">
              {/* Green Allies */}
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-bold text-emerald-400 border-b border-emerald-900/60 pb-1 flex justify-between">
                  <span>СОЮЗНИКИ ({summary.greenScore}/15)</span>
                  <span>ШКОДА / ФРАГИ</span>
                </div>
                {summary.teamRoster
                  .filter((p) => p.team === 'green')
                  .sort((a, b) => b.damageDealt - a.damageDealt)
                  .map((p, idx) => (
                    <div
                      key={p.id}
                      className={`text-xs px-2 py-1.5 rounded flex justify-between items-center border ${
                        p.isPlayer
                          ? 'bg-emerald-950/90 border-emerald-500 font-bold text-emerald-200'
                          : p.isAlive
                          ? 'bg-neutral-800/60 border-neutral-700/60 text-neutral-200'
                          : 'bg-neutral-900/40 border-neutral-800 text-neutral-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-neutral-500 font-mono">{idx + 1}.</span>
                        <span>{p.name}</span>
                        <span className="text-[10px] text-neutral-400">({p.tankDef.name})</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono">
                        <span className="text-amber-400">{p.damageDealt}</span>
                        <span className="text-rose-400">{p.kills} к</span>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Red Enemies */}
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-bold text-rose-400 border-b border-rose-900/60 pb-1 flex justify-between">
                  <span>ВОРОГИ ({summary.redScore}/15)</span>
                  <span>ШКОДА / ФРАГИ</span>
                </div>
                {summary.teamRoster
                  .filter((p) => p.team === 'red')
                  .sort((a, b) => b.damageDealt - a.damageDealt)
                  .map((p, idx) => (
                    <div
                      key={p.id}
                      className={`text-xs px-2 py-1.5 rounded flex justify-between items-center border ${
                        p.isAlive
                          ? 'bg-neutral-800/60 border-neutral-700/60 text-neutral-200'
                          : 'bg-neutral-900/40 border-neutral-800 text-neutral-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-neutral-500 font-mono">{idx + 1}.</span>
                        <span>{p.name}</span>
                        <span className="text-[10px] text-neutral-400">({p.tankDef.name})</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono">
                        <span className="text-amber-400">{p.damageDealt}</span>
                        <span className="text-rose-400">{p.kills} к</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-neutral-800 bg-neutral-950 p-4 px-6 flex justify-between items-center">
          <button
            onClick={onReturnToHangar}
            className="px-5 py-2.5 rounded-xl border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-bold cursor-pointer transition-colors"
          >
            Повернутися в Ангар
          </button>

          <button
            onClick={onBattleAgain}
            className="px-6 py-2.5 rounded-xl border border-amber-500 bg-amber-600 hover:bg-amber-500 text-neutral-950 text-sm font-black cursor-pointer shadow-lg shadow-amber-600/30 transition-all flex items-center gap-2"
          >
            <span>В бій знову!</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
