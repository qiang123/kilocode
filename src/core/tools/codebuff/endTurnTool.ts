import Anthropic from "@anthropic-ai/sdk"
import * as vscode from "vscode"

import { RooCodeEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../../task/Task"
import {
	ToolResponse,
	ToolUse,
	AskApproval,
	HandleError,
	PushToolResult,
	RemoveClosingTag,
	ToolDescription,
	AskFinishSubTaskApproval,
} from "../../../shared/tools"
import { formatResponse } from "../../prompts/responses"
import { Package } from "../../../shared/package"
import { getCommitRangeForNewCompletion } from "../../checkpoints/kilocode/seeNewChanges"

// kilocode_change start
async function getClineMessageOptions(task: Task) {
	const commitRange = await getCommitRangeForNewCompletion(task)
	return (
		commitRange && {
			metadata: {
				kiloCode: { commitRange },
			},
		}
	)
}
// kilocode_change end

export async function endTurnTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
	toolDescription: ToolDescription,
	askFinishSubTaskApproval: AskFinishSubTaskApproval,
) {
	// Get the setting for preventing completion with open todos from VSCode configuration
	const preventCompletionWithOpenTodos = vscode.workspace
		.getConfiguration(Package.name)
		.get<boolean>("preventCompletionWithOpenTodos", false)

	// Check if there are incomplete todos (only if the setting is enabled)
	const hasIncompleteTodos = cline.todoList && cline.todoList.some((todo) => todo.status !== "completed")

	if (preventCompletionWithOpenTodos && hasIncompleteTodos) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("attempt_completion")

		pushToolResult(
			formatResponse.toolError(
				"Cannot complete task while there are incomplete todos. Please finish all todos before attempting completion.",
			),
		)

		return
	}

	try {
		const lastMessage = cline.clineMessages.at(-1)

		if (block.partial) {
			// No command, still outputting partial result
			await cline.say("end_turn", undefined, undefined, block.partial)
			return
		} else {
			cline.consecutiveMistakeCount = 0

			// Command execution is permanently disabled in attempt_completion
			// Users must use execute_command tool separately before attempt_completion
			await cline.say(
				"end_turn",
				undefined,
				undefined,
				false,
				undefined,
				undefined,
				await getClineMessageOptions(cline), //kilocode_change
			)
			TelemetryService.instance.captureTaskCompleted(cline.taskId)
			cline.emit(RooCodeEventName.TaskCompleted, cline.taskId, cline.getTokenUsage(), cline.toolUsage)

			if (cline.parentTask) {
				const didApprove = await askFinishSubTaskApproval()

				if (!didApprove) {
					return
				}

				// tell the provider to remove the current subtask and resume the previous task in the stack
				await cline.providerRef.deref()?.finishSubTask("")
				return
			}

			// We already sent end_turn says, an
			// empty string asks relinquishes control over
			// button and field.
			const { response, text, images } = await cline.ask("end_turn", "", false)

			// Signals to recursive loop to stop (for now
			// cline never happens since yesButtonClicked
			// will trigger a new task).
			if (response === "yesButtonClicked") {
				pushToolResult("")
				return
			}

			await cline.say("user_feedback", text ?? "", images)
			const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []

			toolResults.push({
				type: "text",
				text: `The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.\n<feedback>\n${text}\n</feedback>`,
			})

			toolResults.push(...formatResponse.imageBlocks(images))
			cline.userMessageContent.push({ type: "text", text: `${toolDescription()} Result:` })
			cline.userMessageContent.push(...toolResults)

			return
		}
	} catch (error) {
		await handleError("inspecting site", error)
		return
	}
}
