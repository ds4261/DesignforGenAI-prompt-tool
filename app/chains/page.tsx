import { Suspense } from 'react'
import { requireAdmin } from '@/utils/supabase/admin'
import { ChainWorkspace } from './workspace'

export const maxDuration = 300
export const metadata = { title: 'Borough | Prompt chain studio' }

async function Workspace({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
    const { chain: selected } = await searchParams
    const { supabase } = await requireAdmin()
    const { data: chains, error } = await supabase.from('prompt_chains').select('id,name,description').order('created_at', { ascending: false }).limit(200)
    if (error) return <main className="chain-studio"><h1>Prompt chain studio</h1><p role="alert">Unable to load chains: {error.message}</p></main>
    const chain = chains?.find(chain => chain.id === selected) ?? chains?.[0]
    const [steps, models, runs] = await Promise.all([
        chain ? supabase.from('prompt_chain_steps').select('id,step_order,system_prompt,user_prompt,llm_model_id').eq('prompt_chain_id', chain.id).order('step_order') : Promise.resolve({ data: [], error: null }),
        supabase.from('llm_models').select('id,name').order('name'),
        chain ? supabase.from('prompt_chain_runs').select('id,input,image_url,status,outputs,error,created_at').eq('prompt_chain_id', chain.id).order('created_at', { ascending: false }).limit(30) : Promise.resolve({ data: [], error: null }),
    ])
    const loadError = steps.error || models.error || runs.error
    if (loadError) return <main className="chain-studio"><h1>Prompt chain studio</h1><p role="alert">Unable to load the editor: {loadError.message}. Apply the prompt chain tool migration if it has not been installed.</p></main>
    return <ChainWorkspace key={chain?.id ?? 'empty'} chains={chains ?? []} chain={chain} steps={steps.data ?? []} models={models.data ?? []} runs={runs.data ?? []} />
}

export default function ChainsPage({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
    return <Suspense fallback={<p className="p-8">Loading prompt chains…</p>}><Workspace searchParams={searchParams} /></Suspense>
}
