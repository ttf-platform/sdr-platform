---
name: sentra-rls-pattern
description: Applique les patterns RLS (Row Level Security) Supabase de Sentra. À utiliser pour toute migration SQL créant ou modifiant des policies, toute table sensible workspace-scoped, toute table multi-tenant, tout pattern author_only (notes, messages), tout audit RLS, ou toute route admin nécessitant des guards. Couvre policies workspace_id direct/indirect, pattern non-récursif sur workspace_members, author_only, idempotence DROP/CREATE, sécurité admin (requireSentraAdmin + logAdminAction), CAS pattern, validation post-migration, et tests Playwright MCP multi-utilisateur.
---

# Sentra RLS & Database Security Patterns

## Principes fondamentaux

Sentra est multi-tenant. Toutes les tables qui contiennent des données utilisateur **doivent** avoir RLS activé sans exception.

**Règles non-négociables** :

1. Toute table avec données métier → `ENABLE ROW LEVEL SECURITY`
2. Toute policy doit être **idempotente** (`DROP POLICY IF EXISTS` puis `CREATE POLICY`)
3. **Aucun bypass admin** dans les policies elles-mêmes — les actions admin passent par des routes serveur dédiées avec service role + guards
4. **Aucune récursion** sur `workspace_members` (bug historique 42P17)
5. Toute migration RLS est validée par le founder **AVANT** run dans Supabase
6. État cible : **toutes les tables publiques avec données métier ont RLS activé**. Validation factuelle via la query d'audit RLS global (cf. section Validation post-migration) — doit retourner 0 lignes.

---

## When to apply this skill

Charge cette skill systématiquement quand :
- Création d'une nouvelle table (migration SQL)
- Modification de policies existantes
- Création d'une route `/api/admin/*`
- Audit de sécurité ou debug d'un bug RLS (recursion, leak cross-workspace, etc.)
- Implémentation d'un pattern author_only (notes, messages personnels, etc.)
- Refacto d'un schéma avec FK cross-tables (CASCADE, RESTRICT)

---

## Pattern 1 — Policy `workspace_id` direct

Pour toute table contenant directement la colonne `workspace_id`.

**Cas d'usage** : `meetings`, `campaigns`, `prospects`, `contacts`, `morning_briefs`, `prospect_tags`, etc.

```sql
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read my_table" ON my_table;
CREATE POLICY "Workspace members can read my_table" ON my_table
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workspace members can write my_table" ON my_table;
CREATE POLICY "Workspace members can write my_table" ON my_table
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
```

**Variations** :
- Si tu veux séparer SELECT vs INSERT/UPDATE/DELETE → 4 policies distinctes (`FOR SELECT`, `FOR INSERT WITH CHECK`, `FOR UPDATE`, `FOR DELETE`)
- Pour `INSERT` : utiliser `WITH CHECK` au lieu de `USING`
- Pour `UPDATE` : ajouter `WITH CHECK` en plus de `USING` pour empêcher de changer le `workspace_id` vers un workspace dont l'user n'est pas membre

---

## Pattern 2 — Policy `workspace_id` indirect (via parent)

Pour les tables enfants qui n'ont pas `workspace_id` directement, mais une FK vers une table parente qui l'a.

**Cas d'usage** : `campaign_steps` (FK vers `campaigns`), `prospect_emails` (FK vers `prospects`), etc.

```sql
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read steps" ON campaign_steps;
CREATE POLICY "Workspace members can read steps" ON campaign_steps
  FOR SELECT USING (
    campaign_id IN (
      SELECT id FROM campaigns WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Workspace members can write steps" ON campaign_steps;
CREATE POLICY "Workspace members can write steps" ON campaign_steps
  FOR ALL USING (
    campaign_id IN (
      SELECT id FROM campaigns WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );
```

**Alternative préférable si table très requêtée** : dénormaliser `workspace_id` directement sur la table enfant (avec trigger ou backfill), puis utiliser le pattern 1. Évite les sous-requêtes imbriquées et perfs meilleures.

---

## Pattern 3 — Author-only (UPDATE/DELETE)

Pour les contenus personnels où la lecture est partagée workspace-wide mais l'édition/suppression est limitée à l'auteur.

**Cas d'usage** : `prospect_notes`, `support_messages`, `admin_notes` (selon scope).

