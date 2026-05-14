const AVATAR_COLORS = [
  '#7C6AF7', '#E24B4A', '#22D3A4', '#F5A623', '#3B82F6',
  '#F472B6', '#9a7acc', '#cca87a',
];

export function randomAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}
