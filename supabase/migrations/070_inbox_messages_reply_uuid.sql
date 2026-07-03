-- Sprint A2 lot 1 — reply-from-inbox.
-- provider_email_uuid = UUID Instantly du message parent, requis pour
-- POST /api/v2/emails/reply (champ `reply_to_uuid`). Distinct de
-- provider_message_id (fuzzy: RFC 5322 Message-ID OU lead_id selon
-- l'event type — voir lib/instantly-webhook-mapping.ts:127 pick(...)).
-- Le nouveau champ est extrait EXPLICITEMENT de data.email_id sur
-- l'event REPLY, seul identifiant accepté par l'endpoint reply.
--
-- Applied to prod 2026-07-02, versioned same sprint.

ALTER TABLE public.inbox_messages
  ADD COLUMN IF NOT EXISTS provider_email_uuid text;

CREATE INDEX IF NOT EXISTS idx_inbox_messages_reply_uuid
  ON public.inbox_messages (workspace_id, provider_email_uuid);

NOTIFY pgrst, 'reload schema';
