/**
 * Codebuff Tool Converter
 *
 * This file converts Task tools to Codebuff CustomToolDefinition format.
 * It provides a bridge between the Task tool system and the Codebuff SDK.
 */
import path from "path"
import { z } from "zod/v4"
import { CodebuffClientOptions, ClientToolCall, ToolHelpers, ClientToolName } from "../../../../sdk/src/index"
import type { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"
import type { ClineAsk, ToolProgressStatus } from "@roo-code/types"
import { formatResponse } from "../prompts/responses"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
// Import tool implementations
import { readFilesTool } from "./codebuff/readFileTool"

/**
 * Tool execution context that will be passed to tool executors
 */
export interface ToolExecutionContext {
	task: Task
}

/**
 * Helper to create a ToolUse block from tool name and params
 */
function createToolUseBlock(name: string, params: any): ToolUse {
	return {
		type: "tool_use",
		name: name as any,
		params,
		partial: false,
	}
}

/**
 * Helper functions that match presentAssistantMessage's signatures
 */
function createToolHelpers(context: ToolExecutionContext) {
	const { task } = context

	// Store tool results
	const toolResults: any[] = []

	const askApproval = async (
		type: ClineAsk,
		partialMessage?: string,
		progressStatus?: ToolProgressStatus,
		forceApproval?: boolean,
	): Promise<boolean> => {
		const { response, text, images } = await task.ask(
			type,
			partialMessage,
			false,
			progressStatus,
			forceApproval || false,
		)

		if (response !== "yesButtonClicked") {
			// Handle both messageResponse and noButtonClicked with text.
			if (text) {
				await task.say("user_feedback", text, images)
				pushToolResult(formatResponse.toolResult(formatResponse.toolDeniedWithFeedback(text), images))
			} else {
				pushToolResult(formatResponse.toolDenied())
			}
			return false
		}

		// Handle yesButtonClicked with text.
		if (text) {
			await task.say("user_feedback", text, images)
			pushToolResult(formatResponse.toolResult(formatResponse.toolApprovedWithFeedback(text), images))
		}

		return true
	}

	const handleError = async (action: string, error: Error) => {
		await task.say("error", `Error ${action}:\n${error.message}`)

		toolResults.push({
			type: "text" as const,
			text: `Error ${action}: ${error.message}`,
		})
	}

	const pushToolResult = (content: any) => {
		if (typeof content === "string") {
			toolResults.push({
				type: "text" as const,
				text: content || "(tool did not return anything)",
			})
		} else if (Array.isArray(content)) {
			toolResults.push(...content)
		} else {
			toolResults.push(content)
		}
	}

	const removeClosingTag = (_tag: string, text?: string): string => {
		return text || ""
	}

	const toolDescription = (blockName: string): string => {
		return `[${blockName}]`
	}

	const askFinishSubTaskApproval = async (): Promise<boolean> => {
		const toolMessage = JSON.stringify({ tool: "finishTask" })
		return await askApproval("tool", toolMessage)
	}

	return {
		askApproval,
		handleError,
		pushToolResult,
		removeClosingTag,
		toolDescription,
		askFinishSubTaskApproval,
		getResults: () => toolResults,
	}
}

/**
 * Create read_file tool definition for Codebuff SDK
 */
export function createReadFileTool(
	context: ToolExecutionContext,
): Required<CodebuffClientOptions>["overrideTools"]["read_files"] {
	const { task: cline } = context
	return async (input: { filePaths: string[] }) => {
		const { filePaths } = input
		const toolUse = createToolUseBlock("read_files", { paths: filePaths })
		const { askApproval, handleError, pushToolResult } = createToolHelpers(context)
		const result = await readFilesTool(cline, filePaths, askApproval, handleError, pushToolResult)
		return result
	}
}

/**
 * Get all overides Codebuff tool for the Task
 */
export function getOveridesCodebuffTools(context: ToolExecutionContext): CodebuffClientOptions["overrideTools"] {
	return {
		// end_turn: createAttemptCompletionTool(context),
		read_files: createReadFileTool(context),
		// write_files: createWriteToFileTool(context),
	}
}
