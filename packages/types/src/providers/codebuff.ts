import type { ModelInfo } from "../model.js"

// https://docs.litellm.ai/

export type codebuffModelId = "mars/oss-model-base@0.0.1"
export const codebuffDefaultModelId = "mars/oss-model-base@0.0.1"

export const codebuffDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsComputerUse: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
}

export const CODEBUFF_COMPUTER_USE_MODELS = new Set([])

export const codebuffModels = {
	"mars/oss-model-base@0.0.1": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Qwen3 Coder Plus - High-performance coding model with 1M context window for large codebases",
	},
} as const satisfies Record<codebuffModelId, ModelInfo>
