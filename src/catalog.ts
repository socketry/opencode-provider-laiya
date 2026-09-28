import { Model, Provider } from "@opencode/plugin"

export type LaiyaModel = {
	id: string
	owned_by?: string
	laiya?: {
		name?: string
		limits?: {
			context?: number
			input?: number
			output?: number
		}
		reasoning?: {
			supported_efforts?: string[]
			default_effort?: string
			thinking_values?: Array<string | boolean>
			default_thinking?: string | boolean
		}
	}
}

export type LaiyaCatalog = {
	data: LaiyaModel[]
}

const CODEX_PACKAGE = "@opencode/ai/providers/openai/responses"

/** Fetch the authenticated OpenAI-compatible model catalog from Laiya. */
export async function fetchCatalog(baseURL: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<LaiyaModel[]> {
	const url = `${baseURL.replace(/\/+$/, "")}/models`
	const response = await fetcher(url, {
		headers: {
			accept: "application/json",
			authorization: `Bearer ${apiKey}`,
		},
		signal: AbortSignal.timeout(10_000),
	})
	
	if (!response.ok) {
		throw new Error(`Laiya model discovery failed with HTTP ${response.status}`)
	}
	
	const catalog = await response.json() as LaiyaCatalog
	if (!catalog || !Array.isArray(catalog.data)) {
		throw new Error("Laiya returned an invalid model catalog")
	}
	
	return catalog.data.filter((model): model is LaiyaModel => typeof model?.id === "string" && model.id.length > 0)
}

/** Convert Laiya's discovered model entries into OpenCode provider models. */
export function buildModels(catalog: LaiyaModel[], providerID = "laiya"): Model.Info[] {
	const result: Model.Info[] = []
	
	for (const source of catalog) {
		if (source.owned_by !== "codex" && source.owned_by !== "ollama") continue
		
		const openCodeProviderID = Provider.ID.make(providerID)
		const modelID = Model.ID.make(source.id)
		const defaults = Model.Info.default(openCodeProviderID, modelID)
		const codex = source.owned_by === "codex"
		const limits = source.laiya?.limits
		
		const reasoning = source.laiya?.reasoning
		const efforts = reasoning?.supported_efforts?.filter(isNonEmptyString) ?? []
		const defaultEffort = efforts.find((effort) => effort === reasoning?.default_effort)
		const thinkingValues = reasoning?.thinking_values ?? []
		const defaultThinking = thinkingValues.find((value) => value === reasoning?.default_thinking)
		const settings = codex && defaultEffort ? {reasoningEffort: defaultEffort} : undefined
		let body: Record<string, unknown> | undefined = !codex && defaultEffort ? {reasoning_effort: defaultEffort} : undefined
		const variants: Model.Variant[] = []
		
		if (efforts.length > 0) {
			variants.push(...efforts.map((effort) => ({
				id: Model.VariantID.make(effort),
				...(codex
					? {settings: {reasoningEffort: effort}}
					: {body: {reasoning_effort: effort}}),
			})))
		} else if (
			!codex &&
			thinkingValues.includes(true) &&
			thinkingValues.includes(false)
		) {
			variants.push(
				{ id: Model.VariantID.make("thinking"), body: {reasoning_effort: "high"} },
				{ id: Model.VariantID.make("no-thinking"), body: {reasoning_effort: "none"} },
			)
		}
		if (!codex && !defaultEffort && typeof defaultThinking === "boolean" && thinkingValues.includes(!defaultThinking)) {
			body = {...body, reasoning_effort: defaultThinking ? "high" : "none"}
		}
		
		result.push({
			...defaults,
			name: source.laiya?.name ?? source.id,
			limit: {
				...defaults.limit,
				...(positiveInteger(limits?.context) ? {context: limits.context} : {}),
				...(positiveInteger(limits?.input) ? {input: limits.input} : {}),
				...(positiveInteger(limits?.output) ? {output: limits.output} : {}),
			},
			variants,
			...(codex ? {package: CODEX_PACKAGE} : {}),
			...(settings ? {settings} : {}),
			...(body ? {body} : {}),
		})
	}
	
	return result
}

/** Preserve explicitly configured models and overrides alongside discovered models. */
export function mergeModels(discovered: Model.Info[], configured: Iterable<Model.Info>): Model.Info[] {
	const models = new Map(discovered.map((model) => [model.id, model]))
	for (const model of configured) {
		const discoveredModel = models.get(model.id)
		if (!discoveredModel) {
			models.set(model.id, model)
			continue
		}
		
		models.set(model.id, {
			...discoveredModel,
			...model,
			settings: {...discoveredModel.settings, ...model.settings},
			headers: {...discoveredModel.headers, ...model.headers},
			body: {...discoveredModel.body, ...model.body},
			variants: model.variants.length > 0 ? model.variants : discoveredModel.variants,
		})
	}
	
	return [...models.values()]
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}
