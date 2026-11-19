import React, { createContext, useContext, useCallback, useRef, useEffect } from 'react';
import { App } from '@capacitor/app';

interface BackButtonContextType {
  /** 注册一个返回键处理器，返回一个取消注册的函数 */
  registerHandler: (handler: () => boolean | void, fallback?: boolean) => () => void;
}

const BackButtonContext = createContext<BackButtonContextType>({
  registerHandler: () => () => {},
});

export function useBackButton() {
  return useContext(BackButtonContext);
}

/**
 * 在组件内注册返回键处理器。
 * 当 Android 返回键被按下时，优先调用最新注册的 handler。
 * 如果 handler 返回 true，表示"我已处理，不要继续回退"。
 * 如果所有 handler 都返回 false/void，则执行系统默认行为（navigate back 或退出）。
 *
 * @param handler - 返回键回调，返回 true 阻止默认行为
 * @param deps - handler 更新的依赖项
 */
export function useRegisterBackHandler(
  handler: () => boolean | void,
  deps: React.DependencyList = [],
  fallback = false,
) {
  const { registerHandler } = useBackButton();

  useEffect(() => {
    // 先注册闭包，让 handler 读取最新值
    const handlerRef = { current: handler };
    const unregister = registerHandler(() => handlerRef.current(), fallback);

    // 当 deps 变化时更新 ref，但不要重新注册
    // 我们用一个小技巧：在 deps 变化时更新 ref
    // eslint-disable-next-line
    handlerRef.current = handler;

    return unregister;
    // registerHandler 是稳定的，这里只需要在 deps 变化时更新闭包
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function BackButtonProvider({ children }: { children: React.ReactNode }) {
  const handlerStackRef = useRef<Array<() => boolean | void>>([]);

  const registerHandler = useCallback((handler: () => boolean | void, fallback = false) => {
    if (fallback) handlerStackRef.current.unshift(handler);
    else handlerStackRef.current.push(handler);
    return () => {
      handlerStackRef.current = handlerStackRef.current.filter(h => h !== handler);
    };
  }, []);

  useEffect(() => {
    // 只在 Capacitor 环境下注册（Android）
    let cleanup: (() => void) | undefined;

    try {
      const listenerPromise = App.addListener('backButton', () => {
        const stack = handlerStackRef.current;
        // 从栈顶（最新注册的）开始调用
        for (let i = stack.length - 1; i >= 0; i--) {
          const result = stack[i]();
          if (result === true) {
            // handler 返回 true 表示已处理
            return;
          }
        }
        // 没有任何 handler 处理，执行默认行为：退出应用
        App.exitApp();
      });
      listenerPromise.then(listener => {
        cleanup = () => listener.remove();
      });
    } catch {
      // 非 Capacitor 环境（浏览器开发），无需处理
    }

    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <BackButtonContext.Provider value={{ registerHandler }}>
      {children}
    </BackButtonContext.Provider>
  );
}
