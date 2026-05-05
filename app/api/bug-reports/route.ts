/**
 * POST /api/bug-reports
 *
 * Creates a bug report from the Widget Help "Report a bug" form. Optionally
 * uses Claude to auto-assign a priority based on the description, and sends
 * an admin email if priority is high or critical.
 *
 * Request body:
 *   {
 *     title: string (required),
 *     description: string (required),
 *     stepsToReproduce?: string,
 *     expectedBehavior?: string,
 *     browser?: string,
 *     pageUrl?: string,
 *     screenshotUrl?: string
 *   }
 *
 * Response: { bug_report_id, priority }
 *
 * Auth: required.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAnthropicClient } from '@/lib/anthropic';
import { sendAdminBugReportEmail } from '@/lib/email';
import type Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

type Priority = 'low' | 'medium' | 'high' | 'critical';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    title?: string;
    description?: string;
    stepsToReproduce?: string;
    expectedBehavior?: string;
    browser?: string;
    pageUrl?: string;
    screenshotUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const title = (body.title ?? '').trim();
  const description = (body.description ?? '').trim();
  if (!title || !description) {
    return NextResponse.json({ error: 'title_and_description_required' }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json({ error: 'title_too_long' }, { status: 400 });
  }
  if (description.length > 5000) {
    return NextResponse.json({ error: 'description_too_long' }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 403 });
  }
  const workspaceId = membership.workspace_id as string;

  const priority = await classifyBugPriority(title, description);

  const { data: bug, error: insertErr } = await supabase
    .from('bug_reports')
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      title,
      description,
      steps_to_reproduce: body.stepsToReproduce ?? null,
      expected_behavior: body.expectedBehavior ?? null,
      browser: body.browser ?? null,
      page_url: body.pageUrl ?? null,
      screenshot_url: body.screenshotUrl ?? null,
      priority,
      status: 'new',
    })
    .select('id')
    .single();
  if (insertErr || !bug) {
    return NextResponse.json(
      { error: 'insert_failed', detail: insertErr?.message },
      { status: 500 }
    );
  }

  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? 'https://sdr-platform-sigma.vercel.app';
  await sendAdminBugReportEmail({
    bugReportId: bug.id,
    workspaceId,
    userId: user.id,
    title,
    description,
    priority,
    appBaseUrl,
  });

  return NextResponse.json({ bug_report_id: bug.id, priority });
}

async function classifyBugPriority(title: string, description: string): Promise<Priority> {
  try {
    const client = getAnthropicClient();
    const result = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      system:
        'You classify bug reports by priority. Return ONLY one word: "low", "medium", "high", or "critical". No other text. Use "critical" only for: data loss, security issues, app fully broken for many users, payment failures. Use "high" for: a feature broken for an individual user blocking their workflow. Use "medium" for: minor functionality issues. Use "low" for: cosmetic, typos, suggestions disguised as bugs.',
      messages: [
        {
          role: 'user',
          content: `Title: ${title}\n\nDescription: ${description.slice(0, 1500)}`,
        },
      ],
    });
    const text = result.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim()
      .toLowerCase();
    if (text === 'low' || text === 'medium' || text === 'high' || text === 'critical') {
      return text;
    }
    return 'medium';
  } catch {
    return 'medium';
  }
}
