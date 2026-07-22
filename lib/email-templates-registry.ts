/**
 * Email templates registry (client-safe).
 *
 * Purpose : hard-coded factory defaults for the 8 automated emails Mirvo
 * sends (onboarding × 4, upgrade, dunning, cancellation, signal digest),
 * each in EN + FR. These are the fallback rendered when the DB row is
 * missing — a DB row only exists after an admin edited the template
 * (PR2). "Reset to default" = DELETE the row.
 *
 * Contract :
 *   - Pure TypeScript, ZERO server-side imports. Importable from any
 *     Client Component (the admin editor in PR2) or server route.
 *   - Placeholder tokens use double curlies : {{greeting}}, {{workspaceName}},
 *     {{planLabel}}, {{amountPhrase}}, {{planPhrase}}, {{invoiceUrl}},
 *     {{invoiceLine}}, {{matchList}}, {{matchCount}}, {{baseUrl}}.
 *   - Help / dashboard links inside bodyMd keep {{baseUrl}} as a prefix so
 *     the same string works across dev / staging / prod.
 *   - Vendor invisibility : no provider name (Anthropic, Claude, Resend,
 *     Explorium, Instantly, …) appears in any string.
 *
 * Callers should read via lib/email-templates.ts::getEmailTemplate(key, locale)
 * which merges the DB row over these defaults.
 */

export type EmailTemplateKey =
  | 'onboarding_d0'
  | 'onboarding_d2'
  | 'onboarding_d4'
  | 'onboarding_d7'
  | 'upgrade'
  | 'dunning'
  | 'dunning_j3'
  | 'dunning_j7'
  | 'cancellation'
  | 'winback'
  | 'signal_digest'

export type EmailTemplateLocale = 'en' | 'fr'

export type EmailTemplateCategory = 'onboarding' | 'billing' | 'product'

export interface EmailTemplateFields {
  subject:    string
  preheader:  string | null
  heading:    string | null
  bodyMd:     string
  ctaLabel:   string | null
  ctaPath:    string | null
}

export interface EmailTemplateMeta {
  key:             EmailTemplateKey
  category:        EmailTemplateCategory
  /** One-line technical description of what fires this email (admin panel). */
  trigger:         string
  /** Placeholders actually used across EN + FR bodies / subjects. */
  placeholders:    string[]
  /** Default CTA path (identical across locales — routing is not localized). */
  defaultCtaPath:  string | null
  /**
   * When true, `renderTemplate` wraps the assembled body in the standard
   * Mirvo chrome (header + footer). When false, the caller renders the body
   * standalone (e.g. digest-style layouts that build their own container).
   * Kept as pure metadata for the admin panel + forward planning ; the
   * renderer wraps unconditionally in PR1a per the spec.
   */
  hasChrome:       boolean
}

