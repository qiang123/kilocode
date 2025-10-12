import type { ModelInfo } from "../model.js"

// https://docs.litellm.ai/
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
