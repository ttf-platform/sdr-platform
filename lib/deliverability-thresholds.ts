// ─── Deliverability thresholds — shared source of truth ───────────────────
//
// Extraite pour eviter la meme dette que MIN_PROFILE_SCORE (le seuil 30
// est en dur sur quatre sites du repo). Un seul point ici, deux
// consommateurs a ce jour :
//   - `app/admin/limits/_components/LimitsClient.tsx` : tableau de
//     surveillance qui teinte les taux de rebond en rouge.
//   - `lib/brief-payload.ts` : bloc `deliverability` du Morning Coffee
//     Brief (une alerte y est emise si `bounce_rate > seuil`).
//
// Borne STRICTE : un taux egal a la valeur pile n'alerte PAS. Choix produit
// — le seuil est declaratif (« au-dessus de trois pour cent »), pas
// inclusif. Modifie ici et la valeur suit sur les deux sites au prochain
// deploiement.

export const BOUNCE_CRITICAL_THRESHOLD = 0.03
