import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const exports = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/chains/runner.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports })
const { executeChain, stepPrompt, responseText } = exports
const step = (id, prompt) => ({ id, step_order: Number(id), user_prompt: prompt, system_prompt: 'Be funny', llm_model_id: null })

test('each step receives the preceding result and only the first receives the image', async () => {
    const calls = [], snapshots = []
    const result = await executeChain([step('0', 'Describe {{input}}'), step('1', 'Joke about {{previous}}')], 'a pigeon', 'https://example.com/pigeon.jpg',
        () => 'configured-model', async (...args) => { calls.push(args); return calls.length === 1 ? 'a fancy bird' : 'flying landlord' },
        async outputs => { snapshots.push(outputs) })
    assert.equal(calls[0][2], 'Describe a pigeon\n\nInput from previous step:\na pigeon')
    assert.equal(calls[1][2], 'Joke about a fancy bird')
    assert.equal(calls[0][3], 'https://example.com/pigeon.jpg')
    assert.equal(calls[1][3], null)
    assert.equal(snapshots[0].length, 1)
    assert.equal(result[1].text, 'flying landlord')
})

test('substituted input is literal and is not processed as another template', () => {
    assert.equal(stepPrompt('{{input}} / {{previous}}', '{{previous}}', '$&'), '{{previous}} / $&')
})

test('a failed step stops the chain and leaves prior outputs persisted', async () => {
    let calls = 0
    const saved = []
    await assert.rejects(executeChain([step('0', 'one'), step('1', 'two'), step('2', 'three')], 'start', null, () => 'model',
        async () => { if (++calls === 2) throw new Error('Provider failed'); return 'first output' },
        async outputs => { saved.push(outputs) }), /Provider failed/)
    assert.equal(calls, 2)
    assert.equal(saved.length, 1)
    assert.equal(saved[0][0].text, 'first output')
})

test('response parsing handles reasoning items and rejects incomplete or empty outputs', () => {
    assert.equal(responseText({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'Internal reasoning' }, { text: 'Caption' }] } }] }), 'Caption')
    assert.throws(() => responseText({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), /did not complete/)
    assert.throws(() => responseText({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }), /no text/)
    assert.throws(() => responseText({ promptFeedback: { blockReason: 'SAFETY' } }), /blocked/)
})
