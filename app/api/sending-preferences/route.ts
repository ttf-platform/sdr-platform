import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SENDING_PREFS } from "@/lib/types/sending-prefs";

export async function GET() {
  const supabase = await createClient();
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const prefs = body?.prefs;
  if (!prefs) return NextResponse.json({ error: "Missing prefs" }, { status: 400 });

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
