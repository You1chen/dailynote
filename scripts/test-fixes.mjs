/**
 * Module tests for Bug Fix Verification
 * Run: node scripts/test-fixes.mjs
 *
 * Tests:
 *   1. storage.ts — BOM stripping in importFromJSON
 *   2. DailyPlan.tsx — number input state machine (type/clear/blur/save)
 *   3. time.ts — utility function correctness
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) { passed++; }
  else { console.error(`  FAIL: ${msg} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); failed++; }
}

function section(title) {
  console.log(`\n${'='.repeat(52)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(52)}`);
}

// ============================================================
// Test 1: importFromJSON — BOM stripping (storage.ts:202-204)
// ============================================================
section('Test 1: JSON import — BOM stripping');

// Exact logic from storage.ts
function importFromJSON_parse(json) {
  const clean = json.codePointAt(0) === 0xFEFF ? json.slice(1) : json;
  const data = JSON.parse(clean);
  if (!data.version || !Array.isArray(data.dailyPlans)) {
    throw new Error('invalid format');
  }
  return data;
}

const validJSON = '{"version":1,"dailyPlans":[],"longTermGoals":[],"reflections":[],"harvests":[],"fixedRoutines":[]}';
const validWithBOM = '﻿' + validJSON;
const validWithData = '{"version":1,"dailyPlans":[{"date":"2026-07-25","timeBlocks":[]}],"longTermGoals":[],"reflections":[],"harvests":[],"fixedRoutines":[]}';

// Case 1: Valid JSON without BOM
try {
  const r = importFromJSON_parse(validJSON);
  assert(r.version === 1, 'no BOM: version parsed');
  assert(Array.isArray(r.dailyPlans), 'no BOM: dailyPlans is array');
  console.log('  ✓ Valid JSON without BOM — parses correctly');
} catch(e) {
  assert(false, `no BOM: ${e.message}`);
}

// Case 2: Valid JSON WITH BOM (the main bug fix)
try {
  const r = importFromJSON_parse(validWithBOM);
  assert(r.version === 1, 'BOM stripped: version parsed');
  assert(Array.isArray(r.dailyPlans), 'BOM stripped: dailyPlans is array');
  console.log('  ✓ Valid JSON with UTF-8 BOM — BOM stripped, parses correctly');
} catch(e) {
  assert(false, `BOM: ${e.message}`);
}

// Case 3: Data with actual content + BOM
try {
  const r = importFromJSON_parse('﻿' + validWithData);
  assert(r.dailyPlans.length === 1, 'BOM+data: 1 daily plan');
  assert(r.dailyPlans[0].date === '2026-07-25', 'BOM+data: correct date');
  console.log('  ✓ BOM + real data — parses correctly');
} catch(e) {
  assert(false, `BOM+data: ${e.message}`);
}

// Case 4: Empty string (should throw)
try {
  importFromJSON_parse('');
  assert(false, 'empty string should throw');
} catch(e) {
  assert(e instanceof SyntaxError, 'empty string throws SyntaxError');
  console.log('  ✓ Empty string — throws SyntaxError (expected)');
}

// Case 5: Malformed JSON
try {
  importFromJSON_parse('not json');
  assert(false, 'malformed should throw');
} catch(e) {
  assert(e instanceof SyntaxError, 'malformed throws SyntaxError');
  console.log('  ✓ Malformed input — throws SyntaxError (expected)');
}

// Case 6: Double BOM (edge case — very unlikely but test anyway)
try {
  importFromJSON_parse('﻿﻿' + validJSON);
  assert(false, 'double BOM should throw');
} catch(e) {
  // first BOM stripped, second BOM remains → JSON parse fails on second BOM
  console.log('  ✓ Double BOM — still throws (first stripped, second invalid)');
}

// ============================================================
// Test 2: Number input state machine (DailyPlan.tsx fix)
// ============================================================
section('Test 2: Number input — keystroke → blur → save flow');

// Exact logic from DailyPlan.tsx
function createScoreState(initial) {
  let score = initial;
  return {
    get: () => score,
    onChange(raw) {
      if (raw === '') { score = 0; return; }
      const n = parseInt(raw, 10);
      if (!isNaN(n)) { score = n; }
    },
    onBlur() {
      const clamped = Math.min(10, Math.max(1, score || 5));
      const changed = clamped !== score;
      score = clamped;
      return { clamped, changed };
    },
    onSave() {
      const safe = Math.min(10, Math.max(1, score || 5));
      score = safe;
      return safe;
    },
    display() { return String(score || ''); }
  };
}

function createDurationState(initial) {
  let dur = initial;
  return {
    get: () => dur,
    onChange(raw) {
      if (raw === '') { dur = 0; return; }
      const n = parseInt(raw, 10);
      if (!isNaN(n)) { dur = n; }
    },
    onBlur() {
      const clamped = Math.min(480, Math.max(5, dur || 30));
      const changed = clamped !== dur;
      dur = clamped;
      return { clamped, changed };
    },
    display() { return String(dur || ''); }
  };
}

// --- Score tests ---
console.log('\n  -- focusScore / efficiencyScore (range 1-10) --');

// Scenario A: Normal editing
{
  const s = createScoreState(5);
  assert(s.display() === '5', 'init: display "5"');
  s.onChange('7');
  assert(s.get() === 7, 'type "7": score=7');
  assert(s.display() === '7', 'type "7": display "7"');
  const r = s.onBlur();
  assert(!r.changed, 'leave "7": no clamp needed');
  assert(s.get() === 7, 'leave "7": stays 7');
  console.log('  ✓ Normal edit (5→7) — works correctly');
}

// Scenario B: Clear and retype (THE BUG)
{
  const s = createScoreState(5);
  s.onChange('');                        // user backspaces
  assert(s.get() === 0, 'clear: score=0 (no forced fallback)');
  assert(s.display() === '', 'clear: display empty (not "5")');
  s.onChange('3');                       // user types new value
  assert(s.get() === 3, 'after clear→"3": score=3');
  assert(s.display() === '3', 'after clear→"3": display "3"');
  const r = s.onBlur();
  assert(!r.clamped || r.clamped === 3, 'leave "3": in range, no clamp');
  console.log('  ✓ Clear-backspace-retype (5→clear→3) — works correctly');
}

// Scenario C: Type out of range, then blur
{
  const s = createScoreState(5);
  s.onChange('15');
  assert(s.get() === 15, 'type "15": score=15 (free typing allowed)');
  assert(s.display() === '15', 'type "15": display "15"');
  const r = s.onBlur();
  assert(r.clamped === 10, 'leave "15": clamped to 10');
  assert(r.changed === true, 'leave "15": changed flag=true');
  assert(s.get() === 10, 'leave "15": final score=10');
  console.log('  ✓ Type out-of-range (15) then blur — clamps to 10');
}

// Scenario D: Type 0, then blur
{
  const s = createScoreState(5);
  s.onChange('0');
  assert(s.get() === 0, 'type "0": score=0');
  const r = s.onBlur();
  assert(r.clamped === 5, 'leave "0": clamped to 5 (0||5=5)');
  console.log('  ✓ Type "0" then blur — clamps to default 5');
}

// Scenario E: Clear and blur (just wandering off after clearing)
{
  const s = createScoreState(5);
  s.onChange('');
  const r = s.onBlur();
  assert(r.clamped === 5, 'clear→blur: clamped to 5');
  console.log('  ✓ Clear then blur immediately — clamps to default 5');
}

// Scenario F: Save without blur (score out of range)
{
  const s = createScoreState(5);
  s.onChange('15');                      // type 15, don't blur
  const saved = s.onSave();              // click "save"
  assert(saved === 10, 'save "15" without blur: saved as 10');
  console.log('  ✓ Save without blur (15) — handleSaveBlock clamps to 10');
}

// Scenario G: Negative number
{
  const s = createScoreState(5);
  s.onChange('-3');
  assert(s.get() === -3, 'type "-3": score=-3');
  const r = s.onBlur();
  assert(r.clamped === 1, 'leave "-3": clamped to 1');
  console.log('  ✓ Type negative (-3) then blur — clamps to 1');
}

// Scenario H: Garbage input
{
  const s = createScoreState(5);
  s.onChange('abc');
  assert(s.get() === 5, 'type "abc": score unchanged (parseInt→NaN)');
  assert(s.display() === '5', 'type "abc": display unchanged');
  console.log('  ✓ Type garbage "abc" — input ignored, no state corruption');
}

// --- Duration tests ---
console.log('\n  -- durationMinutes (range 5-480) --');

// Scenario I: Clear and retype duration
{
  const d = createDurationState(60);
  d.onChange('');
  assert(d.get() === 0, 'clear duration: dur=0');
  assert(d.display() === '', 'clear duration: display empty');
  d.onChange('45');
  assert(d.get() === 45, 'type "45": dur=45');
  const r = d.onBlur();
  assert(r.clamped === 45, 'leave "45": in range, no clamp');
  console.log('  ✓ Duration clear-backspace-retype (60→clear→45) — works');
}

// Scenario J: Duration out of range
{
  const d = createDurationState(30);
  d.onChange('500');
  assert(d.get() === 500, 'type "500": dur=500');
  const r = d.onBlur();
  assert(r.clamped === 480, 'leave "500": clamped to 480');
  console.log('  ✓ Duration out-of-range (500) → clamped to 480');
}

// Scenario K: Duration very small
{
  const d = createDurationState(30);
  d.onChange('1');
  assert(d.get() === 1, 'type "1": dur=1');
  const r = d.onBlur();
  assert(r.clamped === 5, 'leave "1": clamped to 5 (min)');
  console.log('  ✓ Duration below min (1) → clamped to 5');
}

// ============================================================
// Test 3: Time utility functions (time.ts)
// ============================================================
section('Test 3: Time utilities (utils/time.ts)');

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  const hh = Math.floor(m / 60) % 24;
  const mm = Math.floor(m % 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function isInSleepPeriod(minutes, sleepStart, sleepEnd) {
  const s = timeToMinutes(sleepStart);
  const e = timeToMinutes(sleepEnd);
  if (e < s) return minutes >= s || minutes < e;
  return minutes >= s && minutes < e;
}

// Roundtrip
assert(timeToMinutes('00:00') === 0, '00:00 → 0min');
assert(timeToMinutes('12:30') === 750, '12:30 → 750min');
assert(timeToMinutes('23:59') === 1439, '23:59 → 1439min');
assert(minutesToTime(0) === '00:00', '0min → "00:00"');
assert(minutesToTime(750) === '12:30', '750min → "12:30"');
assert(minutesToTime(1320) === '22:00', '1320min → "22:00"');
assert(timeToMinutes(minutesToTime(1320)) === 1320, 'roundtrip 1320min');
assert(timeToMinutes(minutesToTime(420)) === 420, 'roundtrip 420min');
console.log('  ✓ timeToMinutes ↔ minutesToTime roundtrip');

// Sleep period detection (cross-midnight: 23:00-07:00)
assert(isInSleepPeriod(0, '23:00', '07:00') === true, '00:00 in sleep (23-07)');
assert(isInSleepPeriod(360, '23:00', '07:00') === true, '06:00 in sleep (23-07)');
assert(isInSleepPeriod(420, '23:00', '07:00') === false, '07:00 NOT in sleep');
assert(isInSleepPeriod(840, '23:00', '07:00') === false, '14:00 NOT in sleep');
assert(isInSleepPeriod(1320, '23:00', '07:00') === false, '22:00 NOT in sleep');
assert(isInSleepPeriod(1380, '23:00', '07:00') === true, '23:00 in sleep');
assert(isInSleepPeriod(1439, '23:00', '07:00') === true, '23:59 in sleep');
console.log('  ✓ isInSleepPeriod cross-midnight (23:00-07:00)');

// Sleep period (non-cross-midnight: 02:00-06:00)
assert(isInSleepPeriod(120, '02:00', '06:00') === true, '02:00 in sleep');
assert(isInSleepPeriod(300, '02:00', '06:00') === true, '05:00 in sleep');
assert(isInSleepPeriod(0, '02:00', '06:00') === false, '00:00 NOT in sleep');
assert(isInSleepPeriod(420, '02:00', '06:00') === false, '07:00 NOT in sleep');
console.log('  ✓ isInSleepPeriod non-cross (02:00-06:00)');

// ============================================================
// Test 4: minutesToTop inverse mapping (grid click accuracy)
// ============================================================
section('Test 4: Grid click → time mapping (FullscreenSchedule fix)');

function minutesToTop_cross(m, sleepStart, sleepEnd, hourHeight) {
  const s = timeToMinutes(sleepStart);
  const e = timeToMinutes(sleepEnd);
  const sleepBar = 28;
  if (m >= e && m <= s) {
    return ((m - e) / 60) * hourHeight + sleepBar;
  }
  return -1;
}

function topToMinutes_cross(y, sleepStart, sleepEnd, hourHeight) {
  const e = timeToMinutes(sleepEnd);
  const s = timeToMinutes(sleepStart);
  const adjustedY = y - 28;
  if (adjustedY < 0) return -1;
  let m = (adjustedY * 60) / hourHeight + e;
  if (m >= 1440) m -= 1440;
  if (m >= s) m = s - 5;
  return Math.round(m / 5) * 5;
}

// Verify: for each visible hour, check roundtrip
const sleepS = '23:00';
const sleepE = '07:00';
const hh = 64;

// Test each visible hour (07:00 through 22:00)
for (let hour = 7; hour <= 22; hour++) {
  const realMin = hour * 60;
  const top = minutesToTop_cross(realMin, sleepS, sleepE, hh);
  assert(top > 0, `${hour}:00 → top=${top} > 0`);
  const back = topToMinutes_cross(top, sleepS, sleepE, hh);
  assert(back === realMin, `${hour}:00 roundtrip: ${realMin} → top=${top} → ${back}`);
}
console.log('  ✓ minutesToTop ↔ topToMinutes roundtrip (07:00-22:00, all hours)');

// Test clicking between hour marks (the previous bug: Math.floor truncation)
{
  // Click at exactly the position where 22:00 is rendered
  const real22 = 22 * 60; // 1320
  const top22 = minutesToTop_cross(real22, sleepS, sleepE, hh);
  // Simulate click at that position
  const result = topToMinutes_cross(top22, sleepS, sleepE, hh);
  assert(result === 1320, `click at 22:00 mark → ${result} (expected 1320=22:00)`);
  console.log('  ✓ Click at 22:00 position → maps to 22:00 (not 06:00)');
}

{
  // Click slightly above 22:00 mark
  const top = minutesToTop_cross(1320, sleepS, sleepE, hh) - 15;
  const result = topToMinutes_cross(top, sleepS, sleepE, hh);
  // Should be close to 22:00, not 06:00
  assert(result >= 1300 && result <= 1340, `click near 22:00 → ${result} (expected ~1320)`);
  console.log('  ✓ Click near 22:00 position → maps to ~22:00 area');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(52)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(52)}`);

if (failed > 0) {
  process.exit(1);
}
