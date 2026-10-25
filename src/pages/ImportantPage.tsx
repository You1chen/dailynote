import { Star } from 'lucide-react';
import { getAllImportant, saveImportant, deleteImportant } from '../db';
import type { ImportantItem } from '../types';
import DeadlineListPage from '../components/DeadlineListPage';
import { IMPORTANT_KEEP_AFTER_MIN } from '../utils/ddl';

const api = {
  getAll: () => getAllImportant(),
  save: (item: ImportantItem) => saveImportant(item),
  remove: (id: number) => deleteImportant(id),
};

/** 重要的事：与 DDL 同一个页面组件，只是文案不同（三天内冒气泡） */
export default function ImportantPage() {
  return (
    <DeadlineListPage<ImportantItem>
      title="重要的事"
      addLabel="添加"
      nameLabel="名称"
      namePlaceholder="名称"
      emptyTitle="还没有重要的事"
      emptyHint="把快到的重要日子记在这里"
      countText={n => `共 ${n} 件重要的事`}
      icon={Star}
      api={api}
    />
  );
}
