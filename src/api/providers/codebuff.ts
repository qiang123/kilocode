import type { Anthropic } from "@anthropic-ai/sdk"
import { CodebuffClient, PrintModeEvent } from "../../../../sdk/src/index"
import type { RunState } from "../../../../sdk/src/index"
import type { ModelInfo } from "@roo-code/types"
import { type ApiHandler } from ".."
import { ApiStreamUsageChunk, type ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import { ApiHandlerOptions } from "../../shared/api"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

export class CodebuffHandler extends BaseProvider implements ApiHandler {
	private options: ApiHandlerOptions
	private client: CodebuffClient
	private codebuffRunState?: RunState

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		process.env.NEXT_PUBLIC_CB_ENVIRONMENT = "dev"
		process.env.NEXT_PUBLIC_CODEBUFF_BACKEND_URL = options.codebuffBaseUrl

		// Initialize CodebuffClient with API key from options
		this.client = new CodebuffClient({
			apiKey: options.codebuffApiKey,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		try {
			// Convert Anthropic messages to Codebuff format
			const prompt = this.convertMessagesToPrompt(systemPrompt, messages)

			console.log("[CodebuffHandler] Generated prompt:", prompt)

			// Track usage
			let usage: ApiStreamUsageChunk = {
				type: "usage",
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			}

			// Create a queue to handle events from the SDK
			const eventQueue: Array<any> = []
			let isComplete = false
			let error: Error | null = null

			// Run Codebuff agent with event handling
			const runPromise = this.client
				.run({
					agent: this.options.codebuffModelId || "base",
					cwd: metadata?.cwd,
					prompt,
					handleStreamChunk: async (chunk: string) => {
						// Handle streaming text chunks
						if (chunk) {
							eventQueue.push({
								type: "text",
								text: chunk,
							})
						}
					},
					handleEvent: (event: PrintModeEvent) => {
						// Convert Codebuff SDK events to ApiStream events
						switch (event.type) {
							case "start":
								eventQueue.push({
									type: "start",
									text: JSON.stringify(event, null, 2),
								})
								break
							case "finish":
								eventQueue.push({
									type: "finish",
									text: JSON.stringify(event, null, 2),
								})
								break

							case "error":
								eventQueue.push({
									type: "error",
									error: event.message || "An unknown error occurred",
									message: event.message || "An unknown error occurred",
								})
								break
							case "tool_call":
								// Handle tool call events - display as text with tool information
								if (event.toolName && event.input) {
									const toolInfo = `🔧 Tool: ${event.toolName}\n${JSON.stringify(event.input, null, 2)}`
									eventQueue.push({
										type: "text",
										text: toolInfo,
									})
								}
								break
							case "text":
								// Handle assistant message events
								if (event.text) {
									eventQueue.push({
										type: "text",
										text: event.text,
									})
								}
								break
							case "tool_result":
								// Handle tool result events
								if (event.toolCallId) {
									eventQueue.push({
										type: "tool",
										text: JSON.stringify(event, null, 2),
									})
								}
								break
							default:
								// Log unhandled event types for debugging
								console.log("[CodebuffHandler] Unhandled Codebuff SDK event:", event)
						}
					},
					previousRun: this.codebuffRunState,
				})
				.then((result) => {
					// Store the run state for continuation
					this.codebuffRunState = result

					// Add final output if available
					if (result.output) {
						eventQueue.push({
							type: "text",
							text: typeof result.output === "string" ? result.output : JSON.stringify(result.output),
						})
					}

					isComplete = true
					return result
				})
				.catch((err) => {
					error = err instanceof Error ? err : new Error(String(err))
					isComplete = true
					throw err
				})

			// Yield events as they come in
			while (!isComplete || eventQueue.length > 0) {
				if (eventQueue.length > 0) {
					const event = eventQueue.shift()
					if (event) {
						yield event
					}
				} else {
					// Wait a bit before checking again
					await new Promise((resolve) => setTimeout(resolve, 10))
				}
			}

			// Check if there was an error
			if (error) {
				yield {
					type: "error",
					error: error,
					message: error,
				}
			}

			// Yield usage information
			yield usage
		} catch (error) {
			yield {
				type: "error",
				error: error instanceof Error ? error.message : String(error),
				message: error instanceof Error ? error.message : String(error),
			}
		}
	}

	getModel() {
		// Return default Codebuff model info
		const modelInfo: ModelInfo = {
			maxTokens: 8192,
			contextWindow: 200000,
			supportsImages: true,
			supportsPromptCache: false,
			inputPrice: 0,
			outputPrice: 0,
		}

		return {
			id: "base",
			info: modelInfo,
		}
	}

	/**
	 * Convert Anthropic messages to a single prompt string for Codebuff
	 */
	private convertMessagesToPrompt(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): string {
		let prompt = systemPrompt ? `${systemPrompt}\n\n` : ""

		for (const message of messages) {
			const role = message.role === "user" ? "User" : "Assistant"

			if (Array.isArray(message.content)) {
				for (const content of message.content) {
					if (content.type === "text") {
						prompt += `${role}: ${content.text}\n\n`
					}
				}
			} else if (typeof message.content === "string") {
				prompt += `${role}: ${message.content}\n\n`
			}
		}

		return prompt.trim()
	}
}