// Ordered list — the admin panel iterates this to display the template
// picker in a fixed order (onboarding sequence, then billing lifecycle,
// then product).
export const EMAIL_TEMPLATE_META: ReadonlyArray<EmailTemplateMeta> = [
  {
    key:            'onboarding_d0',
    category:       'onboarding',
    trigger:        'Sent on signup (day 0)',
    placeholders:   ['greeting', 'workspaceName', 'baseUrl'],
    defaultCtaPath: '/dashboard',
    hasChrome:      true,
  },
  {
    key:            'onboarding_d2',
    category:       'onboarding',
    trigger:        'Sent 2 days after signup',
    placeholders:   ['greeting', 'baseUrl'],
    defaultCtaPath: '/dashboard/signals',
    hasChrome:      true,
  },
  {
    key:            'onboarding_d4',
    category:       'onboarding',
    trigger:        'Sent 4 days after signup',
    placeholders:   ['greeting', 'baseUrl'],
    defaultCtaPath: '/dashboard/inbox',
    hasChrome:      true,
  },
  {
    key:            'onboarding_d7',
    category:       'onboarding',
    trigger:        'Sent 7 days after signup',
    placeholders:   ['greeting', 'workspaceName', 'baseUrl'],
    defaultCtaPath: '/dashboard/campaigns/new',
    hasChrome:      true,
  },
  {
    key:            'upgrade',
    category:       'billing',
    trigger:        'First transition into an active paid subscription',
    placeholders:   ['greeting', 'workspaceName', 'planLabel', 'baseUrl'],
    defaultCtaPath: '/dashboard',
    hasChrome:      true,
  },
  {
    key:            'dunning',
    category:       'billing',
    trigger:        'First invoice payment failure (per invoice)',
    placeholders:   ['greeting', 'workspaceName', 'planPhrase', 'amountPhrase', 'invoiceLine', 'baseUrl'],
    defaultCtaPath: '/dashboard/billing',
    hasChrome:      true,
  },
  {
    key:            'dunning_j3',
    category:       'billing',
    trigger:        'Dunning escalation — 3 days past due (cron)',
    placeholders:   ['greeting', 'workspaceName', 'planPhrase', 'amountPhrase', 'invoiceLine', 'baseUrl'],
    defaultCtaPath: '/dashboard/billing',
    hasChrome:      true,
  },
  {
    key:            'dunning_j7',
    category:       'billing',
    trigger:        'Dunning escalation — 7 days past due, final notice (cron)',
    placeholders:   ['greeting', 'workspaceName', 'planPhrase', 'amountPhrase', 'invoiceLine', 'baseUrl'],
    defaultCtaPath: '/dashboard/billing',
    hasChrome:      true,
  },
  {
    key:            'cancellation',
    category:       'billing',
    trigger:        'Subscription cancellation confirmed (excluding trial expiry)',
    placeholders:   ['greeting', 'workspaceName', 'planPhrase', 'baseUrl'],
    defaultCtaPath: '/dashboard/billing',
    hasChrome:      true,
  },
  {
    key:            'winback',
    category:       'billing',
    trigger:        'Win-back — ~23 days after cancellation, before the 30-day purge (cron)',
    placeholders:   ['greeting', 'workspaceName', 'baseUrl'],
    defaultCtaPath: '/dashboard/billing',
    hasChrome:      true,
  },
  {
    key:            'signal_digest',
    category:       'product',
    trigger:        'Nightly digest when signals matched new prospects',
    placeholders:   ['greeting', 'matchCount', 'matchList', 'baseUrl'],
    defaultCtaPath: '/dashboard',
    // Flipped in PR1b : auto-scan-signals now sends via renderTemplate,
    // which unconditionally wraps in wrapEmail chrome (Mirvo footer + link).
    hasChrome:      true,
  },
]

// ─── Defaults ────────────────────────────────────────────────────────────────
// EN strings are the current wording from lib/email.ts, re-shaped into the
// 6-field template model. onboarding_d7 and signal_digest are the two
// upgrades (single dominant CTA / benefit-oriented) specified in the brief.
// FR strings are the brief's translations.

