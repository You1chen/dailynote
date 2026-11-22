import type { CoreFeatureKey } from '../content/coreFeatures';

/** 帮助与新手引导共用的小插画：只表达形状，文字在旁边说明。 */
export default function FeatureArt({ kind }: { kind: CoreFeatureKey }) {
  if (kind === 'todo') return (
    <svg className="help-art" viewBox="0 0 200 104" aria-hidden="true" focusable="false">
      <rect className="help-art-phone" x="8" y="8" width="184" height="88" rx="12" />
      {[24, 46, 68].map((y, index) => (
        <g key={y}>
          <rect className={index === 1 ? 'help-art-panel' : 'help-art-line'} x="20" y={y} width={index === 1 ? 100 : 132} height="12" rx="6" />
          <circle className="help-art-ring" cx="174" cy={y + 6} r="6" />
        </g>
      ))}
      <circle className="help-art-accent" cx="176" cy="29" r="3" />
      <path className="help-art-arrow" d="M120 84 H166" />
      <path className="help-art-head" d="M160 78 l9 6 -9 6 z" />
      <circle className="help-art-finger" cx="126" cy="84" r="5" />
    </svg>
  );
  if (kind === 'goal') return (
    <svg className="help-art" viewBox="0 0 200 104" aria-hidden="true" focusable="false">
      <circle className="help-art-ring" cx="46" cy="52" r="30" />
      <circle className="help-art-ring" cx="46" cy="52" r="20" />
      <circle className="help-art-accent" cx="46" cy="52" r="8" />
      <rect className="help-art-line" x="92" y="20" width="86" height="12" rx="6" />
      <rect className="help-art-panel" x="92" y="46" width="64" height="12" rx="6" />
      <rect className="help-art-line" x="92" y="72" width="44" height="12" rx="6" />
    </svg>
  );
  if (kind === 'task') return (
    <svg className="help-art" viewBox="0 0 200 104" aria-hidden="true" focusable="false">
      <path className="help-art-arrow" d="M22 8 V96" />
      {[16, 38, 60, 82].map(y => <rect key={y} className="help-art-line" x="22" y={y} width="16" height="3" rx="1.5" />)}
      <rect className="help-art-selection" x="48" y="30" width="140" height="34" rx="8" />
      <rect className="help-art-line" x="62" y="56" width="74" height="6" rx="3" />
      <path className="help-art-arrow" d="M56 84 H176" />
      <path className="help-art-head" d="M170 78 l9 6 -9 6 z" />
    </svg>
  );
  if (kind === 'card') return (
    <svg className="help-art" viewBox="0 0 200 104" aria-hidden="true" focusable="false">
      <rect className="help-art-line" x="30" y="14" width="120" height="76" rx="12" transform="rotate(-4 90 52)" />
      <rect className="help-art-phone" x="44" y="10" width="120" height="80" rx="12" />
      <rect className="help-art-line" x="58" y="26" width="76" height="8" rx="4" />
      <rect className="help-art-line" x="58" y="44" width="92" height="6" rx="3" />
      <rect className="help-art-line" x="58" y="58" width="64" height="6" rx="3" />
      <path className="help-art-accent-stroke" d="M150 84 l22 -22 8 8 -22 22 -10 2 z" />
    </svg>
  );
  return (
    <svg className="help-art" viewBox="0 0 200 104" aria-hidden="true" focusable="false">
      <rect className="help-art-phone" x="14" y="16" width="112" height="82" rx="12" />
      <path className="help-art-arrow" d="M14 38 H126" />
      {[0, 1, 2, 3].map(row => [0, 1, 2].map(col => (
        <rect key={`${row}-${col}`} className={row === 2 && col === 1 ? 'help-art-panel' : 'help-art-line'}
          x={26 + col * 30} y={50 + row * 12} width="22" height="7" rx="3" />
      )))}
      <circle className="help-art-ring" cx="160" cy="66" r="26" />
      <path className="help-art-arrow" d="M160 66 V50 M160 66 H174" />
      <circle className="help-art-accent" cx="160" cy="66" r="4" />
    </svg>
  );
}
