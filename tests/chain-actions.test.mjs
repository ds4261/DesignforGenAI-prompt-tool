import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function fixture({ authorized = true, rpcError = null } = {}) {
    const calls = []
    const exports = {}
    const dependencies = {
        'next/cache': { revalidatePath: path => calls.push(['revalidate', path]) },
        '@/utils/supabase/admin': { requireAdmin: async () => {
            if (!authorized) throw new Error('Forbidden')
            return { supabase: { rpc: async (...args) => { calls.push(['rpc', ...args]); return { data: 'chain-id', error: rpcError } } }, user: { id: 'admin' } }
        } },
        '@/utils/chains/runner': {},
    }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/chains/actions.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, process: { env: {} }, require: name => {
        if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`)
        return dependencies[name]
    } })
    return { ...exports, calls }
}
function form(values) {
    const data = new FormData()
    Object.entries(values).forEach(([key, value]) => data.set(key, value))
    return data
}

test('both chain editing and generation require authorization before any work', async () => {
    const { editChain, runChain, calls } = fixture({ authorized: false })
    await assert.rejects(editChain({}, form({ operation: 'delete_chain', chain_id: 'chain-id' })), /Forbidden/)
    await assert.rejects(runChain({}, form({ chain_id: 'chain-id', input: 'test' })), /Forbidden/)
    assert.equal(calls.length, 0)
})

test('unsupported editor operations cannot reach the database', async () => {
    const { editChain, calls } = fixture()
    assert.match((await editChain({}, form({ operation: 'drop_table' }))).error, /Invalid operation/)
    assert.equal(calls.length, 0)
})

test('editor writes only allowlisted payload fields and revalidates after success', async () => {
    const { editChain, calls } = fixture()
    const result = await editChain({}, form({ operation: 'create_chain', name: 'Captions', is_superadmin: 'true' }))
    assert.equal(result.id, 'chain-id')
    assert.equal(calls[0][1], 'edit_prompt_chain')
    assert.equal(calls[0][2].payload.name, 'Captions')
    assert.equal('is_superadmin' in calls[0][2].payload, false)
    assert.equal(calls[1][1], '/chains')
})

test('database failures report an error and do not report a save', async () => {
    const { editChain, calls } = fixture({ rpcError: { message: 'Chain no longer exists' } })
    const result = await editChain({}, form({ operation: 'update_chain', chain_id: 'missing' }))
    assert.equal(result.error, 'Chain no longer exists')
    assert.equal(result.success, undefined)
    assert.equal(calls.length, 1)
})

test('missing API configuration never creates a paid run', async () => {
    const { runChain, calls } = fixture()
    assert.match((await runChain({}, form({ chain_id: 'chain', input: 'go' }))).error, /GEMINI_API_KEY/)
    assert.equal(calls.length, 0)
})
