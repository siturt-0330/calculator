import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  try {
    const { user_id } = await req.json()

    const { data: profile } = await supabase
      .from('profiles')
      .select('post_count, comment_count, like_received_count, created_at')
      .eq('id', user_id)
      .single()

    if (!profile) {
      return new Response(JSON.stringify({ score: 50 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Trust score calculation
    const daysSince = Math.floor(
      (Date.now() - new Date(profile.created_at as string).getTime()) / (1000 * 60 * 60 * 24)
    )
    const accountAgeFactor = Math.min(daysSince / 30, 1) * 20  // max 20 pts
    const postFactor = Math.min((profile.post_count as number) / 10, 1) * 30  // max 30 pts
    const likeFactor = Math.min((profile.like_received_count as number) / 20, 1) * 30  // max 30 pts
    const commentFactor = Math.min((profile.comment_count as number) / 20, 1) * 20  // max 20 pts

    const score = Math.round(accountAgeFactor + postFactor + likeFactor + commentFactor)

    await supabase.from('profiles').update({ trust_score: score }).eq('id', user_id)

    return new Response(JSON.stringify({ score }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch {
    return new Response(JSON.stringify({ score: 50 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
