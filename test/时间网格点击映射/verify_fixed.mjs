// 验证修复后的 forward ↔ reverse 是否互逆

function timeToMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

// ===== 修复后的 DailyPlan.tsx minutesToTop =====
function fixed_dp_minutesToTop(minutes, hideSleep, sleepStart, sleepEnd, HOUR_HEIGHT) {
  const SLEEP_BAR_H = hideSleep ? 28 : 0;
  if (!hideSleep) return (minutes / 60) * HOUR_HEIGHT;
  const s = timeToMinutes(sleepStart), e = timeToMinutes(sleepEnd);
  const crosses = e < s;
  if (crosses) {
    if (minutes >= e && minutes < s) return ((minutes - e) / 60) * HOUR_HEIGHT + SLEEP_BAR_H;
    return -1;
  } else {
    if (minutes < s) return (minutes / 60) * HOUR_HEIGHT + SLEEP_BAR_H;  // FIXED
    if (minutes >= e) return ((minutes - (e - s)) / 60) * HOUR_HEIGHT + SLEEP_BAR_H;
    return -1;
  }
}

// ===== 修复后的 DailyPlan.tsx handleGridClick 逆向 =====
function fixed_dp_clickToMinutes(y, hideSleep, sleepStart, sleepEnd, HOUR_HEIGHT) {
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
    if (m >= s) m += sleepDurationMin;  // FIXED
  } else {
    m = (y * 60) / HOUR_HEIGHT;
  }
  return Math.round(m / 5) * 5;
}

// ===== 修复后的 FullscreenSchedule.tsx handleGridClick 逆向 =====
function fixed_fs_clickToMinutes(y, hideSleep, sleepStart, sleepEnd, HOUR_HEIGHT) {
  const s = timeToMinutes(sleepStart), e = timeToMinutes(sleepEnd);
  const crosses = e < s;
  const sleepDurationMin = crosses ? (1440 - s) + e : e - s;

  if (hideSleep) {
    const adj = y - 28;
    if (adj < 0) return null;
    let m;
    if (crosses) {
      m = (adj * 60) / HOUR_HEIGHT + e;
      if (m >= 1440) m -= 1440;
      if (m >= s) m = s - 5;
    } else {
      m = (adj * 60) / HOUR_HEIGHT;
      if (m >= s) m += sleepDurationMin;  // FIXED
    }
    return Math.round(m / 5) * 5;
  }
  return Math.round((y * 60) / HOUR_HEIGHT / 5) * 5;
}

const scenarios = [
  { name: '跨夜 23-07 (默认)', sleepStart: '23:00', sleepEnd: '07:00', hideSleep: true },
  { name: '不跨夜 01-08', sleepStart: '01:00', sleepEnd: '08:00', hideSleep: true },
  { name: '不跨夜 13-14', sleepStart: '13:00', sleepEnd: '14:00', hideSleep: true },
  { name: '不隐藏睡眠', sleepStart: '23:00', sleepEnd: '07:00', hideSleep: false },
];

let totalErrors = 0;
for (const sc of scenarios) {
  const crosses = timeToMinutes(sc.sleepEnd) < timeToMinutes(sc.sleepStart);
  const s = timeToMinutes(sc.sleepStart), e = timeToMinutes(sc.sleepEnd);
  const sleepDur = crosses ? (1440 - s) + e : e - s;
  const visibleHours = [];
  for (let h = 0; h < 24; h++) {
    if (!sc.hideSleep) { visibleHours.push(h); continue; }
    if (crosses) { if (h >= Math.floor(e / 60) && h < Math.floor(s / 60)) visibleHours.push(h); }
    else { if (h < s / 60 || h >= e / 60) visibleHours.push(h); }
  }

  let dpErr = 0, fsErr = 0;
  for (const h of visibleHours) {
    const min = h * 60;
    const top = fixed_dp_minutesToTop(min, sc.hideSleep, sc.sleepStart, sc.sleepEnd, 64);
    if (top < 0) { dpErr++; continue; }

    const dpR = fixed_dp_clickToMinutes(top, sc.hideSleep, sc.sleepStart, sc.sleepEnd, 64);
    if (dpR === null || Math.abs(dpR - min) > 5) dpErr++;

    const fsR = fixed_fs_clickToMinutes(top, sc.hideSleep, sc.sleepStart, sc.sleepEnd, 64);
    if (fsR === null || Math.abs(fsR - min) > 5) fsErr++;
  }

  const status = (dpErr === 0 && fsErr === 0) ? '✅' : '❌';
  console.log(`${status} ${sc.name}: DP错误=${dpErr}, FS错误=${fsErr}`);
  totalErrors += dpErr + fsErr;
}

console.log(`\n总错误: ${totalErrors} ${totalErrors === 0 ? '— 全部修复 ✅' : '— 仍有问题 ❌'}`);
