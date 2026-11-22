import { useEffect, useState } from 'react';
import { getAllImportant } from '../db';
import { countImportantNear } from '../utils/ddl';

/** 侧栏「重要」红点数字：剩余不足三天的条数（含已过期） */
export function useImportantBadge(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await getAllImportant();
        if (alive) setCount(countImportantNear(list));
      } catch { /* 读失败就不显示 */ }
    };
    refresh();
    window.addEventListener('dailynote-important-changed', refresh);
    return () => {
      alive = false;
      window.removeEventListener('dailynote-important-changed', refresh);
    };
  }, []);

  return count;
}
