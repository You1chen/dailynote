export const DEFAULT_AVATAR = '👤';

export function isAvatarImage(avatar: string) {
  return avatar.startsWith('data:image/');
}

export function canPreviewAvatar(avatar: string) {
  return Boolean(avatar?.trim() && avatar.trim() !== DEFAULT_AVATAR);
}
