/**
 * Web/PWA 版本更新检测。
 *
 * 为什么需要：Service Worker 的 precache 会继续把旧的 index.html 喂给浏览器，
 * 重新构建后普通刷新看到的仍是旧页面（要硬刷新或等新 SW 接管后再刷一次）。
 * 这里在新版本接管当前页面时通知上层，由 UI 提示点一下刷新。
 * 原生端（APK）没有 Service Worker，直接返回。
 */
export function watchServiceWorkerUpdate(onUpdate: () => void): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;

  // 首次访问时 SW 接管是正常安装，不算「有新版本」
  const hadController = !!sw.controller;
  let fired = false;

  sw.addEventListener('controllerchange', () => {
    if (!hadController || fired) return;
    fired = true;
    onUpdate();
  });

  // 回到前台时顺手查一次更新（只查不刷新）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void sw.getRegistration().then(r => r?.update()).catch(() => { });
  });
}
