'use client'

import Link from 'next/link'
import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { signOut } from '@/app/admin/session-actions'
import { editChain, runChain, type ActionState } from './actions'
import type { Output, Step } from '@/utils/chains/runner'
import './workspace.css'

type Chain = { id: string; name: string; description: string | null }
type Model = { id: string; name: string }
type Run = { id: string; input: string; image_url: string | null; status: string; outputs: Output[]; error: string | null; created_at: string }

function Submit({ children }: { children: React.ReactNode }) {
    const { pending } = useFormStatus()
    return <button disabled={pending} type="submit">{pending ? 'Working…' : children}</button>
}

function ActionForm({ children, operation, chainId, confirm, generate = false }: {
    children: React.ReactNode; operation?: string; chainId?: string; confirm?: string; generate?: boolean
}) {
    const [state, action, pending] = useActionState<ActionState, FormData>(generate ? runChain : editChain, {})
    return <form action={action} onSubmit={event => { if (confirm && !window.confirm(confirm)) event.preventDefault() }}>
        <input type="hidden" name="operation" value={operation ?? ''} />
        <input type="hidden" name="chain_id" value={chainId ?? ''} />
        <fieldset disabled={pending}>{children}</fieldset>
        <div aria-live="polite" className="chain-feedback">
            {pending && <p>{generate ? 'Generating step by step. This can take a few minutes…' : 'Saving…'}</p>}
            {state.error && <p role="alert">{state.error}</p>}
            {state.success && <p>{state.success} {operation === 'create_chain' && state.id && <Link href={`/chains?chain=${state.id}`}>Open chain →</Link>}</p>}
        </div>
    </form>
}

