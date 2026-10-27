/** 极轻的音效：不加载任何资源，用 Web Audio 合成一声「叮」 */
export function playChime(): void {
  try {
    const Ctor = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const now = ctx.currentTime;

    const tone = (freq: number, delay: number, gain: number) => {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      amp.gain.setValueAtTime(0, now + delay);
      amp.gain.linearRampToValueAtTime(gain, now + delay + 0.01);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.35);
      osc.connect(amp).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.4);
    };

    tone(1046.5, 0, 0.08);   // C6
    tone(1568.0, 0.07, 0.05); // G6

    window.setTimeout(() => { void ctx.close(); }, 600);
  } catch {
    /* 静音环境或浏览器不支持：忽略 */
  }
}
