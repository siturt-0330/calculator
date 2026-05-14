import { supabase } from '@/lib/supabase';

type SuggestResult = { caption: string };

export async function suggestCaption({
  imageUri,
  tags,
}: {
  imageUri: string;
  tags: string[];
}): Promise<SuggestResult> {
  const { data, error } = await supabase.functions.invoke('suggest-caption', {
    body: { imageUri, tags },
  });
  if (error) throw error;
  return data as SuggestResult;
}
