import { supabase } from '../supabase';

export type PollOption = {
  id: string;
  poll_id: string;
  label: string;
  ordinal: number;
  vote_count: number;
};

export type Poll = {
  id: string;
  post_id: string;
  question: string;
  expires_at: string | null;
  multi_select: boolean;
  is_anonymous: boolean;
  total_votes: number;
  options: PollOption[];
  my_vote_option_ids: string[];
};

export async function fetchPolls(postIds: string[]): Promise<Record<string, Poll>> {
  if (postIds.length === 0) return {};
  const { data: session } = await supabase.auth.getSession();
  const myId = session.session?.user.id;

  const { data: polls } = await supabase
    .from('polls')
    .select('id, post_id, question, expires_at, multi_select, is_anonymous, total_votes')
    .in('post_id', postIds);
  if (!polls || polls.length === 0) return {};

  const pollIds = polls.map((p) => (p as { id: string }).id);
  const { data: options } = await supabase
    .from('poll_options')
    .select('id, poll_id, label, ordinal, vote_count')
    .in('poll_id', pollIds)
    .order('ordinal', { ascending: true });

  let myVotes: Array<{ poll_id: string; option_id: string }> = [];
  if (myId) {
    const { data } = await supabase
      .from('poll_votes')
      .select('poll_id, option_id')
      .eq('user_id', myId)
      .in('poll_id', pollIds);
    myVotes = (data ?? []) as typeof myVotes;
  }

  const byPoll: Record<string, Poll> = {};
  for (const p of polls as Array<Omit<Poll, 'options' | 'my_vote_option_ids'>>) {
    byPoll[p.id] = {
      ...p,
      options: [],
      my_vote_option_ids: myVotes.filter((v) => v.poll_id === p.id).map((v) => v.option_id),
    };
  }
  for (const o of (options ?? []) as PollOption[]) {
    byPoll[o.poll_id]?.options.push(o);
  }

  const byPost: Record<string, Poll> = {};
  for (const p of Object.values(byPoll)) {
    byPost[p.post_id] = p;
  }
  return byPost;
}

export async function createPoll(input: {
  postId: string;
  question: string;
  options: string[];
  multiSelect?: boolean;
  expiresInHours?: number;
}): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');

  const expiresAt = input.expiresInHours
    ? new Date(Date.now() + input.expiresInHours * 3600 * 1000).toISOString()
    : null;

  const { data: poll, error } = await supabase
    .from('polls')
    .insert({
      post_id: input.postId,
      question: input.question.trim(),
      expires_at: expiresAt,
      multi_select: !!input.multiSelect,
    })
    .select('id')
    .single();
  if (error) throw error;

  const optRows = input.options
    .map((label, i) => ({
      poll_id: (poll as { id: string }).id,
      label: label.trim(),
      ordinal: i,
    }))
    .filter((o) => o.label.length > 0);
  if (optRows.length > 0) {
    await supabase.from('poll_options').insert(optRows);
  }
}

export async function vote(pollId: string, optionId: string, multiSelect: boolean): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');

  // 単一選択の場合: 既存投票を削除してから新規投票
  if (!multiSelect) {
    await supabase.from('poll_votes').delete().eq('poll_id', pollId).eq('user_id', userId);
  } else {
    // 複数選択: 既存に同じ option があれば取り消し
    const { data: existing } = await supabase
      .from('poll_votes')
      .select('option_id')
      .eq('poll_id', pollId)
      .eq('user_id', userId)
      .eq('option_id', optionId)
      .maybeSingle();
    if (existing) {
      await supabase.from('poll_votes').delete()
        .eq('poll_id', pollId).eq('user_id', userId).eq('option_id', optionId);
      return;
    }
  }
  await supabase.from('poll_votes').insert({ poll_id: pollId, option_id: optionId, user_id: userId });
}
