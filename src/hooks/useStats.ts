import { useState, useEffect } from 'react';
import type { DayStats } from '../types';
import { getAllPlans, getAllReflections, getAllHarvests } from '../db';
import { format, subDays, parseISO } from 'date-fns';

export function useStats() {
  const [dayStats, setDayStats] = useState<DayStats[]>([]);
  const [totalReflections, setTotalReflections] = useState(0);
  const [totalHarvests, setTotalHarvests] = useState(0);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    (async () => {
      const plans = await getAllPlans();
      const reflections = await getAllReflections();
      const harvests = await getAllHarvests();

      setTotalReflections(reflections.length);
      setTotalHarvests(harvests.length);

      // 计算每日统计
      const stats: DayStats[] = plans.map(p => {
        const blocks = p.timeBlocks;
        const completedBlocks = blocks.filter(b => b.completed).length;
        // 专注/效率是验收后得分：只统计已评分（>0）的块，未验收块不拉低均值
        const scoredFocus = blocks.filter(b => b.focusScore > 0);
        const scoredEff = blocks.filter(b => b.efficiencyScore > 0);
        const avgFocus = scoredFocus.length > 0 ? scoredFocus.reduce((s, b) => s + b.focusScore, 0) / scoredFocus.length : 0;
        const avgEfficiency = scoredEff.length > 0 ? scoredEff.reduce((s, b) => s + b.efficiencyScore, 0) / scoredEff.length : 0;
        return {
          date: p.date,
          avgFocus: Math.round(avgFocus * 10) / 10,
          avgEfficiency: Math.round(avgEfficiency * 10) / 10,
          completionRate: blocks.length > 0 ? completedBlocks / blocks.length : 0,
          totalBlocks: blocks.length,
          completedBlocks,
        };
      });
      setDayStats(stats);

      // 计算连续打卡天数
      const datesWithPlan = new Set(plans.map(p => p.date));
      let streakCount = 0;
      const today = new Date();
      for (let i = 0; i < 365; i++) {
        const d = format(subDays(today, i), 'yyyy-MM-dd');
        if (datesWithPlan.has(d)) {
          streakCount++;
        } else if (i > 0) {
          break;
        }
      }
      setStreak(streakCount);
    })();
  }, []);

  /** 获取近 N 天数据（含空数据补零） */
  function getRecentDays(days: number): DayStats[] {
    const map = new Map(dayStats.map(s => [s.date, s]));
    const result: DayStats[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const dateStr = format(subDays(today, i), 'yyyy-MM-dd');
      result.push(map.get(dateStr) || {
        date: dateStr,
        avgFocus: 0,
        avgEfficiency: 0,
        completionRate: 0,
        totalBlocks: 0,
        completedBlocks: 0,
      });
    }
    return result;
  }

  /** 本月平均效率 */
  function monthlyAvgEfficiency(): number {
    const now = new Date();
    const thisMonth = format(now, 'yyyy-MM');
    const monthStats = dayStats.filter(s => s.date.startsWith(thisMonth) && s.totalBlocks > 0);
    if (monthStats.length === 0) return 0;
    return Math.round(monthStats.reduce((s, x) => s + x.avgEfficiency, 0) / monthStats.length * 10) / 10;
  }

  return {
    dayStats,
    totalReflections,
    totalHarvests,
    streak,
    getRecentDays,
    monthlyAvgEfficiency,
  };
}
