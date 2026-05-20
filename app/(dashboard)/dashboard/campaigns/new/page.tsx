import { redirect } from 'next/navigation'

export default function NewCampaignPage() {
  redirect('/dashboard/campaigns?action=new')
}
