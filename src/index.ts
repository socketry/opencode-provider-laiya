import {Plugin} from "@opencode/plugin"
import {buildModels, fetchCatalog, mergeModels, type LaiyaModel} from "./catalog.js"

const DEFAULT_PROVIDER_ID = "laiya"
const DEFAULT_API_KEY_ENV = "LAIYA_API_KEY"
const DEFAULT_REFRESH_INTERVAL = 5 * 60 * 1000

type Options = {
	providerID?: unknown
	apiKeyEnv?: unknown
	baseURL?: unknown
	refreshIntervalMs?: unknown
}

export default Plugin.define({
	id: "socketry.laiya",
	async setup(ctx) {
		const options = ctx.options as Options
		const providerID = nonEmptyString(options.providerID) ?? DEFAULT_PROVIDER_ID
		const apiKeyEnv = nonEmptyString(options.apiKeyEnv) ?? DEFAULT_API_KEY_ENV
		const apiKey = process.env[apiKeyEnv]
		if (!apiKey) {
			throw new Error(`Set ${apiKeyEnv} in the OpenCode server environment before enabling Laiya model discovery`)
		}
		const resolvedApiKey = apiKey
		
		const configured = await ctx.provider.get({providerID})
		const settings = configured.data.settings as Record<string, unknown> | undefined
		const baseURL = nonEmptyString(options.baseURL) ?? nonEmptyString(settings?.baseURL)
		if (!baseURL) {
			throw new Error(`Set providers.${providerID}.settings.baseURL before enabling Laiya model discovery`)
		}
		const resolvedBaseURL = baseURL
		
		const refreshIntervalMs = positiveInteger(options.refreshIntervalMs) ?? DEFAULT_REFRESH_INTERVAL
		const cacheKey = `catalog:${resolvedBaseURL}`
		const initialCatalog = await loadCatalog(ctx.storage, cacheKey, resolvedBaseURL, resolvedApiKey)
		let models = buildModels(initialCatalog, providerID)
		const registration = await ctx.provider.transform((editor) => {
			const provider = editor.get(providerID)
			if (!provider) {
				throw new Error(`Define providers.${providerID} before enabling Laiya model discovery`)
			}
			
			editor.models.set(providerID, mergeModels(models, provider.models.values()))
		})
		
		const timer = setInterval(() => {
			void refresh().catch((error: unknown) => {
				console.warn(`[opencode-provider-laiya] Model refresh failed: ${messageOf(error)}`)
			})
		}, refreshIntervalMs)
		timer.unref()
		
		async function refresh() {
			const discoveredCatalog = await fetchCatalog(resolvedBaseURL, resolvedApiKey)
			await ctx.storage.set(cacheKey, JSON.parse(JSON.stringify(discoveredCatalog)))
			const discovered = buildModels(discoveredCatalog, providerID)
			if (JSON.stringify(discovered) === JSON.stringify(models)) return
			
			const previous = models
			models = discovered
			try {
				await ctx.provider.reload()
			} catch (error) {
				models = previous
				throw error
			}
		}
		
		return () => {
			clearInterval(timer)
			return registration.dispose()
		}
	},
})

async function loadCatalog(storage: Plugin.Context["storage"], cacheKey: string, baseURL: string, apiKey: string): Promise<LaiyaModel[]> {
	try {
		const catalog = await fetchCatalog(baseURL, apiKey)
		await storage.set(cacheKey, JSON.parse(JSON.stringify(catalog)))
		return catalog
	} catch (error) {
		console.warn(`[opencode-provider-laiya] Model discovery failed: ${messageOf(error)}`)
		const cached = await storage.get(cacheKey)
		if (Array.isArray(cached)) return cached as LaiyaModel[]
		return []
	}
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
