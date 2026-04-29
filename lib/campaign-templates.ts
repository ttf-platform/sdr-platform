export interface CampaignTemplate {
  id: string
  emoji: string
  label: string
  description: string
  angle: string | null
  value_prop: string | null
  cta: string | null
  target_persona: string | null
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: 'saas-cold',
    emoji: '🚀',
    label: 'SaaS Cold Outreach',
    description: 'Drive demo bookings from decision-makers at target SaaS companies.',
    angle: 'Help {{company}} reduce churn and accelerate growth',
    value_prop: 'Teams using our product cut onboarding time and improve trial-to-paid conversion.',
    cta: 'Would you be open to a 20-minute demo this week?',
    target_persona: 'VP of Product or Head of Growth at B2B SaaS companies (50-500 employees)',
  },
  {
    id: 'agency-lead-gen',
    emoji: '📣',
    label: 'Agency Lead Gen',
    description: 'Win new retainer clients for your agency with a pain-first approach.',
    angle: 'Most marketing teams waste 30% of ad budget on poorly targeted campaigns',
    value_prop: 'Our agency has generated $2M+ in pipeline for clients in your space this year.',
    cta: "Can I share a 5-minute breakdown of what's working for similar companies?",
    target_persona: 'Marketing Directors or CMOs at e-commerce or DTC brands ($1M-$50M revenue)',
  },
  {
    id: 'startup-partnership',
    emoji: '🤝',
    label: 'Startup Partnership',
    description: 'Propose co-marketing, integration, or reseller partnerships.',
    angle: "Our users overlap heavily with {{company}}'s customer base — there's a co-sell opportunity",
    value_prop: 'Partners in our ecosystem average 3x more logo growth in the first quarter.',
    cta: 'Would you be open to a quick call to explore what a partnership could look like?',
    target_persona: 'Head of Partnerships or Business Development at early-to-mid stage startups',
  },
  {
    id: 'investor-outreach',
    emoji: '💼',
    label: 'Investor Outreach',
    description: 'Warm introduction to investors aligned with your stage and sector.',
    angle: "We're seeing strong early traction in a space you have conviction in",
    value_prop: "We've grown 3x in 6 months and are cash-efficient with strong retention metrics.",
    cta: 'Would you be open to a 30-minute intro call this month?',
    target_persona: 'General Partners or investment professionals at seed/Series A venture funds',
  },
  {
    id: 'freelancer-clients',
    emoji: '💻',
    label: 'Freelancer Clients',
    description: 'Land new clients for your freelance or consulting practice.',
    angle: '{{company}} is scaling fast — your team likely needs extra capacity',
    value_prop: "I've delivered projects for companies at your stage, on time and on budget.",
    cta: 'Are you currently looking for freelance help on any projects?',
    target_persona: 'CTOs, Engineering Managers, or Founders at startups scaling their team (10-100 employees)',
  },
  {
    id: 'ecommerce-b2b',
    emoji: '🛒',
    label: 'E-commerce B2B',
    description: 'Sell wholesale, bulk, or enterprise contracts to retail buyers.',
    angle: 'We help distributors like {{company}} increase margin without adding SKU complexity',
    value_prop: 'Our wholesale clients see an average 22% margin improvement within 90 days.',
    cta: 'Would it make sense to jump on a quick call to see if we\'re a fit?',
    target_persona: 'Procurement Managers or Category Buyers at retail chains or distributors',
  },
  {
    id: 'blank',
    emoji: '✦',
    label: 'Blank Canvas',
    description: 'Start from scratch with a fully custom campaign.',
    angle: null,
    value_prop: null,
    cta: null,
    target_persona: null,
  },
]
