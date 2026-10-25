import { useEffect, useState } from 'react';
import { getAllDdls } from '../db';
import { countDdlNear } from '../utils/ddl';


/** 侧栏 DDL 红点数字：剩余不足一周的条数 */
export function useDdlBadge(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await getAllDdls();
        if (!alive) return;
        setCount(countDdlNear(list));
      } catch { /* 读失败就不显示 */ }
    };
    refresh();
    window.addEventListener('dailynote-ddl-changed', refresh);
    return () => {
      alive = false;
      window.removeEventListener('dailynote-ddl-changed', refresh);
    };
  }, []);

  return count;
}
