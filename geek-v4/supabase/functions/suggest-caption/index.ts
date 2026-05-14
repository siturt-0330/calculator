import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageUrl, tags } = await req.json()

    // In production, call an AI API here
    // For now return tag-based suggestions
    const tagList = (tags as string[]) ?? []
    const suggestions = tagList.length > 0
      ? [`${tagList[0]}について投稿しました`, `今日の${tagList[0]}`, `#${tagList.join(' #')}`]
      : ['今日の出来事', 'シェアしたいこと', '最近ハマっていること']

    return new Response(
      JSON.stringify({ suggestion: suggestions[0], alternatives: suggestions.slice(1) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch {
    return new Response(
      JSON.stringify({ suggestion: '' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