```sql
-- SELECT : tous les membres du workspace lisent
DROP POLICY IF EXISTS "Workspace members can read notes" ON prospect_notes;
CREATE POLICY "Workspace members can read notes" ON prospect_notes
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- INSERT : seul l'user lui-même peut insérer une note signée par lui
DROP POLICY IF EXISTS "Users can insert their own notes" ON prospect_notes;
CREATE POLICY "Users can insert their own notes" ON prospect_notes
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- UPDATE : auteur uniquement
DROP POLICY IF EXISTS "Authors can update their notes" ON prospect_notes;
CREATE POLICY "Authors can update their notes" ON prospect_notes
  FOR UPDATE USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- DELETE : auteur uniquement
DROP POLICY IF EXISTS "Authors can delete their notes" ON prospect_notes;
CREATE POLICY "Authors can delete their notes" ON prospect_notes
  FOR DELETE USING (author_id = auth.uid());
```

**Règle stricte** : à l'INSERT, le code applicatif doit toujours faire `author_id = auth.uid()` (pas de paramètre passé depuis le client qui pourrait être falsifié). La policy `WITH CHECK` enforce ça côté DB.

---

## Pattern 4 — Non-récursion sur `workspace_members`

**Bug historique** (résolu) : la policy `owners-manage` sur `workspace_members` faisait un self-SELECT, ce qui causait une récursion infinie 42P17.

```sql
-- ❌ ANTI-PATTERN (cause récursion)
CREATE POLICY "Owners can manage members" ON workspace_members
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ✅ PATTERN CORRECT (non-récursif)
DROP POLICY IF EXISTS "Members can read their own membership" ON workspace_members;
CREATE POLICY "Members can read their own membership" ON workspace_members
  FOR SELECT USING (user_id = auth.uid());
```

**Règle** : sur `workspace_members`, **jamais** de policy qui fait `SELECT FROM workspace_members` à l'intérieur. La seule policy SELECT acceptable est `user_id = auth.uid()` (chaque user voit ses propres memberships).

Pour les actions privilégiées sur `workspace_members` (ajout/retrait member, changement role) → passer par une route serveur avec `service_role` après vérification applicative du rôle de l'user (lecture des memberships côté serveur).

---

## Composition canonique d'une migration Sentra

Toute migration SQL doit suivre cet ordre et ces patterns d'idempotence :

```sql
-- migration_NNN_description.sql

-- 1. CREATE TABLE avec IF NOT EXISTS
CREATE TABLE IF NOT EXISTS my_table (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- ... autres colonnes
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- 2. INDEXES avec IF NOT EXISTS
CREATE INDEX IF NOT EXISTS idx_my_table_workspace ON my_table(workspace_id);
CREATE INDEX IF NOT EXISTS idx_my_table_created ON my_table(created_at);

-- 3. ENABLE RLS (idempotent par défaut)
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

-- 4. POLICIES avec DROP IF EXISTS + CREATE
DROP POLICY IF EXISTS "Workspace members can read my_table" ON my_table;
CREATE POLICY "Workspace members can read my_table" ON my_table
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- 5. (optionnel) Triggers updated_at, etc.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS my_table_updated_at ON my_table;
CREATE TRIGGER my_table_updated_at
  BEFORE UPDATE ON my_table
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Règles** :
- Toute migration **doit pouvoir être run plusieurs fois sans erreur** (full idempotence)
- `IF NOT EXISTS` sur CREATE TABLE / CREATE INDEX
- `DROP POLICY IF EXISTS` avant chaque CREATE POLICY
- `CREATE OR REPLACE FUNCTION` pour les fonctions
- `DROP TRIGGER IF EXISTS` avant CREATE TRIGGER
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pour ajouts de colonnes
- Pour conditions complexes : wrapper `DO $$ BEGIN ... END $$` (utile pour `IF NOT EXISTS` sur constraints, par exemple)

---

## Wrapper `DO $$` pour idempotence avancée

Quand l'opération SQL n'a pas de `IF NOT EXISTS` natif (ex: `ADD CONSTRAINT`) :

```sql
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'my_unique_constraint'
  ) THEN
    ALTER TABLE my_table 
      ADD CONSTRAINT my_unique_constraint UNIQUE (col_a, col_b);
  END IF;
