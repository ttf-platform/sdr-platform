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
    id: 'recruitment-clients',
    emoji: '🎯',
    label: 'Recruitment Clients',
    description: 'Land new client companies for your recruitment or staffing desk.',
    angle: 'Open roles at {{company}} that stay unfilled for weeks quietly cost revenue and burn out the team covering the gap',
    value_prop: 'We fill specialist roles faster than in-house hiring, on a model built for lean teams.',
    cta: 'Worth a quick call about your open roles?',
    target_persona: 'Founders or Heads of Talent at growing companies with open specialist roles',
  },
  {
    id: 'agency-clients',
    emoji: '📣',
    label: 'Agency Retainers',
    description: 'Win new retainer clients for your agency.',
    angle: 'Most teams at {{company}} run growth on the side of their real job, so it stalls and no one owns it',
    value_prop: 'We run your growth channels as an extension of your team, so you get output without another hire.',
    cta: 'Open to a short call on what is working for similar brands?',
    target_persona: 'Founders or marketing leads at B2B or DTC brands without a full in-house marketing team',
  },
  {
    id: 'consultant',
    emoji: '💼',
    label: 'Consulting Engagements',
    description: 'Win clients for your consulting or fractional practice.',
    angle: 'Scaling fast means {{company}} keeps hitting problems it has never solved before, with no one in-house who has',
    value_prop: 'I have solved exactly this for companies at your stage and can step in without a long ramp.',
    cta: 'Would a quick call to talk it through be useful?',
    target_persona: 'Founders or executives at companies scaling through a stage you have navigated before',
  },
  {
    id: 'b2b-service',
    emoji: '🤝',
    label: 'B2B Service Outreach',
    description: 'Reach decision-makers at companies that fit your service.',
    angle: 'Teams at {{company}} lose time and money on a problem your service removes',
    value_prop: 'We help companies like yours fix this without adding headcount or complexity.',
    cta: 'Worth a quick conversation to see if it is a fit?',
    target_persona: 'Decision-makers at companies matching your ideal client profile',
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
