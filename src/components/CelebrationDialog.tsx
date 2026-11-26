import './CelebrationDialog.css';

/** 撒落的小纸片（纯装饰） */
const CONFETTI: { left: string; delay: string; duration: string; color: string; rotate: string; size: number }[] = [
  { left: '12%', delay: '0s', duration: '1.6s', color: '#6366f1', rotate: '18deg', size: 6 },
  { left: '24%', delay: '0.25s', duration: '1.9s', color: '#f59e0b', rotate: '-22deg', size: 5 },
  { left: '38%', delay: '0.1s', duration: '1.7s', color: '#ec4899', rotate: '40deg', size: 5 },
  { left: '52%', delay: '0.35s', duration: '2s', color: '#10b981', rotate: '-10deg', size: 6 },
  { left: '66%', delay: '0.05s', duration: '1.8s', color: '#6366f1', rotate: '25deg', size: 5 },
  { left: '78%', delay: '0.3s', duration: '1.6s', color: '#f59e0b', rotate: '-35deg', size: 6 },
  { left: '88%', delay: '0.15s', duration: '2.1s', color: '#ec4899', rotate: '12deg', size: 4 },
];

/** 插画：一颗笑眯眯的星星，周围有光晕、星星碎片和纸屑 */
function CelebrationArt() {
  return (
    <svg className="celebration-art" viewBox="0 0 200 150" aria-hidden="true">
      <defs>
        <radialGradient id="celebration-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="celebration-face" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>

      <circle cx="100" cy="80" r="68" fill="url(#celebration-glow)" />

      {/* 星星本体：同色描边 + round linejoin 做出圆角 */}
      <path
        d="M100 30 L113.5 63.4 L149.5 65.9 L121.9 89.1 L130.6 124.1 L100 105 L69.4 124.1 L78.1 89.1 L50.5 65.9 L86.5 63.4 Z"
        fill="url(#celebration-face)"
        stroke="#f59e0b"
        strokeWidth="12"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* 脸 */}
      <circle cx="88" cy="80" r="4.6" fill="#92400e" />
      <circle cx="112" cy="80" r="4.6" fill="#92400e" />
      <path d="M87 92 Q100 103 113 92" stroke="#92400e" strokeWidth="4.6" fill="none" strokeLinecap="round" />
      <circle cx="79" cy="90" r="4" fill="#fb7185" opacity="0.5" />
      <circle cx="121" cy="90" r="4" fill="#fb7185" opacity="0.5" />

      {/* 四角星碎片 */}
      <g fill="#6366f1">
        <path d="M38 34 Q40.2 40.8 47 43 Q40.2 45.2 38 52 Q35.8 45.2 29 43 Q35.8 40.8 38 34 Z" />
      </g>
      <g fill="#ec4899">
        <path d="M162 42 Q163.8 47.2 169 49 Q163.8 50.8 162 56 Q160.2 50.8 155 49 Q160.2 47.2 162 42 Z" />
      </g>
      <g fill="#10b981">
        <path d="M156 106 Q157.5 110.5 162 112 Q157.5 113.5 156 118 Q154.5 113.5 150 112 Q154.5 110.5 156 106 Z" />
      </g>
      <g fill="#f59e0b">
        <path d="M40 104 Q41.5 108.5 46 110 Q41.5 111.5 40 116 Q38.5 111.5 34 110 Q38.5 108.5 40 104 Z" />
      </g>

      {/* 纸屑 */}
      <rect x="0" y="0" width="10" height="5" rx="2.5" fill="#6366f1" opacity="0.9" transform="translate(26,78) rotate(-26)" />
      <rect x="0" y="0" width="10" height="5" rx="2.5" fill="#ec4899" opacity="0.9" transform="translate(164,74) rotate(32)" />
      <rect x="0" y="0" width="8" height="4" rx="2" fill="#10b981" opacity="0.9" transform="translate(44,20) rotate(14)" />
      <rect x="0" y="0" width="8" height="4" rx="2" fill="#f59e0b" opacity="0.9" transform="translate(152,16) rotate(-18)" />
      <rect x="0" y="0" width="7" height="3.5" rx="1.75" fill="#6366f1" opacity="0.75" transform="translate(100,136) rotate(8)" />
    </svg>
  );
}

interface Props {
  open: boolean;
  /** 完成的任务条数 */
  count: number;
  onClose: () => void;
}

export default function CelebrationDialog({ open, count, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="celebration-mask" onClick={onClose}>
      <div
        className="celebration-card"
        role="dialog"
        aria-modal="true"
        aria-label="任务全部完成"
        onClick={e => e.stopPropagation()}
      >
        <span className="celebration-confetti" aria-hidden="true">
          {CONFETTI.map((c, i) => (
            <i
              key={i}
              style={{
                left: c.left,
                width: c.size,
                height: c.size * 0.55,
                background: c.color,
                animationDelay: c.delay,
                animationDuration: c.duration,
                ['--celebrate-rotate' as string]: c.rotate,
              }}
            />
          ))}
        </span>

        <CelebrationArt />

        <h3 className="celebration-title">全部完成</h3>
        <p className="celebration-count">共 {count} 件</p>

        <button className="celebration-btn" onClick={onClose}>收下这份庆祝</button>
      </div>
    </div>
  );
}