export const EMAIL_TEMPLATE_DEFAULTS: Record<EmailTemplateKey, Record<EmailTemplateLocale, EmailTemplateFields>> = {

  // ─── onboarding_d0 ────────────────────────────────────────────────────────
  onboarding_d0: {
    en: {
      subject:   'Welcome to Mirvo — start sending from your own mailbox today',
      preheader: "Connect your mailbox and your first campaign can go out today. Here's how to set up.",
      heading:   'Welcome to Mirvo',
      bodyMd:    "{{greeting}}\n\nYou just created {{workspaceName}} on Mirvo. Here's what happens next:\n\n1. **Connect your mailbox** (Gmail or Outlook, secure sign-in, 30 sec). Because it's already in daily use, you can start sending today.\n2. **Define your ICP** (who you sell to + what pain you solve).\n3. **Launch your first campaign**: Mirvo finds buyers, drafts every email, and queues them for your approval.\n\nThere are a few ways to send with Mirvo — your own mailbox is the fastest way to start, and you can add a dedicated sending domain later. [See which setup fits you]({{baseUrl}}/help/choosing-your-sending-setup).",
      ctaLabel:  'Open Mirvo',
      ctaPath:   '/dashboard',
    },
    fr: {
      subject:   "Bienvenue sur Mirvo — envoyez dès aujourd'hui depuis votre propre boîte",
      preheader: 'Connectez votre boîte et votre première campagne peut partir aujourd\'hui. Voici comment démarrer.',
      heading:   'Bienvenue sur Mirvo',
      bodyMd:    "{{greeting}}\n\nVous venez de créer {{workspaceName}} sur Mirvo. Voici la suite :\n\n1. **Connectez votre boîte mail** (Gmail ou Outlook, connexion sécurisée, 30 sec). Comme elle est déjà utilisée au quotidien, vous pouvez envoyer dès aujourd'hui.\n2. **Définissez votre ICP** (à qui vous vendez + quel problème vous résolvez).\n3. **Lancez votre première campagne** : Mirvo trouve les acheteurs, rédige chaque email et les met en file pour votre approbation.\n\nIl existe plusieurs façons d'envoyer avec Mirvo : votre propre boîte est le moyen le plus rapide de démarrer, et vous pourrez ajouter un domaine d'envoi dédié plus tard. [Voir quelle configuration vous convient]({{baseUrl}}/help/choosing-your-sending-setup).",
      ctaLabel:  'Ouvrir Mirvo',
      ctaPath:   '/dashboard',
    },
  },

  // ─── onboarding_d2 ────────────────────────────────────────────────────────
  onboarding_d2: {
    en: {
      subject:   'How Mirvo finds buyers (without you doing the research)',
      preheader: 'Mirvo watches for buying signals and drafts the email at the moment it matters.',
      heading:   'The unfair advantage',
      bodyMd:    "{{greeting}}\n\nMost outbound tools wait for you to upload a list. Mirvo does the opposite: it watches the signals that mean \"this prospect is ready to buy\" (hiring SDRs, funding rounds, new tool stack) and drafts the email at the moment it matters.\n\nSet up a signal once. Mirvo scans every night and queues drafts for your approval.\n\n[Read: how signals work]({{baseUrl}}/help/what-are-signals)",
      ctaLabel:  'Set up your first signal',
      ctaPath:   '/dashboard/signals',
    },
    fr: {
      subject:   "Comment Mirvo trouve vos acheteurs (sans que vous fassiez la recherche)",
      preheader: "Mirvo surveille les signaux d'achat et rédige l'email au moment qui compte.",
      heading:   "L'avantage décisif",
      bodyMd:    "{{greeting}}\n\nLa plupart des outils d'outbound attendent que vous importiez une liste. Mirvo fait l'inverse : il surveille les signaux qui indiquent qu'un prospect est prêt à acheter (recrutement de SDR, levées de fonds, nouveau stack d'outils) et rédige l'email au moment qui compte.\n\nConfigurez un signal une fois. Mirvo scanne chaque nuit et prépare les brouillons pour votre approbation.\n\n[Comment fonctionnent les signaux]({{baseUrl}}/help/what-are-signals)",
      ctaLabel:  'Configurer votre premier signal',
      ctaPath:   '/dashboard/signals',
    },
  },

  // ─── onboarding_d4 ────────────────────────────────────────────────────────
  onboarding_d4: {
    en: {
      subject:   'Will your cold emails actually land? (here\'s how Mirvo helps)',
      preheader: "Deliverability is the silent killer of outbound. Here's how to protect your reputation with Mirvo.",
      heading:   'Landing in the inbox',
      bodyMd:    "{{greeting}}\n\nReputation is the silent killer of cold outreach. Domains burn, deliverability drops, and your leads never see your messages.\n\nMirvo protects you two ways. Starting from your own mailbox means you send from an address that already has reputation, so there's nothing to warm up. And when you're ready for real volume, Mirvo can set up a dedicated sending domain — warmed up gradually so it earns trust the right way, while your connected mailbox keeps your outreach going in the meantime.\n\n[Read: how warmup and deliverability actually work]({{baseUrl}}/help/mailbox-warmup-explained)",
      ctaLabel:  'See your replies inbox',
      ctaPath:   '/dashboard/inbox',
    },
    fr: {
      subject:   'Vos cold emails vont-ils vraiment arriver ? (voici comment Mirvo aide)',
      preheader: "La délivrabilité est le tueur silencieux de l'outbound. Voici comment protéger votre réputation avec Mirvo.",
      heading:   'Arriver dans la boîte de réception',
      bodyMd:    "{{greeting}}\n\nLa réputation est le tueur silencieux du cold outreach. Les domaines se brûlent, la délivrabilité chute, et vos prospects ne voient jamais vos messages.\n\nMirvo vous protège de deux façons. Démarrer depuis votre propre boîte, c'est envoyer depuis une adresse qui a déjà une réputation : il n'y a rien à réchauffer. Et quand vous serez prêt pour du volume, Mirvo peut configurer un domaine d'envoi dédié, réchauffé progressivement pour gagner la confiance de la bonne manière, pendant que votre boîte connectée continue vos envois.\n\n[Comment fonctionnent réellement le warmup et la délivrabilité]({{baseUrl}}/help/mailbox-warmup-explained)",
      ctaLabel:  'Voir votre boîte de réponses',
      ctaPath:   '/dashboard/inbox',
    },
  },

  // ─── onboarding_d7 (UPGRADED — single dominant CTA) ───────────────────────
  onboarding_d7: {
    en: {
      subject:   'Your first week with Mirvo: the shortest path to your first replies',
      preheader: "One week in — here's the fastest path to your first replies.",
      heading:   'One week in.',
      bodyMd:    "{{greeting}}\n\nYou've had {{workspaceName}} on Mirvo for a week. If you've launched a campaign, replies should be starting to land. If not, there's just one thing to do today: launch your first campaign — Mirvo drafts, you approve.\n\nTwo tweaks that improve results when you have a minute: [sharpen your ICP]({{baseUrl}}/dashboard/settings) and [activate a signal]({{baseUrl}}/dashboard/signals).\n\nStuck? Reply to this email; we read every message.",
      ctaLabel:  'Launch a campaign',
      ctaPath:   '/dashboard/campaigns/new',
    },
    fr: {
      subject:   'Votre première semaine avec Mirvo : le plus court chemin vers vos premières réponses',
      preheader: 'Une semaine déjà — voici le chemin le plus rapide vers vos premières réponses.',
      heading:   'Une semaine déjà.',
      bodyMd:    "{{greeting}}\n\nCela fait une semaine que {{workspaceName}} est sur Mirvo. Si vous avez lancé une campagne, les réponses devraient commencer à arriver. Sinon, une seule chose à faire aujourd'hui : lancer votre première campagne — Mirvo rédige, vous approuvez.\n\nDeux réglages qui améliorent les résultats quand vous aurez une minute : [affiner votre ICP]({{baseUrl}}/dashboard/settings) et [activer un signal]({{baseUrl}}/dashboard/signals).\n\nBloqué ? Répondez à cet email, nous lisons chaque message.",
      ctaLabel:  'Lancer une campagne',
      ctaPath:   '/dashboard/campaigns/new',
    },
  },

  // ─── upgrade ──────────────────────────────────────────────────────────────
  upgrade: {
    en: {
      subject:   "You're on Mirvo {{planLabel}} — here's what's now unlocked",
      preheader: "Your upgrade is live. You've now got a dedicated sending domain available whenever you're ready to scale.",
      heading:   "You're on Mirvo {{planLabel}}",
      bodyMd:    "{{greeting}}\n\nYour upgrade is live for {{workspaceName}}. Thank you — here's what you've unlocked.\n\n**Higher sending limits.** Your quotas just went up. Keep sending from your connected mailbox as you always have — there's nothing to change.\n\n**A dedicated sending domain, whenever you're ready.** You can now have Mirvo set up a sending domain that's fully yours — it keeps your cold outreach separate from your main address and scales to full volume. A new domain warms up gradually over about 3 weeks, and your connected mailbox keeps your outreach going the whole time. No rush: set it up when it suits you.\n\nWant to understand your sending options before you decide? [Here's how each setup works]({{baseUrl}}/help/choosing-your-sending-setup).\n\nQuestions about your plan? Just reply — we read every message.",
      ctaLabel:  'Open Mirvo',
      ctaPath:   '/dashboard',
    },
    fr: {
      subject:   'Vous êtes sur Mirvo {{planLabel}} — voici ce qui est débloqué',
      preheader: "Votre passage est actif. Vous avez désormais un domaine d'envoi dédié disponible dès que vous voulez passer à l'échelle.",
      heading:   'Vous êtes sur Mirvo {{planLabel}}',
      bodyMd:    "{{greeting}}\n\nVotre passage est actif pour {{workspaceName}}. Merci — voici ce que vous avez débloqué.\n\n**Des limites d'envoi plus élevées.** Vos quotas viennent d'augmenter. Continuez d'envoyer depuis votre boîte connectée comme d'habitude, il n'y a rien à changer.\n\n**Un domaine d'envoi dédié, dès que vous êtes prêt.** Vous pouvez maintenant demander à Mirvo de configurer un domaine d'envoi entièrement à vous : il garde votre cold outreach séparé de votre adresse principale et monte jusqu'au plein volume. Un nouveau domaine se réchauffe progressivement sur environ 3 semaines, et votre boîte connectée continue vos envois pendant tout ce temps. Rien ne presse : configurez-le quand cela vous convient.\n\nEnvie de comprendre vos options d'envoi avant de décider ? [Voici comment fonctionne chaque configuration]({{baseUrl}}/help/choosing-your-sending-setup).\n\nDes questions sur votre offre ? Répondez simplement, nous lisons chaque message.",
      ctaLabel:  'Ouvrir Mirvo',
      ctaPath:   '/dashboard',
    },
  },

  // ─── dunning ──────────────────────────────────────────────────────────────
  // {{invoiceLine}} is caller-computed : either an empty string (no invoice
  // URL) OR the localized "In a hurry? … [pay this invoice directly]({{invoiceUrl}})."
  // line. Mirrors the conditional in the current sendDunningEmail helper.
  dunning: {
    en: {
      subject:   "Your Mirvo payment didn't go through — quick fix inside",
      preheader: 'Your card was likely just declined or expired. Updating it takes about 30 seconds and your campaigns keep running.',
      heading:   'A quick heads-up about your payment',
      bodyMd:    "{{greeting}}\n\nWe tried to process a payment{{amountPhrase}} for your Mirvo{{planPhrase}} subscription on {{workspaceName}}, and it didn't go through. This is almost always something small — an expired card, a new card number, or a temporary hold from the bank.\n\nUpdating your payment details takes about 30 seconds, and we'll retry automatically once it's sorted.\n\n{{invoiceLine}}\n\nYour account stays active while you sort this out — there's no rush, and nothing is lost. If the payment keeps failing over the next couple of weeks, your subscription could eventually be canceled, but you can update your card any time and pick right back up.\n\nQuestions, or think this is a mistake? Just reply — we read every message.",
      ctaLabel:  'Update payment method',
      ctaPath:   '/dashboard/billing',
    },
    fr: {
      subject:   "Votre paiement Mirvo n'est pas passé — solution rapide à l'intérieur",
      preheader: 'Votre carte a probablement été refusée ou a expiré. La mettre à jour prend environ 30 secondes et vos campagnes continuent.',
      heading:   'Un petit point sur votre paiement',
      bodyMd:    "{{greeting}}\n\nNous avons tenté de traiter un paiement{{amountPhrase}} pour votre abonnement Mirvo{{planPhrase}} sur {{workspaceName}}, et il n'est pas passé. C'est presque toujours quelque chose de mineur : une carte expirée, un nouveau numéro, ou un blocage temporaire de la banque.\n\nMettre à jour vos informations de paiement prend environ 30 secondes, et nous réessaierons automatiquement une fois que ce sera réglé.\n\n{{invoiceLine}}\n\nVotre compte reste actif le temps de régler cela, rien ne presse et rien n'est perdu. Si le paiement continue d'échouer dans les deux prochaines semaines, votre abonnement pourrait finir par être résilié, mais vous pouvez mettre à jour votre carte à tout moment et reprendre là où vous en étiez.\n\nUne question, ou vous pensez qu'il s'agit d'une erreur ? Répondez simplement, nous lisons chaque message.",
      ctaLabel:  'Mettre à jour le moyen de paiement',
      ctaPath:   '/dashboard/billing',
    },
  },

  // ─── dunning_j3 (3 days past due) ─────────────────────────────────────────
  // Same placeholder set as `dunning` (J0) — invoiceLine is caller-computed
  // per invoice ; empty when no hostedInvoiceUrl is available.
  dunning_j3: {
    en: {
      subject:   "Still can't process your Mirvo payment — let's fix it",
      preheader: 'Your subscription is still past due. A 30-second card update keeps everything running.',
      heading:   'Your payment is still pending',
      bodyMd:    "{{greeting}}\n\nWe still haven't been able to process your payment{{amountPhrase}} for Mirvo{{planPhrase}} on {{workspaceName}}. Your account is still active, but it won't stay that way indefinitely.\n\nUpdating your card takes about 30 seconds and we'll retry right away.\n\n{{invoiceLine}}\n\nIf you've already updated it, ignore this — the next retry will clear it.\n\nQuestions? Just reply, we read every message.",
      ctaLabel:  'Update payment method',
      ctaPath:   '/dashboard/billing',
    },
    fr: {
      subject:   'Toujours impossible de traiter votre paiement Mirvo — réglons ça',
      preheader: 'Votre abonnement est encore en souffrance. Une mise à jour de carte en 30 secondes garde tout en marche.',
      heading:   'Votre paiement est toujours en attente',
      bodyMd:    "{{greeting}}\n\nNous n'avons toujours pas réussi à traiter votre paiement{{amountPhrase}} pour Mirvo{{planPhrase}} sur {{workspaceName}}. Votre compte est encore actif, mais cela ne durera pas indéfiniment.\n\nMettre à jour votre carte prend environ 30 secondes et nous réessaierons aussitôt.\n\n{{invoiceLine}}\n\nSi vous l'avez déjà mise à jour, ignorez ce message — le prochain essai régularisera tout.\n\nUne question ? Répondez simplement, nous lisons chaque message.",
      ctaLabel:  'Mettre à jour le moyen de paiement',
      ctaPath:   '/dashboard/billing',
    },
  },

  // ─── dunning_j7 (7 days past due — final notice before cancellation) ──────
  dunning_j7: {
    en: {
      subject:   'Action needed: your Mirvo subscription is about to be canceled',
      preheader: 'Last reminder before your subscription is canceled. Update your card to keep your campaigns running.',
      heading:   'Last reminder before your subscription is canceled',
      bodyMd:    "{{greeting}}\n\nWe've tried several times to process your payment{{amountPhrase}} for Mirvo{{planPhrase}} on {{workspaceName}}, without success. If it isn't resolved shortly, your subscription will be canceled and your campaigns will stop.\n\nYou wouldn't lose everything right away: after cancellation your workspace and data are kept for 30 days, so you can reactivate and pick up exactly where you left off. After that, they're permanently deleted.\n\n{{invoiceLine}}\n\nUpdating your card takes about 30 seconds and keeps everything running. Need a hand or think this is a mistake? Just reply — a real person will help.",
      ctaLabel:  'Update payment method',
      ctaPath:   '/dashboard/billing',
    },
    fr: {
      subject:   'Action requise : votre abonnement Mirvo va être résilié',
      preheader: 'Dernier rappel avant la résiliation de votre abonnement. Mettez à jour votre carte pour garder vos campagnes actives.',
      heading:   'Dernier rappel avant la résiliation de votre abonnement',
      bodyMd:    "{{greeting}}\n\nNous avons tenté plusieurs fois de traiter votre paiement{{amountPhrase}} pour Mirvo{{planPhrase}} sur {{workspaceName}}, sans succès. Si ce n'est pas réglé rapidement, votre abonnement sera résilié et vos campagnes s'arrêteront.\n\nVous ne perdriez pas tout immédiatement : après la résiliation, votre espace et vos données sont conservés 30 jours, le temps de vous réabonner et de reprendre exactement là où vous en étiez. Passé ce délai, ils sont définitivement supprimés.\n\n{{invoiceLine}}\n\nMettre à jour votre carte prend environ 30 secondes et garde tout en marche. Besoin d'aide ou vous pensez qu'il s'agit d'une erreur ? Répondez, une vraie personne vous aidera.",
      ctaLabel:  'Mettre à jour le moyen de paiement',
      ctaPath:   '/dashboard/billing',
    },
  },

  // ─── cancellation ─────────────────────────────────────────────────────────
  cancellation: {
    en: {
      subject:   'Your Mirvo subscription is canceled — your data is kept for 30 days',
      preheader: 'Your subscription has ended. Your workspace and data are kept for 30 days — re-subscribe before then to keep everything.',
      heading:   'Your subscription is canceled',
      bodyMd:    "{{greeting}}\n\nWe've canceled your Mirvo{{planPhrase}} subscription for {{workspaceName}}. No more charges — and thank you for the time you spent with us.\n\n**Your workspace stays available for 30 days.** Your prospects, campaigns, and everything you built are kept for the next 30 days. Re-subscribe within that window and you pick up exactly where you left off — nothing lost.\n\nAfter 30 days, your data is permanently deleted and can't be recovered. So if there's any chance you'll come back, re-subscribing before then keeps all your work intact.\n\nOne quick favor: if you have a minute, what made you cancel? Just reply — a real person reads every message, and your answer helps us build something better.",
      ctaLabel:  'Re-subscribe',
      ctaPath:   '/dashboard/billing',
    },
    fr: {
      subject:   'Votre abonnement Mirvo est résilié — vos données sont conservées 30 jours',
      preheader: 'Votre abonnement a pris fin. Votre espace et vos données sont conservés 30 jours — réabonnez-vous avant pour tout garder.',
      heading:   'Votre abonnement est résilié',
      bodyMd:    "{{greeting}}\n\nNous avons résilié votre abonnement Mirvo{{planPhrase}} pour {{workspaceName}}. Plus aucun prélèvement — et merci pour le temps passé avec nous.\n\n**Votre espace reste disponible 30 jours.** Vos prospects, vos campagnes et tout ce que vous avez construit sont conservés pendant les 30 prochains jours. Réabonnez-vous dans ce délai et vous reprenez exactement là où vous vous étiez arrêté, sans rien perdre.\n\nPassé 30 jours, vos données sont définitivement supprimées et ne peuvent être récupérées. Donc s'il y a la moindre chance que vous reveniez, vous réabonner avant garde tout votre travail intact.\n\nUne petite faveur : si vous avez une minute, qu'est-ce qui vous a fait résilier ? Répondez simplement — une vraie personne lit chaque message, et votre réponse nous aide à construire quelque chose de meilleur.",
      ctaLabel:  'Se réabonner',
      ctaPath:   '/dashboard/billing',
    },
  },

  // ─── winback (~23 days after cancellation, before the 30-day purge) ───────
  // Sent once per workspace via lifecycle_emails UNIQUE(workspace_id, 'winback').
  // No planPhrase / amount vars : by this point the plan tier from before the
  // cancellation isn't load-bearing to the message ; the ask is "reactivate to
  // keep your data", not "renew your specific plan".
  winback: {
    en: {
      subject:   'Your Mirvo workspace is about to be deleted — one click keeps it',
      preheader: 'Your prospects and campaigns are kept for a few more days. Reactivate to keep everything.',
      heading:   'Your workspace is still here — for now',
      bodyMd:    "{{greeting}}\n\nA little while ago you canceled Mirvo for {{workspaceName}}. We kept everything — your prospects, campaigns, and settings — in case you came back.\n\nThat 30-day window is almost up: in about a week, {{workspaceName}} and all its data will be permanently deleted.\n\nIf there's any chance you'll use Mirvo again, reactivating now keeps everything exactly as you left it. If not, no hard feelings — you don't need to do anything.\n\nOne quick question if you have a second: what made Mirvo not the right fit? Just reply — a real person reads every message, and it genuinely helps us.",
      ctaLabel:  'Reactivate Mirvo',
      ctaPath:   '/dashboard/billing',
    },
    fr: {
      subject:   'Votre espace Mirvo va être supprimé — un clic pour le garder',
      preheader: 'Vos prospects et campagnes sont conservés encore quelques jours. Réactivez pour tout garder.',
      heading:   "Votre espace est encore là — pour l'instant",
      bodyMd:    "{{greeting}}\n\nIl y a quelque temps, vous avez résilié Mirvo pour {{workspaceName}}. Nous avons tout conservé — vos prospects, vos campagnes et vos réglages — au cas où vous reviendriez.\n\nCe délai de 30 jours touche à sa fin : dans une semaine environ, {{workspaceName}} et toutes ses données seront définitivement supprimés.\n\nS'il y a la moindre chance que vous réutilisiez Mirvo, réactiver maintenant garde tout exactement comme vous l'aviez laissé. Sinon, aucun souci — vous n'avez rien à faire.\n\nUne petite question si vous avez une seconde : qu'est-ce qui a fait que Mirvo n'était pas le bon choix ? Répondez simplement — une vraie personne lit chaque message, et ça nous aide vraiment.",
      ctaLabel:  'Réactiver Mirvo',
      ctaPath:   '/dashboard/billing',
    },
  },

  // ─── signal_digest (upgraded — benefit-oriented) ──────────────────────────
  signal_digest: {
    en: {
      subject:   '{{matchCount}} prospect(s) ready to reach out to on your campaigns',
      preheader: 'Mirvo spotted new signals overnight. Generate the emails in one click.',
      heading:   'New prospects to reach out to',
      bodyMd:    '{{greeting}}\n\nMirvo detected new signals on your campaigns overnight:\n\n{{matchList}}\n\nOpen the Approval Queue to generate personalized emails for these prospects.',
      ctaLabel:  'Open the Approval Queue',
      ctaPath:   '/dashboard',
    },
    fr: {
      subject:   '{{matchCount}} prospect(s) prêt(s) à être contacté(s) sur vos campagnes',
      preheader: 'Mirvo a repéré de nouveaux signaux cette nuit. Générez les emails en un clic.',
      heading:   'De nouveaux prospects à contacter',
      bodyMd:    "{{greeting}}\n\nMirvo a détecté de nouveaux signaux sur vos campagnes cette nuit :\n\n{{matchList}}\n\nOuvrez la file d'approbation pour générer des emails personnalisés pour ces prospects.",
      ctaLabel:  "Ouvrir la file d'approbation",
      ctaPath:   '/dashboard',
    },
  },
}
