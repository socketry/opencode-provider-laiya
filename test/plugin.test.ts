import assert from "node:assert/strict"
import {afterEach, describe, it} from "node:test"
import plugin from "../src/index.js"

const previousApiKey = process.env.LAIYA_API_KEY

afterEach(() => {
	if (previousApiKey === undefined) {
		delete process.env.LAIYA_API_KEY
	} else {
		process.env.LAIYA_API_KEY = previousApiKey
	}
})

describe("OpenCode plugin", () => {
	it("registers discovered Codex and Ollama models with protocol-specific packages", async () => {
		process.env.LAIYA_API_KEY = "test-key"
		const originalFetch = globalThis.fetch
		globalThis.fetch = (async (_input, init) => {
			assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key")
			return Response.json({data: [
				{id: "gpt-6-luna", owned_by: "codex", laiya: {reasoning: {supported_efforts: ["low", "medium"]}}},
				{id: "qwen3:latest", owned_by: "ollama"},
			]})
		}) as typeof fetch
		
		let registered: readonly import("@opencode/plugin").Model.Info[] = []
		let disposed = false
		const context = {
			options: {},
			storage: {
				get: async () => undefined,
				set: async () => {},
			},
			provider: {
				get: async () => ({data: {settings: {baseURL: "http://aiko.local:9293/v1"}}}),
				transform: async (callback: (editor: unknown) => void) => {
					callback({
						get: () => ({models: new Map()}),
						models: {
							set: (_providerID: string, models: readonly import("@opencode/plugin").Model.Info[]) => {
								registered = models
							},
						},
					})
					return {dispose: async () => {disposed = true}}
				},
				reload: async () => {},
			},
		} as unknown as Parameters<typeof plugin.setup>[0]
		
		try {
			const cleanup = await plugin.setup(context)
			assert.deepEqual(registered.map((model) => model.id), ["gpt-6-luna", "qwen3:latest"])
			assert.equal(registered[0].package, "@opencode/ai/providers/openai/responses")
			assert.equal(registered[0].variants.length, 2)
			assert.equal(registered[1].package, undefined)
			await cleanup?.()
			assert.equal(disposed, true)
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it("requires the configured Laiya API key", async () => {
		delete process.env.LAIYA_API_KEY
		const context = {options: {}, provider: {}} as unknown as Parameters<typeof plugin.setup>[0]
		
		await assert.rejects(Promise.resolve().then(() => plugin.setup(context)), /LAIYA_API_KEY/)
	})
})