END $$;
```

À utiliser pour : ADD CONSTRAINT, ADD COLUMN avec calcul conditionnel, backfill complexe, etc.

---

## CASCADE sur FK (deletes propres)

Pour les FK enfants → parents qui doivent disparaître quand le parent est supprimé :

```sql
campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE
prospect_id uuid REFERENCES prospects(id) ON DELETE CASCADE
workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
```

**Règle** : toujours documenter le choix (CASCADE / SET NULL / RESTRICT) dans la migration. Pas de défaut implicite.

**Cas SET NULL** : quand l'enfant peut survivre sans le parent (ex: `meetings.prospect_id` peut devenir NULL si le prospect est supprimé mais le meeting reste historique).

**Bug pattern à éviter** : oublier CASCADE → DELETE parent renvoie 500 à cause des FK orphelines. Vu plusieurs fois dans Sentra (Sprint 16c.9 fix E sur DELETE campaign).

---

## Sécurité admin Sentra (Sprint 11)

### Flag `is_sentra_admin`

Le flag est dans `auth.users.raw_user_meta_data->>'is_sentra_admin'` (boolean).

**Granté manuellement via SQL Supabase**, jamais via UI :

```sql
UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data || '{"is_sentra_admin": true}'::jsonb
WHERE email = 'cyrus@noos.fr';
```

Pas d'UI pour granter ce flag → évite escalade de privilèges.

### Guard sur routes admin

Toute route `/api/admin/*` **DOIT** commencer par :

```typescript
import { requireSentraAdmin } from '@/lib/admin-guard';

export async function POST(request: Request) {
  const guard = await requireSentraAdmin();
  if (guard) return guard; // renvoie 401 ou 403 si pas admin
  
  // suite de la logique route
}
```

`requireSentraAdmin()` :
- Lit la session courante via `createServerClient`
- Vérifie le flag `is_sentra_admin`
- Renvoie une `NextResponse` 401/403 si KO, ou `null` si OK

### Logging admin

Toute action admin (broadcast, grant credit, modification d'un workspace, suspend user) **DOIT** logger via :

```typescript
import { logAdminAction } from '@/lib/admin-log';

// Fire-and-forget, ne bloque pas la route
logAdminAction({
  action: 'grant_credits',
  target_workspace_id: workspaceId,
  target_user_id: userId,
  details: { amount: 100, reason: 'support compensation' },
}).catch(console.error);
```

Table `admin_actions_log` (migration 028) :
- RLS admin-only (seul `is_sentra_admin = true` peut SELECT)
- INSERT autorisé pour tout user (mais en pratique seules les routes admin appellent `logAdminAction`)

---

## CAS pattern (Compare-And-Swap) — atomic updates

Pour les updates qui doivent être atomiques sous race condition (ex: overage charges).

```sql
-- Atomic update : si la valeur a changé entretemps, l'UPDATE ne touche aucune ligne
UPDATE workspaces 
SET overage_charges_made = $new_value
WHERE id = $workspace_id 
  AND overage_charges_made = $current_value;

-- Côté Postgres, retourne le nombre de rows affected
-- Si 0 → un autre process a déjà incrémenté, on skip
-- Si 1 → on peut procéder au charge Stripe
```

**Cas d'usage Sentra** :
- `overage_charges_made` (Sprint 6 Stripe) — éviter doubles charges
- Tout compteur incrémental partagé qui ne tolère pas les pertes de mise à jour

---

## Validation post-migration

Après tout run de migration, vérifier :

```sql
-- 1. Tables créées présentes
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'my_table';

-- 2. RLS activé
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'my_table';
-- Attendu : relrowsecurity = true

-- 3. Policies présentes
SELECT polname, polcmd FROM pg_policy 
WHERE polrelid = 'my_table'::regclass;

-- 4. Indexes
SELECT indexname FROM pg_indexes 
WHERE tablename = 'my_table';

-- 5. FK avec CASCADE
SELECT conname, confdeltype 
FROM pg_constraint 
WHERE conrelid = 'my_table'::regclass AND contype = 'f';
-- confdeltype: 'c'=CASCADE, 'n'=SET NULL, 'r'=RESTRICT
```

**Audit RLS global** (toute table doit avoir RLS) :

```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = false;
-- Doit retourner 0 lignes
```

État cible : `0 lignes` retournées (toutes les tables publiques ont RLS activé).

---

## Tests RLS automatisés (Sprint 9b.2 Lots A-D)

Le repo contient des tests d'intégration RLS qui tournent contre une vraie instance Supabase. **Préférer ces tests à Playwright MCP pour validation post-migration** : plus rapides (~14s pour 55 tests), déterministes, réutilisables sans interaction navigateur.

### Fichiers `__tests__/rls/`

| Fichier | Couverture | Sprint |
|---|---|---|
| `workspace-isolation.test.ts` | SELECT cross-workspace (User A ne voit pas les ressources de User B) | Phase 1 |
| `write-isolation.test.ts` | INSERT/UPDATE/DELETE cross-workspace (Lots A + B) | 9b.2 Lots A+B |
| `author-only.test.ts` | Pattern author-only (prospect_notes — auteur seul peut UPDATE/DELETE) | 9b.2 Lot C |
| `missing-tables.test.ts` | Audit que toutes les tables sensibles ont des tests RLS | 9b.2 Lot D |
| `setup.ts` | Création/cleanup workspaces de test (`Test Workspace *`) | utility |
| `gc.ts` | Garbage collect orphelins > 24h | utility |

Status au marathon Tier 1 Security 18 mai 2026 : **55 tests verts**, 5 patterns RLS couverts.

### Commandes

```bash
npm run test:rls       # Run tous les tests RLS (~14s)
npm run test:rls:gc    # GC orphan workspaces > 24h
```

### Workflow d'extension

Quand tu ajoutes une nouvelle table avec RLS :
1. Migration SQL appliquée (cf. workflow obligatoire ci-dessous)
2. Ajouter un test dans le fichier `__tests__/rls/` approprié :
   - Cross-workspace isolation → `workspace-isolation.test.ts` ou `write-isolation.test.ts`
   - Author-only → `author-only.test.ts`
3. Le test `missing-tables.test.ts` listera la nouvelle table — vérifier qu'elle est couverte
4. Run `npm run test:rls` → doit rester vert

---

## Workflow obligatoire pour toute migration

0. **Audit READ-ONLY préalable** : avant rédaction du SQL, lire littéralement (cat/view brut) les fichiers/schémas concernés. Pas de supposition basée sur résumé. Sauter cette étape = échec (règle 17.10 du marathon Tier 1 Security mai 2026)
1. **Claude (chat) rédige le SQL** en suivant les patterns ci-dessus
2. **Founder review** le SQL avant tout run
3. **Run dans Supabase Dashboard** (SQL Editor)
4. **Si erreur** → coller le retour à Claude (chat) pour debug, ne PAS retenter à l'aveugle
5. **Validation post-migration** via les requêtes ci-dessus + run `npm run test:rls` (cf. section Tests RLS automatisés)
6. **Documenter la migration** : numéro + résumé des changes dans le sprint summary. Le founder maintient `CURRENT_STATE_v7.md` (Project Knowledge claude.ai, hors-repo) en fin de sprint — pas pendant.

**Pas de skip de cette étape**. Plusieurs migrations bancales en début de projet → workflow renforcé.

---

## Anti-patterns à refuser

- Table sans `ENABLE ROW LEVEL SECURITY`
- Policy sans `DROP IF EXISTS` avant `CREATE` (migration non idempotente)
- Récursion sur `workspace_members` dans une policy
- Bypass admin dans une policy SQL (mettre la logique admin côté route serveur avec service_role)
- FK sans choix CASCADE/SET NULL/RESTRICT documenté
- Migration sans validation post-run
- Route `/api/admin/*` sans `requireSentraAdmin()` guard
- Action admin sans `logAdminAction()`
- Grant `is_sentra_admin` via UI (toujours via SQL manuel)
- Update non-atomique sur compteurs critiques (utiliser CAS)
- Policy avec sous-requête imbriquée évitable (préférer dénormalisation `workspace_id`)

---

## Validation Playwright MCP — RLS multi-utilisateur

Pour toute migration RLS ou modif de policy, **tester avec plusieurs comptes** que l'isolation tient.

### 1. Setup test multi-utilisateur

Pré-requis : 2 comptes test sur 2 workspaces différents.

```
User A : test-a@sentra.test (workspace A)
User B : test-b@sentra.test (workspace B)
```

À documenter dans le brief sprint pour Claude Code.

### 2. Test isolation cross-workspace (CRITIQUE)

```
Avec Playwright MCP :
1. Login en tant que User A (test-a@sentra.test) sur /login
2. Note l'ID d'une ressource de User A (ex: une campagne) via DOM ou API
3. Logout
4. Login en tant que User B (test-b@sentra.test)
5. Tente d'accéder à la ressource de User A par son ID (URL directe ou API call):
   - GET /api/campaigns/{id-de-user-a} → doit renvoyer 404 ou 403, JAMAIS 200
   - Navigation /dashboard/campaigns/{id-de-user-a} → doit redirect ou 404
6. Tente même chose pour : prospects, contacts, meetings, notes, deals, prospect_emails
Verdict : aucun leak possible. Si 200 sur n'importe quelle ressource → BUG RLS critique.
```

### 3. Test author_only (notes, messages)

```
Avec Playwright MCP :
1. Login User A, sur un prospect, ajoute une note
2. Logout, login User B (même workspace que A — il faut un 3e user pour ce test)
3. Vérifie que la note est lisible (SELECT OK)
4. Tente de l'éditer ou la supprimer via API DELETE/PATCH → doit renvoyer 403
5. Login User A à nouveau → doit pouvoir éditer/supprimer sa note
Si User B peut éditer la note de User A → BUG author_only.
```

### 4. Test admin guard

```
Avec Playwright MCP :
1. Login en tant que user non-admin (User A par défaut)
2. Tente d'accéder aux routes admin :
   - GET /api/admin/users → doit renvoyer 401/403
   - POST /api/admin/grant-credits → doit renvoyer 401/403
   - GET /dashboard/admin (page UI) → doit redirect ou 404
3. Logout, login en tant qu'admin (cyrus@noos.fr)
4. Mêmes routes → doivent renvoyer 200 / page accessible
```

### 5. Test workspace_members non-récursion

```
Avec Playwright MCP :
1. Login User A
2. Capture les requêtes réseau pendant le chargement /dashboard
3. Vérifie qu'aucune requête à la DB ne renvoie 42P17 (recursion error) dans les logs
4. Inspecte la console : aucun "infinite recursion detected in policy"
Si erreur 42P17 détectée → BUG récursion sur workspace_members.
```

### 6. Test CASCADE delete

```
Avec Playwright MCP :
1. Login User A
2. Crée une campagne avec quelques follow-ups (campaign_steps), prospects assignés (prospects), drafts (prospect_emails)
3. Note les IDs créés
4. Supprime la campagne (DELETE /api/campaigns/{id})
5. Vérifie via API ou inspect DB que :
   - campaign_steps lié → supprimé
   - prospect_emails lié → supprimé (si CASCADE configuré)
   - prospects assignés → supprimés OU campaign_id = NULL (selon le choix de FK)
Verdict : pas d'orphelins, DELETE renvoie 200/204.
Si DELETE renvoie 500 → CASCADE manquant sur une FK enfant.
```

### 7. Audit RLS global (avant clôture sprint critique DB)

```
Demande à Claude Code (sans Playwright, juste via SQL) d'exécuter :
"Connecte-toi à Supabase via la CLI ou via un script Node, et exécute :
SELECT schemaname, tablename, rowsecurity
FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = false;

Doit retourner 0 lignes. Si lignes retournées, lister les tables sans RLS et corriger avant de merger."
```

### 8. Test admin_actions_log

```
Avec Playwright MCP :
1. Login admin (cyrus@noos.fr)
2. Effectue une action admin (broadcast message, grant credit, etc.)
3. Vérifie via SQL ou via /dashboard/admin/audit que la ligne a été inscrite dans admin_actions_log
4. Login non-admin → tente SELECT sur admin_actions_log via API → doit échouer (RLS admin-only)
```

---

## Mises à jour

Quand un nouveau pattern RLS apparaît stable sur 2+ migrations → l'ajouter ici.
Quand une bug RLS récurrent est identifié → ajouter dans les anti-patterns.
Review tous les 5-10 sprints + audit RLS global après chaque migration.
