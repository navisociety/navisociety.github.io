import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://navisociety.github.io',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const payload = await req.json();
    const { action, email } = payload;

    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing user email' }), { status: 400, headers });
    }

    if (action === 'list') {
      const { data, error } = await supabase
        .from('navi_emails')
        .select('*')
        .eq('user_email', email)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ emails: data ?? [] }), { headers });
    }

    if (action === 'get') {
      const { data, error } = await supabase
        .from('navi_emails')
        .select('*')
        .eq('id', payload.id)
        .eq('user_email', email)
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ email: data }), { headers });
    }

    if (action === 'create') {
      const { data, error } = await supabase
        .from('navi_emails')
        .insert({
          user_email: email,
          recipient: payload.recipient ?? '',
          subject: payload.subject ?? '',
          body: payload.body ?? '',
          status: 'draft',
        })
        .select()
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ email: data }), { headers });
    }

    if (action === 'update') {
      const { data, error } = await supabase
        .from('navi_emails')
        .update({
          recipient: payload.recipient ?? '',
          subject: payload.subject ?? '',
          body: payload.body ?? '',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.id)
        .eq('user_email', email)
        .select()
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ email: data }), { headers });
    }

    if (action === 'send') {
      const recipient = payload.recipient;
      const subject = payload.subject ?? '';
      const body = payload.body ?? '';
      if (!recipient || !body) {
        return new Response(JSON.stringify({ error: 'Recipient and body are required' }), { status: 400, headers });
      }

      const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': Deno.env.get('BREVO_API_KEY')!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'NAVI', email: 'realnavicorp@gmail.com' },
          to: [{ email: recipient }],
          replyTo: { email },
          subject,
          textContent: body,
        }),
      });

      if (!brevoRes.ok) {
        const detail = await brevoRes.text();
        return new Response(JSON.stringify({ error: 'Failed to send email', detail }), { status: 502, headers });
      }

      const nowIso = new Date().toISOString();
      if (payload.id) {
        await supabase
          .from('navi_emails')
          .update({ recipient, subject, body, status: 'sent', sent_at: nowIso, updated_at: nowIso })
          .eq('id', payload.id)
          .eq('user_email', email);
      } else {
        await supabase
          .from('navi_emails')
          .insert({ user_email: email, recipient, subject, body, status: 'sent', sent_at: nowIso });
      }

      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    if (action === 'delete') {
      const { error } = await supabase
        .from('navi_emails')
        .delete()
        .eq('id', payload.id)
        .eq('user_email', email);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), { status: 500, headers });
  }
});
