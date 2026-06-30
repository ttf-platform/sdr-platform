import type { ComponentType } from 'react'

import HowMirvoWorks from '@/content/help/how-mirvo-works.mdx'
import SevenStepSetup from '@/content/help/7-step-setup.mdx'
import MasterICP from '@/content/help/master-icp.mdx'
import AddingSendingDomain from '@/content/help/adding-a-sending-domain.mdx'
import ChoosingYourSendingSetup from '@/content/help/choosing-your-sending-setup.mdx'
import MailboxWarmupExplained from '@/content/help/mailbox-warmup-explained.mdx'
import WhatAreSignals from '@/content/help/what-are-signals.mdx'
import CreateYourFirstCampaign from '@/content/help/create-your-first-campaign.mdx'
import ApprovalQueueWorkflow from '@/content/help/approval-queue-workflow.mdx'
import PlansPricing from '@/content/help/plans-pricing.mdx'
import Troubleshooting from '@/content/help/troubleshooting.mdx'
import HowAiWritesPersonalizedEmails from '@/content/help/how-ai-writes-personalized-emails.mdx'
import SubjectLineBestPractices from '@/content/help/subject-line-best-practices.mdx'
import CreatingCustomSignals from '@/content/help/creating-custom-signals.mdx'
import AutoScanAndApprovalQueue from '@/content/help/auto-scan-and-approval-queue.mdx'
import EditingAiVariants from '@/content/help/editing-ai-variants.mdx'
import LaunchCampaignChecklist from '@/content/help/launch-campaign-checklist.mdx'
import WhyEmailsGoToSpam from '@/content/help/why-emails-go-to-spam.mdx'
import QuotasExplained from '@/content/help/quotas-explained.mdx'
import LinkingYourMailbox from '@/content/help/linking-your-mailbox.mdx'
import PickingYourProspects from '@/content/help/picking-your-prospects.mdx'
import ReadingYourReplyInbox from '@/content/help/reading-your-reply-inbox.mdx'

export const MDX_MODULES: Record<string, ComponentType> = {
  'how-mirvo-works': HowMirvoWorks,
  '7-step-setup': SevenStepSetup,
  'master-icp': MasterICP,
  'adding-a-sending-domain': AddingSendingDomain,
  'choosing-your-sending-setup': ChoosingYourSendingSetup,
  'mailbox-warmup-explained': MailboxWarmupExplained,
  'what-are-signals': WhatAreSignals,
  'create-your-first-campaign': CreateYourFirstCampaign,
  'approval-queue-workflow': ApprovalQueueWorkflow,
  'plans-pricing': PlansPricing,
  'troubleshooting': Troubleshooting,
  'how-ai-writes-personalized-emails': HowAiWritesPersonalizedEmails,
  'subject-line-best-practices': SubjectLineBestPractices,
  'creating-custom-signals': CreatingCustomSignals,
  'auto-scan-and-approval-queue': AutoScanAndApprovalQueue,
  'editing-ai-variants': EditingAiVariants,
  'launch-campaign-checklist': LaunchCampaignChecklist,
  'why-emails-go-to-spam': WhyEmailsGoToSpam,
  'quotas-explained': QuotasExplained,
  'linking-your-mailbox': LinkingYourMailbox,
  'picking-your-prospects': PickingYourProspects,
  'reading-your-reply-inbox': ReadingYourReplyInbox,
}
