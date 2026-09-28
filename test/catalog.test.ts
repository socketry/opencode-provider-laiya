import assert from "node:assert/strict"
import {describe, it} from "node:test"
import {Model, Provider} from "@opencode/plugin"
import {buildModels, fetchCatalog, mergeModels} from "../src/catalog.js"

describe("fetchCatalog", () => {
	it("requests Laiya's OpenAI-compatible model list with bearer authentication", async () => {
		let requestURL = ""
		let requestHeaders: HeadersInit | undefined
		const fetcher: typeof fetch = async (input, init) => {
			requestURL = String(input)
			requestHeaders = init?.headers
			return Response.json({object: "list", data: [{id: "gpt-6-luna", owned_by: "codex"}]})
		}
		
		const catalog = await fetchCatalog("http://aiko.local:9293/v1/", "test-key", fetcher)
		
		assert.equal(requestURL, "http://aiko.local:9293/v1/models")
		assert.equal(new Headers(requestHeaders).get("authorization"), "Bearer test-key")
		assert.deepEqual(catalog, [{id: "gpt-6-luna", owned_by: "codex"}])
	})
	
	it("reports upstream and malformed-catalog errors", async () => {
		const unauthorized: typeof fetch = async () => new Response("", {status: 401})
		const malformed: typeof fetch = async () => Response.json({object: "list", data: "invalid"})
		
		await assert.rejects(fetchCatalog("http://aiko.local/v1", "key", unauthorized), /HTTP 401/)
		await assert.rejects(fetchCatalog("http://aiko.local/v1", "key", malformed), /invalid model catalog/)
	})
})

describe("buildModels", () => {
	it("routes Codex through Responses and maps advertised reasoning efforts", () => {
		const [model] = buildModels([
			{
				id: "gpt-6-luna",
				owned_by: "codex",
				laiya: {
					name: "GPT-6 Luna",
					limits: {context: 272_000},
					reasoning: {supported_efforts: ["low", "medium", "high"], default_effort: "medium"},
				},
			},
		])
		
		assert.equal(model.providerID, "laiya")
		assert.equal(model.package, "@opencode/ai/providers/openai/responses")
		assert.equal(model.name, "GPT-6 Luna")
		assert.equal(model.limit.context, 272_000)
		assert.equal(model.settings?.reasoningEffort, "medium")
		assert.deepEqual(model.variants.map((variant) => variant.id), ["low", "medium", "high"])
		assert.deepEqual(model.variants[1].settings, {reasoningEffort: "medium"})
	})

	it("maps Ollama effort variants to the OpenAI-compatible request body", () => {
		const [model] = buildModels([
			{
				id: "qwen3-coder:latest",
				owned_by: "ollama",
				laiya: {
					name: "Qwen 3 Coder",
					reasoning: {supported_efforts: ["low", "medium"], default_effort: "medium"},
				},
			},
		])
		
		assert.equal(model.package, undefined)
		assert.equal(model.body?.reasoning_effort, "medium")
		assert.deepEqual(model.variants[0].body, {reasoning_effort: "low"})
	})

	it("provides toggle variants for boolean Ollama thinking controls", () => {
		const [model] = buildModels([
			{
				id: "gpt-oss:20b",
				owned_by: "ollama",
				laiya: {reasoning: {thinking_values: [false, true], default_thinking: true}},
			},
		])
		
		assert.deepEqual(model.variants.map((variant) => variant.id), ["thinking", "no-thinking"])
		assert.deepEqual(model.variants[0].body, {reasoning_effort: "high"})
		assert.deepEqual(model.variants[1].body, {reasoning_effort: "none"})
		assert.deepEqual(model.body, {reasoning_effort: "high"})
	})

	it("filters models from unknown providers and ignores invalid effort values", () => {
		const models = buildModels([
			{
				id: "model",
				owned_by: "unknown",
			},
			{
				id: "bad-efforts",
				owned_by: "ollama",
				laiya: {reasoning: {supported_efforts: ["", 4 as unknown as string], default_effort: "missing"}},
			},
		])
		
		assert.equal(models.length, 1)
		assert.equal(models[0].variants.length, 0)
		assert.equal(models[0].body, undefined)
	})
	
	it("preserves configured model additions and overrides", () => {
		const providerID = Provider.ID.make("laiya")
		const discovered = buildModels([{id: "gpt-6-luna", owned_by: "codex"}])
		const override: Model.Info = {
			...Model.Info.default(providerID, Model.ID.make("gpt-6-luna")),
			name: "Custom Luna",
			package: "@opencode/ai/providers/openai/chat",
		}
		const manual = Model.Info.default(providerID, Model.ID.make("private-model"))
		
		const merged = mergeModels(discovered, [override, manual])
		
		assert.deepEqual(merged.map((model) => model.id), ["gpt-6-luna", "private-model"])
		assert.equal(merged[0].name, "Custom Luna")
		assert.equal(merged[0].package, "@opencode/ai/providers/openai/chat")
	})
})
