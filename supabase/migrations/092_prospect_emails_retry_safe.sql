-- =============================================================================
-- 092 — prospect_emails.retry_safe : porteur TYPÉ de la sûreté d'un renvoi
-- =============================================================================
--
-- POURQUOI CETTE COLONNE EXISTE
-- -----------------------------------------------------------------------------
-- Un e-mail dont l'envoi a échoué doit pouvoir être réessayé — sauf si le
-- fournisseur a pu recevoir le prospect malgré l'échec, auquel cas un renvoi
-- produirait un DOUBLE ENVOI vers une personne réelle.
--
-- La première implémentation dérivait cette information de `send_error`. Cette
-- direction a été ABANDONNÉE après mesure : `send_error` a plusieurs auteurs
-- qui y écrivent pour des raisons différentes — la route d'approbation y met
-- une cause d'échec, le webhook y met un marqueur d'arrêt automatique
-- (`auto_stop: …`) sur des lignes qui n'ont jamais été soumises. Adosser une
-- garantie anti-double-envoi à un champ de texte libre partagé, c'est la
-- confier au prochain auteur qui y écrira sans le savoir.
--
-- SÉMANTIQUE — trois cas, un seul booléen
-- -----------------------------------------------------------------------------
--   true   la ligne peut être remise au fournisseur. Soit elle n'a jamais été
--          tentée, soit l'échec prouve que le fournisseur ne l'a pas reçue.
--   false  le fournisseur A PU la recevoir. Renvoyer risquerait un doublon.
--
-- ⚠️ `false` ne dit PAS « envoyé ». Il dit « on ne peut pas prouver que ça ne
-- l'a pas été ». C'est une garantie de sûreté, pas un état du monde.
--
-- UN SEUL AUTEUR, ET C'EST LE POINT
-- -----------------------------------------------------------------------------
-- Seule app/api/prospect-emails/[id]/approve/route.ts écrit cette colonne, au
-- moment exact où elle sait où l'échec s'est produit. Aucun webhook, aucun
-- cron, aucune autre route n'y touche. C'est ce qui la rend fiable là où
-- `send_error` ne l'était pas.
--
-- HORS PÉRIMÈTRE, déclaré
-- -----------------------------------------------------------------------------
-- L'interrogation du fournisseur et les clés d'idempotence restent hors sujet
-- (voir migration 085, même arbitrage). Cette colonne borne le risque ; elle
-- ne lève pas l'ambiguïté à la source.
--
-- MOTEUR ET MODE D'ERREUR
-- -----------------------------------------------------------------------------
-- Écrite pour PostgreSQL 16, rejouable en mode par défaut ET sous
-- ON_ERROR_STOP=1. Idempotente : chaque instruction est gardée, la promotion
-- est bornée aux lignes encore douteuses, et un second passage ne reclasse
-- rien. Aucune fenêtre intermédiaire : la colonne naît NOT NULL.
-- =============================================================================

-- 1 ─── La colonne, NOT NULL DEFAULT false d'emblée.
--
--       ⚠️ Pourquoi false et pas true : c'est le défaut CONSERVATEUR. Une
--       ligne existante non encore classée doit être douteuse, jamais sûre.
--       L'étape 2 promeut ensuite, explicitement, les seules familles
--       prouvées. Il n'existe à aucun instant de branche « sinon sûre ».
--
--       Et pourquoi en une seule instruction : depuis PostgreSQL 11, ajouter
--       une colonne NOT NULL avec DEFAULT est une opération de métadonnées,
--       sans réécriture de table. Une version antérieure de cette migration
--       créait la colonne nullable, backfillait, puis posait NOT NULL — ce
--       qui ouvrait une fenêtre où une insertion concurrente faisait échouer
--       le SET NOT NULL et laissait la migration à mi-parcours. Mesuré sur
--       PostgreSQL 16.13 : « column "retry_safe" contains null values ».
--       Ici la fenêtre n'existe pas.
ALTER TABLE public.prospect_emails
  ADD COLUMN IF NOT EXISTS retry_safe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.prospect_emails.retry_safe IS
  'Le fournisseur peut-il recevoir ce prospect une seconde fois sans doublon ? '
  'false = il a PU le recevoir malgre l''echec. Ecrit uniquement par la route '
  'd''approbation. Ne jamais deriver de send_error : ce champ a plusieurs auteurs.';

-- 2 ─── Promotion EXPLICITE des lignes historiques dont la sûreté est prouvée.
--
--       Bornée par `retry_safe = false` : un rejeu ne redescend jamais une
--       ligne déjà promue, et ne touche pas les lignes écrites depuis par
--       l'application.
--
--       Les quatre familles, chacune prouvée :
--         send_error IS NULL / vide     jamais tentée.
--         'prospect_email_missing'      levé avant tout appel au fournisseur.
--         'prospect_lookup_failed:%'    idem.
--         '[InstantlyProvider.ensureCampaign]%'  l'échec porte sur la création
--                                       de campagne ; l'étape qui soumet le
--                                       prospect n'a jamais été atteinte.
--
--       ⚠️ 'auto_stop:%' est écrit par le webhook sur des lignes 'approved'
--       lorsqu'un prospect répond — rien n'a été soumis, donc sûr. Mais ce
--       champ a plusieurs auteurs et l'écriture n'est PAS conditionnelle :
--       elle peut écraser une cause d'échec ambiguë antérieure. La famille
--       est donc bornée par `provider_message_id IS NULL`, qui atteste
--       qu'aucun identifiant fournisseur n'a jamais été rattaché à la ligne.
--
--       🔴 CE QUI RESTE DÉLIBÉRÉMENT DOUTEUX :
--         '[InstantlyProvider.enqueueLead] …'  un refus HTTP historique y est
--              INDISCERNABLE d'une réponse acceptée sans identifiant de lead.
--         'provider timeout after …ms'  l'ancien message ne nommait pas
--              l'étape : un délai sûr ressemble à un délai ambigu.
--         tout message inconnu.
UPDATE public.prospect_emails
SET    retry_safe = true
WHERE  retry_safe = false
  AND (
        send_error IS NULL
     OR btrim(send_error) = ''
     OR send_error =    'prospect_email_missing'
     OR send_error LIKE 'prospect_lookup_failed:%'
     OR send_error LIKE '[InstantlyProvider.ensureCampaign]%'
     OR (send_error LIKE 'auto_stop:%' AND provider_message_id IS NULL)
  );

-- 3 ─── Le défaut bascule pour les lignes FUTURES, qui naissent sans tentative
--       d'envoi et sont donc légitimement sûres.
ALTER TABLE public.prospect_emails
  ALTER COLUMN retry_safe SET DEFAULT true;

-- 4 ─── Index partiel : les lectures qui comptent portent toutes sur le cas
--       minoritaire — trouver les lignes bloquées d'un espace de travail.
CREATE INDEX IF NOT EXISTS idx_prospect_emails_retry_unsafe
  ON public.prospect_emails (workspace_id)
  WHERE retry_safe = false;
