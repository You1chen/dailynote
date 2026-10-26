import { CalendarClock } from 'lucide-react';
import { getAllDdls, saveDdl, deleteDdl } from '../db';
import type { DdlItem } from '../types';
import DeadlineListPage from '../components/DeadlineListPage';

const api = {
  getAll: () => getAllDdls(),
  save: (item: DdlItem) => saveDdl(item),
  remove: (id: number) => deleteDdl(id),
};

export default function DdlPage() {
  return (
    <DeadlineListPage<DdlItem>
      title="DDL"
      addLabel="添加 DDL"
      nameLabel="事件名称"
      namePlaceholder="事件名称"
      emptyTitle="还没有 DDL"
      emptyHint="点击「添加 DDL」收录带截止时间的事项"
      countText={n => `共 ${n} 个截止事项`}
      icon={CalendarClock}
      allowLinks
      api={api}
    />
  );
}
