-- ─────────────────────────────────────────────────────────────────────────────
-- 090 — Morning Coffee Brief : persistance du réglage, envoi at-most-once,
--       réparation de la clé étrangère destinataire, verrouillage RLS
--
-- LOT 1/6 du chantier « rendre le Morning Coffee Brief opérationnel ».
-- Cette migration ne s'accompagne d'AUCUN changement TypeScript. Après
-- application, le produit se comporte exactement comme avant : le bouton
-- « Generate » écrit toujours dans morning_briefs sans nommer les colonnes
-- neuves (elles ont toutes un DEFAULT), l'interrupteur de l'écran reste mort,
-- aucun e-mail ne part. C'est délibéré : le lot suivant peut être révisé sans
-- que la base ait à bouger une seconde fois.
--
-- ÉTAT DE LA PRODUCTION AU 31/07/2026, RELEVÉ AVANT RÉDACTION (lot 0) :
--   morning_briefs = 0 ligne. Aucun doublon (workspace_id, brief_date), aucune
--   ligne à workspace_id NULL, aucune ligne à user_id renseigné. Les trois
--   opérations verrouillantes ci-dessous s'exécutent donc sur une table vide :
--   pas de scan, pas d'attente, pas de risque de rejet.
--   2 workspaces actifs. anon ET authenticated ont INSERT/UPDATE/DELETE sur
--   morning_briefs, et la policy est cmd=ALL sans contrôle d'écriture.
--
-- ═══ CE QUE FAIT CETTE MIGRATION, ET POURQUOI ═══
--
-- A. workspace_profiles : deux colonnes de réglage de livraison
--    `morning_brief_enabled` DEFAULT false — obligatoire. Le cron du lot 4
--    sera mergé avant l'écran du lot 5 ; un DEFAULT true enverrait un e-mail
--    quotidien à des comptes qui n'ont encore AUCUN moyen de le couper.
--    `morning_brief_time` DEFAULT '07:30' — l'heure déjà affichée par l'écran.
--
--    CHECK sur les multiples de 30 minutes : le cron balaie toutes les
--    30 minutes (patron du repo, cf. expire-pending-bookings dans vercel.json).
--    Une heure à 07:12 ne serait jamais servie à la minute promise. La règle
--    vit en base et non seulement dans un Zod ou un `step` de widget : un
--    `<input type="time" step="1800">` est un indice d'interface, pas une
--    garde — le navigateur le contourne, l'API ne le voit pas.
--    La borne `< '24:00'` n'est pas décorative : MESURÉ, `time '24:00:00'` est
--    une valeur Postgres légale, de minute 0 et de seconde 0, qui passait donc
--    les deux premiers prédicats — et qu'aucun balayage ne servirait jamais.
--
--    EMPLACEMENT — deux colonnes, PAS une clé de plus dans booking_config :
--    (1) la contrainte CHECK ci-dessus se pose sur une colonne `time`, pas
--        sur une expression jsonb (faisable, mais illisible et non typée) ;
--    (2) PUT /api/workspace-profile REMPLACE booking_config intégralement.
--        Son client actuel relit et ré-étale l'objet avant d'envoyer, donc
--        une 8e clé survivrait AUJOURD'HUI — mais un onglet resté ouvert
--        avant l'ajout de la clé la ferait disparaître à la sauvegarde
--        suivante. Course réelle, silencieuse, non détectable par un gate.
--
-- B. morning_briefs.emailed_at — « réellement expédié le »
--    `sent_at` existe déjà et MENT : la route le pose à l'instant de l'insert
--    alors que rien n'est envoyé. On ne le redéfinit pas — il faudrait décider
--    ce que valent les lignes historiques, et la colonne porterait deux sens
--    selon l'âge de la ligne. Une colonne neuve vaut NULL partout, ce qui est
--    exactement la vérité. `sent_at` reste faux et reste à traiter : c'est un
--    item du RESTE, pas un oubli.
--
-- C. morning_briefs.source — qui a écrit la ligne
--    C'est la colonne qui règle le conflit entre les deux écrivains.
--    Le bouton « Regenerate today's brief » de l'écran est une fonctionnalité
--    active : il ré-INSÈRE pour la même journée, autant de fois que l'on
--    clique. Un index unique nu sur (workspace_id, brief_date) le ferait
--    échouer en 23505 — code que la route ne lit pas — donc en 500
--    « Failed to save brief ». L'unicité doit donc porter sur les lignes du
--    cron UNIQUEMENT, d'où l'index PARTIEL du point F.
--    DEFAULT 'manual' : la route existante n'écrit pas cette colonne et n'a
--    pas à être modifiée. C'est ce DEFAULT qui rend le lot « zéro TypeScript ».
--
-- D. morning_briefs.workspace_id → NOT NULL
--    Prérequis de l'unicité : en Postgres les NULL sont distincts entre eux,
--    donc deux lignes (NULL, même date) ne seraient PAS départagées par un
--    index unique. Mesuré, pas supposé.
--
-- E. morning_briefs_user_id_fkey → ON DELETE CASCADE
--    🔴 SANS CE POINT, LE LOT 4 CASSE LA SUPPRESSION DE COMPTE.
--    La contrainte actuelle (000_baseline.sql:3207-3208) ne déclare AUCUNE
--    action ON DELETE — donc NO ACTION — alors que meetings_user_id_fkey
--    (000_baseline.sql:3192) est en CASCADE. Aujourd'hui c'est sans effet :
--    user_id n'est jamais renseigné. Le lot 4 le renseignera (il faut un
--    destinataire pour envoyer), et dès la première ligne portante,
--    `auth.admin.deleteUser` échouera en 23503 — donc le cron
--    hard-delete-users ne pourra plus supprimer ce compte, alors que son
--    commentaire affirme « cascade via ON DELETE CASCADE ». Chemin RGPD.
--    CASCADE et non SET NULL : un brief est un artefact personnel du
--    destinataire, il n'a aucune valeur d'historique une fois le compte
--    supprimé — contrairement à un meeting, qui documente un rendez-vous
--    ayant réellement eu lieu avec un tiers.
--    ⚠️ PÉRIMÈTRE HONNÊTE — ce correctif ne rend PAS la suppression de compte
--    globalement sûre. SIX autres clés étrangères vers auth.users sont dans le
--    même état (000_baseline.sql:2848, :2888, :2912, :3120, :3240, :3504), et
--    deux sont réellement peuplées par le code — broadcast_messages.sent_by
--    (app/api/admin/broadcast/route.ts) et credit_history.granted_by
--    (app/api/admin/credits/route.ts) — donc la suppression d'un compte ADMIN
--    échoue DÉJÀ aujourd'hui, indépendamment de ce lot. morning_briefs est en
--    revanche le seul porteur futur sur le chemin d'un compte utilisateur, qui
--    est celui du cron hard-delete-users. Les six autres sont un item du RESTE.
--
-- F. Index unique PARTIEL sur les lignes du cron
--    Porte l'at-most-once de l'INSERT d'une ligne 'cron' pour une journée
--    donnée : deux exécutions concurrentes du cron (Vercel peut se recouvrir)
--    tentent la même journée, la seconde reçoit 23505. MESURÉ en concurrence
--    réelle : la seconde transaction attend le commit de la première puis
--    échoue ; si la première fait ROLLBACK, la seconde réussit — une
--    réservation avortée ne brûle donc pas la journée.
--    089 donne la forme de l'index partiel.
--    ⚠️ CE QUE CET INDEX NE DONNE PAS, ET QUE LE LOT 4 DEVRA TRANCHER :
--    « s'arrêter avant de payer l'appel au modèle » suppose de réserver AVANT
--    de générer, comme lifecycle_emails (067). Or 067 est une table de
--    réservation SANS charge utile, tandis que `morning_briefs.content` est
--    NOT NULL (000_baseline.sql:891) ET affiché : la page sélectionne la ligne
--    la plus récente. Réserver avant de générer impose donc un contenu
--    provisoire, et une règle d'affichage qui masque les lignes 'cron' encore
--    à emailed_at NULL. L'alternative — générer puis insérer — paie le modèle
--    deux fois dans la course, rare. Choix du lot 4, pas du lot 1.
--    ⚠️ CONSÉQUENCE POUR LE LOT 4, À NE PAS OUBLIER : supabase-js ne sait pas
--    arbitrer un ON CONFLICT contre un index PARTIEL (42P10, cf. l'en-tête de
--    089). Le cron doit donc faire un INSERT nu et lire le code 23505 — jamais
--    un `.upsert({ onConflict: … })`.
--
-- G. Policy RLS restreinte à FOR SELECT
--    La policy actuelle (000_baseline.sql:4483) s'appelle « read briefs » mais
--    n'a AUCUNE clause FOR : Postgres la traite donc comme ALL, et l'absence
--    de WITH CHECK fait servir l'expression USING de contrôle d'insertion.
--    Relevé en production : anon et authenticated ont bien INSERT/UPDATE/DELETE
--    sur la table. Un utilisateur connecté peut donc, depuis sa console,
--    supprimer la ligne du jour de SON workspace — et, une fois le lot 4 livré,
--    forcer un renvoi, donc un appel au modèle facturé, autant de fois qu'il
--    veut. Il n'y a aucune fuite entre clients : le prédicat reste borné au
--    workspace de l'utilisateur.
--    ⚠️ ÉCART ASSUMÉ AU PATRON DU REPO : la composition canonique du skill
--    sentra-rls-pattern, appliquée par 038, pose DEUX policies (SELECT + ALL).
--    Ici une seule, et c'est justifié par l'usage réel, énuméré à la source :
--    `grep -rn "morning_briefs" --include=*.ts --include=*.tsx` rend
--    EXACTEMENT 3 sites — deux INSERT dans app/api/morning-brief/generate/
--    route.ts (client service_role, qui ne passe pas par la RLS) et un SELECT
--    dans la page. Aucun écrivain côté navigateur, donc aucune policy
--    d'écriture à accorder.
--
-- ═══ ORDRE DES INSTRUCTIONS — NE PAS RÉORDONNER ═══
--   1. Colonnes AVANT contraintes : le CHECK du point A et l'index du point F
--      référencent des colonnes qui doivent exister.
--   2. La colonne `source` AVANT l'index partiel, qui la lit dans son WHERE.
--   3. Le SET NOT NULL AVANT l'index partiel : c'est lui qui rend l'unicité
--      effective (point D).
--   Sur une table vide l'ordre n'a aucune conséquence observable ; il compte
--   pour la rejouabilité du fichier sur un environnement déjà peuplé (staging).
--
-- ═══ IDEMPOTENCE ═══
--   Le fichier est rejouable intégralement. IF NOT EXISTS sur les colonnes et
--   l'index ; DO $$ pour les contraintes (ADD CONSTRAINT n'a pas de
--   IF NOT EXISTS natif) ; DROP … IF EXISTS avant chaque CREATE de contrainte
--   ou de policy ; SET NOT NULL est nativement idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ A. Réglage de livraison, sur le profil du workspace ═══

