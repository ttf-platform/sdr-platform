/**
 * lib/google-calendar-event-id.ts
 *
 * LC21 (4)A — DERIVATION et VALIDATION de l'identifiant d'evenement Google
 * a partir d'un meetings.id. Fonctions PURES et DETERMINISTES.
 *
 * INVARIANT I1 — L'identifiant est DERIVE, jamais tire ni relu. Deux
 * tentatives sur la meme ligne meetings produisent le meme identifiant, meme
 * si toute persistance intermediaire a ete perdue.
 *
 * INVARIANT I2 — FORMAT FIXE ICI :
 *   - prefixe litteral 'mirvo' (constante unique et nommee ci-dessous,
 *     JAMAIS recopiee ailleurs — IRREVERSIBLE) ;
 *   - suivi des 32 caracteres hexadecimaux d'un uuid v4 SANS TIRETS ;
 *   - longueur totale : 37 caracteres ;
 *   - normalisation en MINUSCULES obligatoire avant validation ;
 *   - validateur applique le jeu du fournisseur : caracteres [a-v0-9] et
 *     longueur dans [5, 1024] — contrat Google events.insert.
 *
 * Le validateur est APPELE par la derivation elle-meme : un uuid malforme
 * (majuscules incluses via normalisation, mais tout autre defaut de
 * structure) fait echouer la derivation, jamais un identifiant invalide ne
 * remonte au client.
 *
 * PORTEE : aucune dependance reseau, aucune dependance base, aucun appelant
 * dans le depot en dehors des tests du meme lot.
 */

/**
 * Prefixe LITTERAL de tout identifiant Google emis par Mirvo. IRREVERSIBLE :
 * modifier cette valeur romprait la derivation d'identifiants deja emis et
 * rendrait la comparaison d'appartenance (I5) impossible sur les evenements
 * anterieurs. Ne JAMAIS recopier ailleurs — importer cette constante.
 */
export const GOOGLE_EVENT_ID_PREFIX = 'mirvo' as const;

// Contrat Google events.insert — id valide : jeu de caracteres et longueur.
const GOOGLE_EVENT_ID_CHARSET  = /^[a-v0-9]+$/;
const GOOGLE_EVENT_ID_MIN_LEN  = 5;
const GOOGLE_EVENT_ID_MAX_LEN  = 1024;

// Structure d'un uuid canonique, apres normalisation en minuscules.
const UUID_CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Verifie qu'une chaine respecte le contrat Google events.insert pour
 * l'identifiant : jeu ferme [a-v0-9] et longueur dans [5, 1024].
 *
 * Fonction PURE. Ne normalise pas — appeler apres normalisation en
 * minuscules. Retourne `true` si l'identifiant est valide, `false` sinon.
 */
export function isValidGoogleEventId(id: string): boolean {
  if (typeof id !== 'string') return false;
  if (id.length < GOOGLE_EVENT_ID_MIN_LEN) return false;
  if (id.length > GOOGLE_EVENT_ID_MAX_LEN) return false;
  return GOOGLE_EVENT_ID_CHARSET.test(id);
}

/**
 * Derive l'identifiant Google d'un rendez-vous Mirvo a partir de son uuid.
 *
 * Etapes, dans cet ordre :
 *   1. normalisation en MINUSCULES ;
 *   2. verification de la forme uuid canonique ;
 *   3. concatenation `prefix + hex-sans-tirets` ;
 *   4. verification du contrat Google via isValidGoogleEventId().
 *
 * Une entree malformee fait LEVER : la derivation refuse tout identifiant
 * qui violerait le contrat, jamais un identifiant invalide ne sort d'ici.
 */
export function deriveGoogleEventId(meetingUuid: string): string {
  if (typeof meetingUuid !== 'string') {
    throw new Error('[google-calendar-event-id] meetingUuid must be a string');
  }
  const normalized = meetingUuid.toLowerCase();
  if (!UUID_CANONICAL.test(normalized)) {
    throw new Error('[google-calendar-event-id] meetingUuid is not a canonical uuid');
  }
  const hex = normalized.replace(/-/g, '');
  const id  = `${GOOGLE_EVENT_ID_PREFIX}${hex}`;
  if (!isValidGoogleEventId(id)) {
    // Structurellement impossible avec un uuid canonique + prefixe 'mirvo' :
    // longueur 37, caracteres [a-v0-9] tous inclus. Presence de ce garde-fou
    // pour que toute modification future du prefixe soit rejetee si elle
    // violait le contrat Google.
    throw new Error('[google-calendar-event-id] derived id violates the Google contract');
  }
  return id;
}
