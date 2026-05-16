import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SENDING_PREFS } from "@/lib/types/sending-prefs";
import { sendingPreferencesSchema, badRequest } from "@/lib/schemas";

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!member) return NextResponse.json({ prefs: DEFAULT_SENDING_PREFS });

  const { data: profile } = await supabase
    .from("workspace_profiles")
    .select("sending_prefs")
    .eq("workspace_id", member.workspace_id)
    .maybeSingle();

  return NextResponse.json({ prefs: profile?.sending_prefs ?? DEFAULT_SENDING_PREFS });
}

export async function PUT(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let rawBody: unknown
  try { rawBody = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = sendingPreferencesSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { prefs } = parsed.data

  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!member) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const { error } = await supabase
    .from("workspace_profiles")
    .upsert(
      { workspace_id: member.workspace_id, sending_prefs: prefs },
      { onConflict: "workspace_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