function Theme() {
    const ref = useRef<HTMLSelectElement>(null)
    useEffect(() => {
        let theme = 'system'
        try { theme = localStorage.getItem('chain-theme') ?? 'system' } catch {}
        if (!['system', 'light', 'dark'].includes(theme)) theme = 'system'
        document.documentElement.dataset.chainTheme = theme
        if (ref.current) ref.current.value = theme
        return () => { delete document.documentElement.dataset.chainTheme }
    }, [])
    return <label>Appearance <select ref={ref} defaultValue="system" onChange={event => {
        const theme = event.target.value
        document.documentElement.dataset.chainTheme = theme
        try { localStorage.setItem('chain-theme', theme) } catch {}
    }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
}

function StepFields({ step, models }: { step?: Step; models: Model[] }) {
    return <>
        {step && <input type="hidden" name="id" value={step.id} />}
        <label>Model<select name="llm_model_id" defaultValue={step?.llm_model_id ?? ''}>
            <option value="">Server default (Gemini)</option>
            {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select></label>
        <label>System prompt<textarea name="system_prompt" maxLength={16000} rows={2} defaultValue={step?.system_prompt ?? ''} placeholder="You write sharp, playful captions." /></label>
        <label>User prompt<textarea name="user_prompt" required maxLength={16000} rows={4} defaultValue={step?.user_prompt ?? ''} placeholder="Write five short captions based on: {{previous}}" /></label>
        <Submit>{step ? 'Save step' : 'Add step'}</Submit>
    </>
}

export function ChainWorkspace({ chains, chain, steps, models, runs }: {
    chains: Chain[]; chain?: Chain; steps: Step[]; models: Model[]; runs: Run[]
}) {
    return <main className="chain-studio">
        <header className="chain-header"><div><p className="chain-eyebrow">BOROUGH / CREATIVE TOOLS</p><h1>Prompt chain studio</h1><p>One idea. A sequence of possibilities.</p></div>
            <div className="chain-toolbar"><Theme /><Link href="/admin">Admin area ↗</Link><form action={signOut}><button>Sign out</button></form></div>
        </header>
        <div className="chain-workspace">
            <aside className="chain-panel"><h2>Your chains <span>{chains.length}</span></h2><nav aria-label="Prompt chains">
                {chains.length === 0 && <p>Create your first chain below.</p>}
                {chains.map(item => <Link className="chain-link" aria-current={item.id === chain?.id ? 'page' : undefined} key={item.id} href={`/chains?chain=${item.id}`}>{item.name}<span>→</span></Link>)}
            </nav><details open={!chain}><summary>Create a chain</summary>
                <ActionForm operation="create_chain"><label>Name<input name="name" required maxLength={200} placeholder="Image to funny captions" /></label><label>Description<textarea name="description" rows={3} maxLength={4000} placeholder="What will this chain do?" /></label><Submit>Create chain</Submit></ActionForm>
            </details><p className="chain-hint">Showing the latest 200 chains.</p></aside>
            <section className="chain-main" aria-label="Chain editor">
                {!chain ? <div className="chain-panel"><h2>Build something step by step</h2><p>Create a chain, add prompts, then run it with text or an image.</p></div> : <>
                    <div className="chain-panel"><p className="chain-eyebrow">CHAIN SETTINGS</p><h2>{chain.name}</h2>
                        <ActionForm operation="update_chain" chainId={chain.id}><label>Name<input name="name" required maxLength={200} defaultValue={chain.name} /></label><label>Description<textarea name="description" maxLength={4000} rows={2} defaultValue={chain.description ?? ''} /></label><Submit>Save chain</Submit></ActionForm>
                        <details><summary className="chain-danger">Delete this chain</summary><p>Deletes its steps and saved runs. This cannot be undone.</p><ActionForm operation="delete_chain" chainId={chain.id} confirm={`Delete “${chain.name}” and all its steps and runs?`}><Submit>Delete chain permanently</Submit></ActionForm></details>
                    </div>
                    <div className="chain-section-title"><h2>Steps</h2><span>{steps.length} / 8</span></div>
                    <p className="chain-hint">Steps run from top to bottom. Use {'{{input}}'} for the original input and {'{{previous}}'} for the last output. If omitted, the previous output is appended automatically. The first step receives the optional image.</p>
                    {steps.length === 0 && <p className="chain-panel">No steps yet. Add your first prompt below.</p>}
                    {steps.map((step, index) => <article className="chain-panel" key={step.id}>
                        <div className="chain-section-title"><h3><span className="chain-number">{index + 1}</span> Prompt step</h3><div className="chain-step-tools">
                            {(['up', 'down'] as const).map(direction => <ActionForm key={direction} operation="move_step" chainId={chain.id}><input type="hidden" name="id" value={step.id} /><input type="hidden" name="direction" value={direction} /><button disabled={direction === 'up' ? index === 0 : index === steps.length - 1} aria-label={`Move step ${index + 1} ${direction}`}>{direction === 'up' ? '↑' : '↓'}</button></ActionForm>)}
                        </div></div>
                        <ActionForm operation="update_step" chainId={chain.id}><StepFields step={step} models={models} /></ActionForm>
                        <ActionForm operation="delete_step" chainId={chain.id} confirm={`Delete step ${index + 1}?`}><input type="hidden" name="id" value={step.id} /><Submit>Delete step</Submit></ActionForm>
                    </article>)}
                    {steps.length < 8 && <details className="chain-panel" open={steps.length === 0}><summary>Add a step</summary><ActionForm operation="create_step" chainId={chain.id}><StepFields models={models} /></ActionForm></details>}
                </>}
            </section>
            <section className="chain-results" aria-label="Generation and history">{chain && <>
                <div className="chain-panel"><p className="chain-eyebrow">TRY YOUR CHAIN</p><h2>Generate captions & text</h2><p>Run saved steps with a new idea. Save your edits before generating.</p>
                    <ActionForm generate chainId={chain.id}><label>Starting input<textarea name="input" required rows={4} maxLength={16000} placeholder="Describe your idea or tell the chain what to do with the image…" /></label><label>Image URL · optional<input name="image_url" type="url" placeholder="https://…" /></label><p className="chain-hint">Use a publicly accessible HTTPS image. Select a Gemini vision model when using an image.</p><button disabled={!steps.length}>Run {steps.length} {steps.length === 1 ? 'step' : 'steps'} →</button></ActionForm>
                </div>
                <div className="chain-section-title"><h2>Run history</h2><Link href={`/chains?chain=${chain.id}`}>Refresh</Link></div>
                <p className="chain-hint">Latest 30 runs for this chain.</p>
                {runs.length === 0 && <p className="chain-panel">Your generated captions and text will appear here.</p>}
                {runs.map(run => <article className="chain-panel" key={run.id}><div className="chain-section-title"><strong className="chain-status">{run.status}</strong><time dateTime={run.created_at}>{new Date(run.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC</time></div><p className="chain-output">{run.input}</p>
                    {run.image_url && <a href={run.image_url} target="_blank" rel="noreferrer">View source image ↗</a>}
                    {run.error && <p role="alert">{run.error}</p>}
                    {run.status === 'running' && <p className="chain-hint">Refresh for results. An interrupted server request may remain marked as running; start a new run if needed.</p>}
                    {run.outputs.map((output, index) => <details key={index} open={index === run.outputs.length - 1}><summary>Step {index + 1} · {output.model}</summary><p className="chain-output">{output.text}</p><details><summary>Prompt snapshot</summary><p className="chain-output">{output.system_prompt}</p><p className="chain-output">{output.prompt}</p></details></details>)}
                </article>)}
            </>}</section>
        </div>
    </main>
}
