import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Instruction = {
  id: string;
  title: string;
  region: string;
  program: string;
  dueDate: string;
  isExpiredOverride: boolean;
  contentHtml: string;
  createdAt: string;
  updatedAt: string;
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function getEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalizeInstruction(x: any): Instruction {
  return {
    id: String(x.id ?? ""),
    title: String(x.title ?? "").trim(),
    region: String(x.region ?? "").trim(),
    program: String(x.program ?? "").trim(),
    dueDate: String(x.dueDate ?? x.due_date ?? "").slice(0, 10),
    isExpiredOverride: Boolean(x.isExpiredOverride ?? x.is_expired_override ?? false),
    contentHtml: String(x.contentHtml ?? x.content_html ?? ""),
    createdAt: String(x.createdAt ?? x.created_at ?? new Date().toISOString()),
    updatedAt: String(x.updatedAt ?? x.updated_at ?? new Date().toISOString()),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("instructions")
        .select(
          "id,title,region,program,due_date,is_expired_override,content_html,created_at,updated_at",
        )
        .order("updated_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);

      const instructions = (data || []).map((r: any) =>
        normalizeInstruction({
          ...r,
          dueDate: r.due_date,
          isExpiredOverride: r.is_expired_override,
          contentHtml: r.content_html,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })
      );

      return json({ version: 1, instructions });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const incoming = normalizeInstruction(body?.instruction ?? {});
      if (!incoming.id || !incoming.title) return json({ error: "Bad request" }, 400);

      const row = {
        id: incoming.id,
        title: incoming.title,
        region: incoming.region,
        program: incoming.program,
        due_date: incoming.dueDate,
        is_expired_override: incoming.isExpiredOverride,
        content_html: incoming.contentHtml,
        created_at: incoming.createdAt,
        updated_at: incoming.updatedAt || new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("instructions")
        .upsert(row, { onConflict: "id" })
        .select(
          "id,title,region,program,due_date,is_expired_override,content_html,created_at,updated_at",
        )
        .single();
      if (error) return json({ error: error.message }, 500);

      return json({
        instruction: normalizeInstruction({
          ...data,
          dueDate: data.due_date,
          isExpiredOverride: data.is_expired_override,
          contentHtml: data.content_html,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        }),
      });
    }

    if (req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      const id = String(body?.id ?? "");
      if (!id) return json({ error: "Bad request" }, 400);

      const { error } = await supabase.from("instructions").delete().eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    return json({ error: e?.message || "Server error" }, 500);
  }
});