ALTER TABLE public.workspace_profiles
  ADD COLUMN IF NOT EXISTS morning_brief_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.workspace_profiles
  ADD COLUMN IF NOT EXISTS morning_brief_time time NOT NULL DEFAULT '07:30';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_profiles_morning_brief_time_half_hour'
  ) THEN
    ALTER TABLE public.workspace_profiles
      ADD CONSTRAINT workspace_profiles_morning_brief_time_half_hour
      CHECK (
        EXTRACT(MINUTE FROM morning_brief_time) IN (0, 30)
        AND EXTRACT(SECOND FROM morning_brief_time) = 0
        AND morning_brief_time < time '24:00'
      );
  END IF;
END $$;

COMMENT ON COLUMN public.workspace_profiles.morning_brief_enabled IS
  'Migration 090. Le cron morning-brief n''envoie qu''aux workspaces à true. DEFAULT false : le cron (lot 4) est mergé AVANT l''écran de réglage (lot 5), donc personne ne doit recevoir tant qu''il n''existe aucun moyen de couper.';

COMMENT ON COLUMN public.workspace_profiles.morning_brief_time IS
  'Migration 090. Heure locale de livraison souhaitée, dans le fuseau de booking_config->>''timezone''. Contrainte aux multiples de 30 minutes : le cron balaie toutes les 30 minutes, une valeur intermédiaire ne serait jamais servie à l''heure promise.';

