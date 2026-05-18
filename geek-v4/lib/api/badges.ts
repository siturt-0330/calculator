import { supabase } from '@/lib/supabase';

export type BadgeDef = {
  code: string;
  name: string;
  description: string;
  emoji: string;
  tier: 'bronze' | 'silver' | 'gold' | 'rainbow';
  is_secret: boolean;
};

export type UserBadge = BadgeDef & {
  earned_at: string;
};

export async function fetchBadgeDefinitions(): Promise<BadgeDef[]> {
  const { data } = await supabase
    .from('badge_definitions')
    .select('code, name, description, emoji, tier, is_secret')
    .order('tier');
  return (data ?? []) as BadgeDef[];
}

export async function fetchMyBadges(): Promise<UserBadge[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return [];
  const { data } = await supabase
    .from('user_badges')
    .select('badge_code, earned_at, badge_definitions(code, name, description, emoji, tier, is_secret)')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false });
  if (!data) return [];
  return data.map((row: Record<string, unknown>) => {
    const def = row.badge_definitions as BadgeDef | BadgeDef[] | null;
    const d = Array.isArray(def) ? def[0] : def;
    return {
      ...(d as BadgeDef),
      earned_at: row.earned_at as string,
    };
  });
}
