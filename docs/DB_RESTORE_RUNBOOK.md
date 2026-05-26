# Sentra — DB Restore Runbook

Source : Supabase project `mcadbnjivhnhfysrdapq` (Pro plan)
Backups : daily automatic, 7 days retention
Last updated : 26 mai 2026

---

## 1. Detection — Comment savoir qu'on a un incident

### Signaux à surveiller (cron + manual)
- **PostHog Error Tracking** : spike d'erreurs `Supabase query error` ou `RLS denied`
- **Sentra `/status` page** : badge Database = `down` ou `degraded` (latence > 2s persistante)
- **User reports** : "I can't access my data" / "my campaigns disappeared"
- **Stripe webhooks failed** : si webhook ne peut pas écrire en DB
- **Daily cost cron** : envoie 0 emails plusieurs jours d'affilée = scans peut-être brokens

### Confirmer l'incident
```bash
# Vérifier le health endpoint en prod
curl https://sentra.app/api/health

# Vérifier le dashboard Supabase
# → Reports section : graphs latency, error rate, active connections
```

---

## 2. Triage — Severity & impact

| Severity | Critère | Action |
|---|---|---|
| **P0 Critical** | DB down complète, tous users impactés | Restore immédiat depuis dernier backup |
| **P1 High** | Données spécifiques corrompues/perdues (1 table, 1 workspace) | Restore ciblé OU restore complet selon scope |
| **P2 Medium** | Performance dégradée mais fonctionnel | Diagnostiquer (slow queries, indexes manquants) AVANT restore |
| **P3 Low** | Bug data isolé sur 1 user | Fix manuel SQL, pas de restore |

---

## 3. Restore process complet (Pro plan)

### Pre-restore checklist
1. **Identifier le point de restore** : daily backup le + récent AVANT l'incident
2. **Évaluer la perte de données** : tout ce qui a été créé/modifié APRÈS le backup target sera perdu
3. **Communiquer downtime** : page `/status` mise à jour manuellement (post-launch : automatiser)
4. **Bloquer écritures** : pause Vercel deployments / disable user actions critiques si possible

### Steps (Supabase Dashboard)
1. Login https://supabase.com/dashboard → projet `mcadbnjivhnhfysrdapq`
2. Sidebar **Database** → **Backups**
3. Identifier le backup ciblé (date/heure visible UTC)
4. Click **Restore** sur la row du backup
5. **CHOIX CRITIQUE** :
   - **Restore to same project** = overwrite current data ⚠️ destructif, mais downtime minimal
   - **Restore to new project** = nouveau projet créé, faut migrer Sentra (Vercel env vars) → downtime plus long mais reversible
6. Confirmer + attendre (durée variable selon taille DB, généralement 5-30 min)

### Pour V1 launch (DB small)
- Restore to same project recommandé (faster, simpler)
- Restore to new project = juste pour drill / test, pas pour incidents réels

---

## 4. Validation post-restore

### Checks automatiques
```bash
# 1. Health endpoint
curl https://sentra.app/api/health
# Attendu : status='ok' database 'ok' avec latency normale

# 2. Login Sentra avec test account
# → Tu dois pouvoir login + voir tes campaigns/signals
```

### Checks SQL Editor (Supabase Dashboard)
```sql
-- Vérifier les tables critiques ont du contenu
SELECT
  (SELECT count(*) FROM workspaces) as workspaces,
  (SELECT count(*) FROM users) as users,
  (SELECT count(*) FROM campaigns) as campaigns,
  (SELECT count(*) FROM signals) as signals,
  (SELECT count(*) FROM prospects) as prospects;

-- Vérifier RLS policies actives (security check)
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND rowsecurity=false;
-- Attendu : aucune ligne (toutes les tables ont RLS ON)
```

---

## 5. Communication users post-restore

### Si downtime > 5 min
- Mettre à jour `/status` page (manuel V1) : banner red "Major outage — investigating"
- Email à tous les users actifs (template):

> Subject: Sentra outage update
>
> Hi,
>
> Sentra experienced a database issue around \<TIME UTC\>. The platform is now restored, but data created after \<BACKUP_TIME\> may have been lost.
>
> What was affected: \<list\>
> What you should do: \<action si nécessaire\>
>
> We're sorry for the disruption.
> The Sentra team

### Si downtime < 5 min ou pas d'impact user
- Notifier juste dans `/status` post-incident
- Pas d'email mass nécessaire

---

## 6. Post-mortem template

À écrire dans les 48h après tout incident P0/P1.

### Format
- **Timeline** : timestamps précis détection → restore → recovery
- **Root cause** : pourquoi ça a foiré
- **Impact** : combien d'users, combien de temps, combien de données perdues
- **What worked** : process qui a marché
- **What failed** : process qui a échoué
- **Action items** : 3-5 actions concrètes pour empêcher récidive

---

## 7. Drill recommandé

À faire 1x avant launch + tous les 3 mois :

1. Créer un projet Supabase TEST (gratuit)
2. Restore le dernier backup Sentra prod vers ce projet test
3. Connecter une instance Vercel preview au projet test
4. Login + smoke test (créer campaign, run signal, etc.)
5. Mesurer le temps total (target : < 30 min)
6. Documenter les frictions dans ce runbook

---

## Contacts

- **Supabase support** : https://supabase.com/dashboard/support (Pro plan = email support)
- **Vercel support** : https://vercel.com/help (si problème adjacent)
- **PostHog support** : si event tracking impact

---

**Maintenance** : Update ce runbook après chaque incident pour capturer ce qu'on a appris.
