export interface NavigationBadgeCounts {
  ddlBadge?: number;
  importantBadge?: number;
  backlogBadge?: number;
}

export const badgeDestinations = {
  ddl: { to: '/ddl', label: 'DDL' },
  important: { to: '/important', label: '重要' },
  backlog: { to: '/backlog', label: '遗留' },
} as const;

export function navigationBadges({ ddlBadge, importantBadge, backlogBadge }: NavigationBadgeCounts) {
  return [
    { ...badgeDestinations.ddl, count: ddlBadge ?? 0 },
    { ...badgeDestinations.important, count: importantBadge ?? 0 },
    { ...badgeDestinations.backlog, count: backlogBadge ?? 0 },
  ];
}

export function sumBadges(items: ReadonlyArray<{ count?: number }>): number {
  return items.reduce((total, item) => total + (item.count ?? 0), 0);
}