-- ═══ B + C. Colonnes d'envoi et de provenance sur les briefs ═══

ALTER TABLE public.morning_briefs
  ADD COLUMN IF NOT EXISTS emailed_at timestamp with time zone;

ALTER TABLE public.morning_briefs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'morning_briefs_source_check'
  ) THEN
    ALTER TABLE public.morning_briefs
      ADD CONSTRAINT morning_briefs_source_check
      CHECK (source IN ('manual', 'cron'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'morning_briefs_cron_needs_recipient'
  ) THEN
    ALTER TABLE public.morning_briefs
      ADD CONSTRAINT morning_briefs_cron_needs_recipient
      CHECK (source <> 'cron' OR user_id IS NOT NULL);
  END IF;
END $$;

COMMENT ON CONSTRAINT morning_briefs_cron_needs_recipient ON public.morning_briefs IS
  'Migration 090. Une ligne ecrite par l''envoi automatique DOIT porter son destinataire : sans user_id il n''y a personne a qui envoyer, et la ligne serait une reservation muette qui brule la journee. Les lignes ''manual'' restent libres (la route actuelle ne pose pas user_id, et n''a pas a etre modifiee). Posee ici parce que la table est vide : l''ajouter plus tard couterait une migration de plus.';

COMMENT ON COLUMN public.morning_briefs.emailed_at IS
  'Migration 090. Instant d''expédition RÉELLE de l''e-mail. À ne pas confondre avec sent_at, qui est posé à l''insert alors que rien n''est envoyé et ne veut donc rien dire — colonne héritée, non redéfinie ici pour ne pas donner deux sens à une même colonne selon l''âge de la ligne.';

COMMENT ON COLUMN public.morning_briefs.source IS
  'Migration 090. ''manual'' = bouton Generate / Regenerate de l''écran, autant de fois par jour que l''utilisateur le souhaite. ''cron'' = envoi automatique quotidien, au plus une fois par workspace et par brief_date (index partiel morning_briefs_cron_daily_uniq). DEFAULT ''manual'' pour que la route existante reste inchangée.';

-- ═══ D. workspace_id devient obligatoire ═══
-- Prérequis de l'unicité : deux lignes (NULL, même date) ne sont PAS
-- départagées par un index unique (NULLS DISTINCT, comportement par défaut).
-- Vérifié en production avant écriture : 0 ligne concernée.

ALTER TABLE public.morning_briefs
  ALTER COLUMN workspace_id SET NOT NULL;

-- ═══ E. Réparation de la clé étrangère destinataire ═══
-- Voir le bloc E de l'en-tête. DROP puis ADD : rejouable, et la validation
-- de la nouvelle contrainte est instantanée sur une table vide.

ALTER TABLE public.morning_briefs
  DROP CONSTRAINT IF EXISTS morning_briefs_user_id_fkey;

ALTER TABLE public.morning_briefs
  ADD CONSTRAINT morning_briefs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ═══ F. At-most-once de l'envoi automatique ═══

CREATE UNIQUE INDEX IF NOT EXISTS morning_briefs_cron_daily_uniq
  ON public.morning_briefs (workspace_id, brief_date)
  WHERE source = 'cron';

COMMENT ON INDEX public.morning_briefs_cron_daily_uniq IS
  'Migration 090. Porte l''at-most-once de l''INSERT d''une ligne source=''cron'' pour une journée donnée : deux exécutions concurrentes du cron tentent la même journée, la seconde reçoit 23505. Il ne garantit PAS à lui seul l''économie de l''appel au modèle : cela suppose de réserver avant de générer, donc un content provisoire (la colonne est NOT NULL et affichée) — arbitrage du lot 4. PARTIEL à dessein — les lignes ''manual'' ne sont pas contraintes, le bouton Regenerate doit rester libre de réécrire autant de fois que voulu dans la journée. Conséquence : supabase-js ne peut PAS arbitrer un ON CONFLICT contre cet index (42P10) — le cron fait un INSERT nu et lit 23505.';

-- ═══ G. Verrouillage de la règle de sécurité en lecture seule ═══
-- ENABLE RLS est déjà actif (000_baseline.sql:4188) ; répété par idempotence.

ALTER TABLE public.morning_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members read briefs" ON public.morning_briefs;

CREATE POLICY "workspace members read briefs" ON public.morning_briefs
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
