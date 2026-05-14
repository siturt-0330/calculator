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
    const { content } = await req.json()

    // Basic content moderation rules
    const bannedPatterns = [
      /個人情報/,
      /住所/,
      /電話番号/,
    ]

    const hasBannedContent = bannedPatterns.some(pattern => pattern.test(content as string))

    if (hasBannedContent) {
      return new Response(
        JSON.stringify({ ok: false, reason: '個人情報を含む投稿はできません。' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch {
    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
