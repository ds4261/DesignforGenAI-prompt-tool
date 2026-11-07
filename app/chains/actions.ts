'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/utils/supabase/admin'
import { executeChain, responseText, type Output, type Step } from '@/utils/chains/runner'

export type ActionState = { error?: string; success?: string; id?: string }
const operations = ['create_chain', 'update_chain', 'delete_chain', 'create_step', 'update_step', 'delete_step', 'move_step']

export async function editChain(_state: ActionState, form: FormData): Promise<ActionState> {
    const { supabase } = await requireAdmin()
    const operation = String(form.get('operation'))
    if (!operations.includes(operation)) return { error: 'Invalid operation' }
    const payload = Object.fromEntries(['id', 'name', 'description', 'system_prompt', 'user_prompt', 'llm_model_id', 'direction'].map(key => [key, String(form.get(key) ?? '')]))
    const { data, error } = await supabase.rpc('edit_prompt_chain', { operation, chain_id: form.get('chain_id') || null, payload })
    if (error) return { error: error.message }
    revalidatePath('/chains')
    revalidatePath('/admin/prompt-chains')
    revalidatePath('/admin/prompt-chain-steps')
    return { success: 'Saved.', id: data }
}

export async function runChain(_state: ActionState, form: FormData): Promise<ActionState> {
    const { supabase, user } = await requireAdmin()
    if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) return { error: 'Generation needs GEMINI_API_KEY and GEMINI_MODEL configured on the server.' }
    const chainId = String(form.get('chain_id') ?? '')
    const input = String(form.get('input') ?? '').trim()
    const imageUrl = String(form.get('image_url') ?? '').trim() || null
    if (!input || input.length > 16000) return { error: 'Enter between 1 and 16,000 characters of input.' }
    if (imageUrl) {
        try { if (new URL(imageUrl).protocol !== 'https:') throw new Error() }
        catch { return { error: 'Use a public HTTPS image URL.' } }
    }
    const [stepResult, modelResult, providerResult] = await Promise.all([
        supabase.from('prompt_chain_steps').select('id,step_order,system_prompt,user_prompt,llm_model_id').eq('prompt_chain_id', chainId).order('step_order'),
        supabase.from('llm_models').select('id,name,provider_id'),
        supabase.from('llm_providers').select('id,name'),
    ])
    if (stepResult.error || modelResult.error || providerResult.error) return { error: 'Unable to load steps or model configuration.' }
    const steps = stepResult.data as Step[]
    if (!steps.length || steps.length > 8) return { error: 'A runnable chain needs between one and eight steps.' }
    const models = new Map(modelResult.data.map(model => [model.id, model]))
    const providers = new Map(providerResult.data.map(provider => [provider.id, provider.name.trim().toLowerCase()]))
    for (const step of steps) {
        if (step.llm_model_id) {
            const model = models.get(step.llm_model_id)
            if (!model || !['google', 'gemini', 'google gemini', 'google ai'].includes(providers.get(model.provider_id) ?? '')) return { error: 'Select a Gemini model for every step, or use the server default.' }
        }
    }
    const { data: run, error } = await supabase.from('prompt_chain_runs').insert({ prompt_chain_id: chainId, user_id: user.id, input, image_url: imageUrl }).select('id').single()
    if (error) return { error: error.message }
    let savedOutputs: Output[] = []
    // Bound the entire run below the route's execution limit.
    const deadline = Date.now() + 240_000
    try {
        await executeChain(steps, input, imageUrl,
            step => step.llm_model_id ? models.get(step.llm_model_id)!.name : process.env.GEMINI_MODEL!,
            async (model, instructions, prompt, image) => {
                const remaining = deadline - Date.now()
                if (remaining <= 0) throw new Error('Run timed out. Try a shorter chain.')
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`, {
                    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(Math.min(remaining, 60_000)),
                    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY!, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...(instructions ? { systemInstruction: { parts: [{ text: instructions }] } } : {}),
                        generationConfig: { maxOutputTokens: 2048 },
                        contents: [{ role: 'user', parts: [{ text: prompt }, ...(image ? [{ fileData: { fileUri: image } }] : [])] }],
                    }),
                })
                if (!response.ok) throw new Error(`Model request failed (${response.status}). Check model access, API credits, and image URL.`)
                return responseText(await response.json())
            }, async outputs => {
                savedOutputs = outputs
                const { error } = await supabase.from('prompt_chain_runs').update({ outputs }).eq('id', run.id)
                if (error) throw new Error('Unable to save step output.')
            })
        const { error } = await supabase.from('prompt_chain_runs').update({ status: 'completed' }).eq('id', run.id)
        if (error) throw new Error('Unable to mark this run complete.')
        revalidatePath('/chains')
        return { success: 'Generation complete. View the output in run history.' }
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Generation failed.'
        const { error: saveError } = await supabase.from('prompt_chain_runs').update({ status: 'failed', error: message, outputs: savedOutputs }).eq('id', run.id)
        revalidatePath('/chains')
        return { error: saveError ? `${message} Run status could not be saved; it may still appear as running.` : message }
    }
}
