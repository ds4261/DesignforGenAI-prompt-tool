export type Step = { id: string; step_order: number; system_prompt: string | null; user_prompt: string; llm_model_id: string | null }
export type Output = { step_id: string; model: string; prompt: string; system_prompt: string; text: string }

export function stepPrompt(template: string, input: string, previous: string) {
    const expanded = template.replace(/\{\{(input|previous)\}\}/g, (_, key) => key === 'input' ? input : previous)
    return template.includes('{{previous}}') ? expanded : `${expanded}\n\nInput from previous step:\n${previous}`
}

export function responseText(body: { promptFeedback?: { blockReason?: string }; candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] }) {
    if (body.promptFeedback?.blockReason) throw new Error('Gemini blocked this prompt. Revise the input and retry.')
    const candidate = body.candidates?.[0]
    if (candidate?.finishReason !== 'STOP') throw new Error('The model did not complete its response. Retry or shorten the prompt.')
    const text = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text ?? '').join('\n').trim()
    if (!text) throw new Error('The model returned no text. Check the selected model and prompts.')
    return text
}

export async function executeChain(steps: Step[], input: string, imageUrl: string | null,
    modelFor: (step: Step) => string, generate: (model: string, system: string, prompt: string, image: string | null) => Promise<string>,
    persist: (outputs: Output[]) => Promise<void>) {
    let previous = input
    const outputs: Output[] = []
    for (const [index, step] of steps.entries()) {
        const model = modelFor(step)
        const prompt = stepPrompt(step.user_prompt, input, previous)
        previous = await generate(model, step.system_prompt ?? '', prompt, index === 0 ? imageUrl : null)
        outputs.push({ step_id: step.id, model, prompt, system_prompt: step.system_prompt ?? '', text: previous })
        await persist([...outputs])
    }
    return outputs
}
