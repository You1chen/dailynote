import type { SearchHit } from './search';

/** A discovery gesture, not an authentication mechanism. Never trim this input. */
export function hiddenGardenEntries(query: string): SearchHit[] {
  if (query !== '秘密花园 ') return [];
  return [
    { key: 'hidden-garden', title: '秘密花园', snippet: '推开门，留一点时间给自己。', where: '私密空间', route: '/garden' },
    { key: 'hidden-garden-settings', title: '花园设置', snippet: '管理这扇门的密码短语。', where: '私密设置', route: '/garden/settings' },
  ];
}
