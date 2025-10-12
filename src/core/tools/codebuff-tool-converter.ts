/**
 * Codebuff Tool Converter
 *
 * This file converts Task tools to Codebuff CustomToolDefinition format.
 * It provides a bridge between the Task tool system and the Codebuff SDK.
 */

import { z } from "zod/v4"
import { getCustomToolDefinition, type CustomToolDefinition } from "../../../../sdk/src/custom-tool"
import type { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"
import type { ClineAsk, ToolProgressStatus } from "@roo-code/types"
import { formatResponse } from "../prompts/responses"

// Import tool implementations
import { readFileTool } from "./readFileTool"
import { writeToFileTool } from "./writeToFileTool"
import { executeCommandTool } from "./executeCommandTool"
import { listFilesTool } from "./listFilesTool"
import { searchFilesTool } from "./searchFilesTool"
import { applyDiffTool } from "./multiApplyDiffTool"
import { askFollowupQuestionTool } from "./askFollowupQuestionTool"
import { attemptCompletionTool } from "./attemptCompletionTool"

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
export function createReadFileTool(context: ToolExecutionContext): CustomToolDefinition {
	const inputSchema = z.object({
		path: z.string().optional().describe("Path to the file to read"),
		start_line: z.string().optional().describe("Starting line number (1-indexed)"),
		end_line: z.string().optional().describe("Ending line number (1-indexed)"),
		args: z.string().optional().describe("XML formatted file paths for reading multiple files"),
	})

	return getCustomToolDefinition({
		toolName: "read_file",
		inputSchema,
		description: `Request to read the contents of one or more files. You can either:
1. Read a single file by providing 'path'
2. Read a range of lines by providing 'path', 'start_line', and 'end_line'
3. Read multiple files by providing 'args' in XML format: <file><path>file1.ts</path></file><file><path>file2.ts</path></file>

Use this to understand existing code before making changes.`,
		endsAgentStep: true,
		exampleInputs: [
			{ path: "src/index.ts" },
			{ path: "src/utils.ts", start_line: "10", end_line: "50" },
			{ args: "<file><path>src/file1.ts</path></file><file><path>src/file2.ts</path></file>" },
		],
		execute: async (params: z.infer<typeof inputSchema>) => {
			const block = createToolUseBlock("read_file", params)
			const helpers = createToolHelpers(context)

			await readFileTool(
				context.task,
				block,
				helpers.askApproval,
				helpers.handleError,
				helpers.pushToolResult,
				helpers.removeClosingTag,
			)

			return helpers.getResults()
		},
	})
}

/**
 * Create write_to_file tool definition for Codebuff SDK
 */
export function createWriteToFileTool(context: ToolExecutionContext): CustomToolDefinition {
	const inputSchema = z.object({
		path: z.string().describe("Path to the file to write"),
		content: z.string().describe("Complete content to write to the file"),
		line_count: z.string().optional().describe("Expected number of lines in the content"),
	})

	return getCustomToolDefinition({
		toolName: "write_to_file",
		inputSchema,
		description: `Request to write content to a file at the specified path. If the file exists, it will be overwritten. If it doesn't exist, it will be created.

IMPORTANT:
- Always provide the COMPLETE file content, not partial updates
- Include the 'line_count' parameter with the expected number of lines
- Do not use placeholders like "... rest of code ..." - write the full content
- Ensure proper formatting and indentation`,
		endsAgentStep: true,
		exampleInputs: [
			{
				path: "src/new-file.ts",
				content: "export function hello() {\n  console.log('Hello, world!')\n}",
				line_count: "3",
			},
		],
		execute: async (params: z.infer<typeof inputSchema>) => {
			const block = createToolUseBlock("write_to_file", params)
			const helpers = createToolHelpers(context)

			await writeToFileTool(
				context.task,
				block,
				helpers.askApproval,
				helpers.handleError,
				helpers.pushToolResult,
				helpers.removeClosingTag,
			)

			return helpers.getResults()
		},
	})
}

/**
 * Create execute_command tool definition for Codebuff SDK
 */
export function createExecuteCommandTool(context: ToolExecutionContext): CustomToolDefinition {
	const inputSchema = z.object({
		command: z.string().describe("The shell command to execute"),
		cwd: z.string().optional().describe("Custom working directory for the command"),
	})

	return getCustomToolDefinition({
		toolName: "execute_command",
		inputSchema,
		description: `Execute a shell command in the terminal. Use this to run build scripts, tests, install packages, or any other command-line operations.

IMPORTANT:
- Commands run in the workspace directory by default
- Use 'cwd' parameter to run in a different directory
- Long-running commands (servers, watch modes) will run in the background
- You'll receive the command output when it completes

Common use cases:
- Install dependencies: npm install, pip install
- Run tests: npm test, pytest
- Build projects: npm run build, cargo build
- Git operations: git status, git commit
- File operations: ls, cat, grep`,
		endsAgentStep: true,
		exampleInputs: [
			{ command: "npm install" },
			{ command: "npm test" },
			{ command: "git status" },
			{ command: "ls -la", cwd: "src" },
		],
		execute: async (params: z.infer<typeof inputSchema>) => {
			const block = createToolUseBlock("execute_command", params)
			const helpers = createToolHelpers(context)

			await executeCommandTool(
				context.task,
				block,
				helpers.askApproval,
				helpers.handleError,
				helpers.pushToolResult,
				helpers.removeClosingTag,
			)

			return helpers.getResults()
		},
	})
}

/**
 * Create list_files tool definition for Codebuff SDK
 */
export function createListFilesTool(context: ToolExecutionContext): CustomToolDefinition {
	const inputSchema = z.object({
		path: z.string().describe("Path to the directory to list"),
		recursive: z.string().optional().describe("Whether to list files recursively (true/false)"),
	})

	return getCustomToolDefinition({
		toolName: "list_files",
		inputSchema,
		description: `Request to list files and directories at the specified path. Use this to explore the project structure.

IMPORTANT:
- Use '.' to list the root workspace directory
- Set recursive to 'true' to list all nested files and directories
- Set recursive to 'false' or omit it to list only immediate children

This is useful for:
- Understanding project structure
- Finding relevant files before reading them
- Discovering configuration files
- Exploring unfamiliar codebases`,
		endsAgentStep: true,
		exampleInputs: [{ path: "." }, { path: "src", recursive: "true" }, { path: "src/components" }],
		execute: async (params: z.infer<typeof inputSchema>) => {
			const block = createToolUseBlock("list_files", params)
			const helpers = createToolHelpers(context)

			await listFilesTool(
				context.task,
				block,
				helpers.askApproval,
				helpers.handleError,
				helpers.pushToolResult,
				helpers.removeClosingTag,
			)

			return helpers.getResults()
		},
	})
}

/**
 * Create search_files tool definition for Codebuff SDK
 */
export function createSearchFilesTool(context: ToolExecutionContext): CustomToolDefinition {
	const inputSchema = z.object({
		path: z.string().describe("Directory path to search in"),
		regex: z.string().describe("Regular expression pattern to search for"),
		file_pattern: z.string().optional().describe("Glob pattern to filter files (e.g., '*.ts')"),
	})

	return getCustomToolDefinition({
		toolName: "search_files",
		inputSchema,
		description: `Search for text patterns in files using regular expressions. This is like running 'grep' across your codebase.

IMPORTANT:
- Use proper regex syntax for the 'regex' parameter
- Use 'file_pattern' to limit search to specific file types (e.g., '*.ts', '*.py')
- Search is case-sensitive by default
- Results show file paths and matching lines with context

Common use cases:
- Find function definitions: "function myFunction"
- Find imports: "import.*from.*react"
- Find TODO comments: "TODO|FIXME"
- Find specific error messages
- Locate configuration values`,
		endsAgentStep: true,
		exampleInputs: [
			{ path: "src", regex: "function.*export" },
			{ path: ".", regex: "TODO|FIXME", file_pattern: "*.ts" },
			{ path: "src", regex: "import.*React", file_pattern: "*.tsx" },
		],
		execute: async (params: z.infer<typeof inputSchema>) => {
			const block = createToolUseBlock("search_files", params)
			const helpers = createToolHelpers(context)

			await searchFilesTool(
				context.task,
				block,
				helpers.askApproval,
				helpers.handleError,
				helpers.pushToolResult,
				helpers.removeClosingTag,
			)

			return helpers.getResults()
		},
	})
}

/**
 * Create apply_diff tool definition for Codebuff SDK
 */
export function createApplyDiffTool(context: ToolExecutionContext): CustomToolDefinition {
	const inputSchema = z.object({
		path: z.string().optional().describe("Path to the file to modify (legacy format)"),
		diff: z.string().optional().describe("Unified diff format changes to apply (legacy format)"),
		args: z.string().optional().describe("XML formatted multi-file diffs"),
	})

	return getCustomToolDefinition({
		toolName: "apply_diff",
		inputSchema,
		description: `Apply a unified diff to modify existing file(s). This is more efficient than rewriting entire files.

IMPORTANT:
- Use unified diff format (lines starting with -, +, @@)
- Include enough context lines for accurate matching
- This only works for existing files
- For new files, use write_to_file instead
- Supports both single file (path + diff) and multiple files (args with XML)

Unified diff format:
@@ -start,count +start,count @@
 context line
-removed line
+added line
 context line

This is ideal for:
- Making targeted changes to large files
- Modifying specific functions or sections
- Reducing token usage compared to write_to_file`,
		endsAgentStep: true,
		exampleInputs: [
			{
				path: "src/index.ts",
				diff: "@@ -10,3 +10,3 @@\n context\n-old line\n+new line\n context",
			},
		],
		execute: async (params: z.infer<typeof inputSchema>) => {
			const block = createToolUseBlock("apply_diff", params)
			const helpers = createToolHelpers(context)

			await applyDiffTool(
				context.task,
				block,
				helpers.askApproval,
				helpers.handleError,
				helpers.pushToolResult,
				helpers.removeClosingTag,
			)

			return helpers.getResults()
		},
	})
}

/**
 * Create ask_followup_question tool definition for Codebuff SDK
 */
export function createAskFollowupQuestionTool(context: ToolExecutionContext): CustomToolDefinition {
	const inputSchema = z.object({
		question: z.string().describe("The question to ask the user"),
	})

	return getCustomToolDefinition({
		toolName: "ask_followup_question",
		inputSchema,
		description: `Ask the user a follow-up question when you need more information to complete the task.

Use this when:
- Requirements are unclear or ambiguous
- Multiple implementation approaches are possible
- You need user preferences or decisions
- Critical information is missing

IMPORTANT:
- Ask clear, specific questions
- Explain why you need the information
- Provide context about what you're trying to accomplish
- Don't ask questions you can reasonably infer answers to`,
		endsAgentStep: true,
		exampleInputs: [
			{ question: "Should I use TypeScript or JavaScript for the new component?" },
			{ question: "What should be the default value for the timeout parameter?" },
		],
		execute: async (params: z.infer<typeof inputSchema>) => {
			const block = createToolUseBlock("ask_followup_question", params)
			const helpers = createToolHelpers(context)

			await askFollowupQuestionTool(
				context.task,
				block,
				helpers.askApproval,
				helpers.handleError,
				helpers.pushToolResult,
				helpers.removeClosingTag,
			)

			return helpers.getResults()
		},
	})
}

/**
 * Create attempt_completion tool definition for Codebuff SDK
 */
export function createAttemptCompletionTool(context: ToolExecutionContext): CustomToolDefinition {
	const inputSchema = z.object({
		result: z.string().describe("Summary of what was accomplished"),
		command: z.string().optional().describe("Optional command for the user to run to verify the changes"),
	})

	return getCustomToolDefinition({
		toolName: "attempt_completion",
		inputSchema,
		description:
			'Signal that you have completed the task. Use this when you believe you have successfully accomplished what the user requested.\n\nIMPORTANT:\n- Provide a clear summary of what was done\n- Include a verification command if applicable (e.g., "npm test", "npm run build")\n- Only use this when the task is truly complete\n- If there are remaining issues or uncertainties, ask a follow-up question instead\n\nThe \'result\' should include:\n- What files were created/modified\n- What functionality was implemented\n- Any important notes or caveats\n- Next steps if applicable',
		endsAgentStep: true,
		exampleInputs: [
			{
				result: "Created authentication module with login and logout functions. Added tests covering all scenarios.",
				command: "npm test",
			},
			{
				result: "Fixed the bug in the user service. The null pointer exception is now handled properly.",
			},
		],
		execute: async (params: z.infer<typeof inputSchema>) => {
			const block = createToolUseBlock("attempt_completion", params)
			const helpers = createToolHelpers(context)

			await attemptCompletionTool(
				context.task,
				block,
				helpers.askApproval,
				helpers.handleError,
				helpers.pushToolResult,
				helpers.removeClosingTag,
				helpers.toolDescription,
				helpers.askFinishSubTaskApproval,
			)

			return helpers.getResults()
		},
	})
}

/**
 * Get all Codebuff tool definitions for the Task
 */
export function getAllCodebuffTools(context: ToolExecutionContext): CustomToolDefinition[] {
	return [
		createReadFileTool(context),
		createWriteToFileTool(context),
		createExecuteCommandTool(context),
		createListFilesTool(context),
		createSearchFilesTool(context),
		createApplyDiffTool(context),
		createAskFollowupQuestionTool(context),
		createAttemptCompletionTool(context),
	]
}

/**
 * Get tool definitions by names
 */
export function getCodebuffToolsByNames(context: ToolExecutionContext, toolNames: string[]): CustomToolDefinition[] {
	const allTools = getAllCodebuffTools(context)
	return allTools.filter((tool) => toolNames.includes(tool.toolName))
}
