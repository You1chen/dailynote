// 验证原始代码 forward ↔ reverse 是否互逆

function timeToMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

// ===== 原始 DailyPlan.tsx 的 minutesToTop =====
function orig_dp_minutesToTop(minutes, hideSleep, sleepStart, sleepEnd, HOUR_HEIGHT) {
  const SLEEP_BAR_H = hideSleep ? 28 : 0;
  if (!hideSleep) return (minutes / 60) * HOUR_HEIGHT;
  const s = timeToMinutes(sleepStart), e = timeToMinutes(sleepEnd);
  const crosses = e < s;
  if (crosses) {
    if (minutes >= e && minutes <= s) return ((minutes - e) / 60) * HOUR_HEIGHT + SLEEP_BAR_H;
    return -1;
  } else {
    if (minutes < s) return (minutes / 60) * HOUR_HEIGHT;           // ★ 原始: 没有 +SLEEP_BAR_H
    if (minutes >= e) return ((minutes - (e - s)) / 60) * HOUR_HEIGHT + SLEEP_BAR_H;
    return -1;
  }
}

// ===== 原始 DailyPlan.tsx 的 handleGridClick 逆向 =====
function orig_dp_clickToMinutes(y, hideSleep, sleepStart, sleepEnd, HOUR_HEIGHT) {
  const SLEEP_BAR_H = hideSleep ? 28 : 0;
  const s = timeToMinutes(sleepStart), e = timeToMinutes(sleepEnd);
  const crosses = e < s;
  const sleepDurationMin = crosses ? (1440 - s) + e : e - s;

  let m;
  if (hideSleep && crosses) {
    const adj = y - SLEEP_BAR_H;
    if (adj < 0) return null;
    m = (adj * 60) / HOUR_HEIGHT + e;
    if (m >= 1440) m -= 1440;
    if (m >= s) m = s - 5;
  } else if (hideSleep) {
    const adj = y - SLEEP_BAR_H;
    if (adj < 0) return null;
    m = (adj * 60) / HOUR_HEIGHT;
    if (m >= s && m < e) return null;  // ★ 原始: 用压缩空间值比对真实睡眠区间
    if (m >= e) m += sleepDurationMin;
  } else {
    m = (y * 60) / HOUR_HEIGHT;
  }
  return Math.round(m / 5) * 5;
}

// ===== 原始 FullscreenSchedule.tsx 的逆向（不跨夜时也用跨夜公式）=====
function orig_fs_clickToMinutes(y, hideSleep, sleepStart, sleepEnd, HOUR_HEIGHT) {
  const s = timeToMinutes(sleepStart), e = timeToMinutes(sleepEnd);
  const crosses = e < s;
  if (hideSleep) {
    const adj = y - 28;
    if (adj < 0) return null;
    let m = (adj * 60) / HOUR_HEIGHT + e;  // ★ 永远 +e
    if (m >= 1440) m -= 1440;
    if (crosses && m >= s) m = s - 5;
    return Math.round(m / 5) * 5;
  }
  return Math.round((y * 60) / HOUR_HEIGHT / 5) * 5;
}

// ===== 验证：逐个场景测试 forward → reverse 是否还原 =====
const scenarios = [
  { name: '跨夜 23-07', sleepStart: '23:00', sleepEnd: '07:00', hideSleep: true },
  { name: '不跨夜 01-08', sleepStart: '01:00', sleepEnd: '08:00', hideSleep: true },
  { name: '不跨夜 13-14', sleepStart: '13:00', sleepEnd: '14:00', hideSleep: true },
];

for (const sc of scenarios) {
  console.log(`\n=== ${sc.name} (HOUR_HEIGHT=64) ===`);
  const crosses = timeToMinutes(sc.sleepEnd) < timeToMinutes(sc.sleepStart);
  console.log(`跨夜: ${crosses}`);

  // 找出所有可见小时
  const s = timeToMinutes(sc.sleepStart), e = timeToMinutes(sc.sleepEnd);
  const sleepDur = crosses ? (1440 - s) + e : e - s;
  const visibleHours = [];
  for (let h = 0; h < 24; h++) {
    if (crosses) {
      if (h >= Math.floor(e / 60) && h < Math.floor(s / 60)) visibleHours.push(h);
    } else {
      if (h < s / 60 || h >= e / 60) visibleHours.push(h);
    }
  }

  let dpErrors = 0, fsErrors = 0;
  for (const h of visibleHours) {
    const minutes = h * 60;

    // DailyPlan forward
    const dpTop = orig_dp_minutesToTop(minutes, sc.hideSleep, sc.sleepStart, sc.sleepEnd, 64);
    if (dpTop < 0) { console.log(`  DP forward: ${h}:00 → -1 (睡眠区!)`); dpErrors++; continue; }
    const dpReverse = orig_dp_clickToMinutes(dpTop, sc.hideSleep, sc.sleepStart, sc.sleepEnd, 64);
    const dpMatch = dpReverse !== null && Math.abs(dpReverse - minutes) <= 5;

    // Fullscreen forward (same as DP except hardcoded 28)
    const fsTop = orig_dp_minutesToTop(minutes, sc.hideSleep, sc.sleepStart, sc.sleepEnd, 64);
    const fsReverse = orig_fs_clickToMinutes(fsTop, sc.hideSleep, sc.sleepStart, sc.sleepEnd, 64);
    const fsMatch = fsReverse !== null && Math.abs(fsReverse - minutes) <= 5;

    if (!dpMatch) {
      console.log(`  ❌ DP: ${h}:00 → top=${dpTop} → reverse=${dpReverse} (期望 ${minutes})`);
      dpErrors++;
    }
    if (!fsMatch) {
      console.log(`  ❌ FS: ${h}:00 → top=${fsTop} → reverse=${fsReverse} (期望 ${minutes})`);
      fsErrors++;
    }
  }

  console.log(`  DP 错误: ${dpErrors}, FS 错误: ${fsErrors}`);
  if (dpErrors === 0 && fsErrors === 0) console.log(`  ✅ 互逆正确`);
}
