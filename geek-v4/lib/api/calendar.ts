import { supabase } from '../supabase';

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  tag_name: string | null;
  location: string | null;
  source: 'official' | 'personal' | 'proposal';
  vote_count?: number;
  required_votes?: number;
};

export async function fetchMonthEvents(year: number, month: number, tags: string[]): Promise<CalendarEvent[]> {
  const start = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const end = new Date(year, month, 1).toISOString().slice(0, 10);
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;

  // 公式 + 提案昇格イベント (events table)
  const eventsQ = supabase
    .from('events')
    .select('id, title, description, event_date, tag_name, location, is_official')
    .gte('event_date', start)
    .lt('event_date', end);
  if (tags.length > 0) eventsQ.in('tag_name', tags);

  // 個人イベント
  const personalQ = userId
    ? supabase
        .from('personal_events')
        .select('id, title, description, event_date, tag_name, location')
        .eq('user_id', userId)
        .gte('event_date', start)
        .lt('event_date', end)
    : null;

  // 投票中の提案（昇格していないもの）
  const proposalQ = supabase
    .from('event_proposals')
    .select('id, title, description, event_date, tag_name, location, vote_count, required_votes')
    .is('promoted_event_id', null)
    .gte('event_date', start)
    .lt('event_date', end);
  if (tags.length > 0) proposalQ.in('tag_name', tags);

  const [eventsRes, personalRes, proposalRes] = await Promise.all([
    eventsQ,
    personalQ ? personalQ : Promise.resolve({ data: [] }),
    proposalQ,
  ]);

  const out: CalendarEvent[] = [];
  for (const e of (eventsRes.data ?? []) as Array<{ id: string; title: string; description: string | null; event_date: string; tag_name: string | null; location: string | null }>) {
    out.push({ ...e, source: 'official' });
  }
  for (const e of (personalRes.data ?? []) as Array<{ id: string; title: string; description: string | null; event_date: string; tag_name: string | null; location: string | null }>) {
    out.push({ ...e, source: 'personal' });
  }
  for (const e of (proposalRes.data ?? []) as Array<{ id: string; title: string; description: string | null; event_date: string; tag_name: string | null; location: string | null; vote_count: number; required_votes: number }>) {
    out.push({ ...e, source: 'proposal' });
  }
  return out.sort((a, b) => a.event_date.localeCompare(b.event_date));
}

export async function createPersonalEvent(input: {
  title: string;
  description?: string;
  event_date: string;
  tag_name?: string;
  location?: string;
}): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const { error } = await supabase.from('personal_events').insert({
    user_id: userId,
    title: input.title,
    description: input.description ?? null,
    event_date: input.event_date,
    tag_name: input.tag_name ?? null,
    location: input.location ?? null,
  });
  if (error) throw error;
}

export async function createProposal(input: {
  title: string;
  description?: string;
  event_date: string;
  tag_name: string;
  location?: string;
}): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const { error } = await supabase.from('event_proposals').insert({
    proposer_id: userId,
    title: input.title,
    description: input.description ?? null,
    event_date: input.event_date,
    tag_name: input.tag_name,
    location: input.location ?? null,
  });
  if (error) throw error;
}

export async function voteProposal(proposalId: string, vote: boolean): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  if (vote) {
    await supabase.from('event_proposal_votes')
      .insert({ user_id: userId, proposal_id: proposalId });
  } else {
    await supabase.from('event_proposal_votes')
      .delete()
      .eq('user_id', userId)
      .eq('proposal_id', proposalId);
  }
}

export async function getMyVotes(proposalIds: string[]): Promise<Record<string, boolean>> {
  if (proposalIds.length === 0) return {};
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return {};
  const { data } = await supabase
    .from('event_proposal_votes')
    .select('proposal_id')
    .eq('user_id', userId)
    .in('proposal_id', proposalIds);
  const map: Record<string, boolean> = {};
  for (const r of (data ?? []) as Array<{ proposal_id: string }>) {
    map[r.proposal_id] = true;
  }
  return map;
}
