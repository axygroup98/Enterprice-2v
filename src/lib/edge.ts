const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// BLOCO 1 (correção de auditoria): token interno exigido por toda Edge
// Function sensível (ver supabase/functions/_shared/auth.ts). Configure o
// mesmo valor em `supabase secrets set INTERNAL_API_TOKEN=...` e em
// VITE_INTERNAL_API_TOKEN no .env. Ver CORRECTION_REPORT.md para a limitação
// honesta desta abordagem num sistema sem login.
const INTERNAL_TOKEN = import.meta.env.VITE_INTERNAL_API_TOKEN;

function authHeaders(): Record<string, string> {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'x-internal-token': INTERNAL_TOKEN ?? '',
  };
}

export function edgeFunctionUrl(name: string): string {
  return `${FUNCTIONS_URL}/${name}`;
}

export async function callEdgeFunction<T = unknown>(name: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(edgeFunctionUrl(name), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json()) as T;
}

export async function getEdgeFunction<T = unknown>(name: string): Promise<T> {
  const res = await fetch(edgeFunctionUrl(name), { headers: authHeaders() });
  return (await res.json()) as T;
}
