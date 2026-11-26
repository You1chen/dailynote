export interface NavigationBadgeCounts {
  ddlBadge?: number;
  importantBadge?: number;
}

export const badgeDestinations = {
  ddl: { to: '/ddl', label: 'DDL' },
  important: { to: '/important', label: '重要' },
} as const;

export function navigationBadges({ ddlBadge, importantBadge }: NavigationBadgeCounts) {
  return [
    { ...badgeDestinations.ddl, count: ddlBadge ?? 0 },
    { ...badgeDestinations.important, count: importantBadge ?? 0 },
  ];
}

export function sumBadges(items: ReadonlyArray<{ count?: number }>): number {
  return items.reduce((total, item) => total + (item.count ?? 0), 0);
}
