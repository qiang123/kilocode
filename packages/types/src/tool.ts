import * as z from "zod"

/**
 * ToolGroup
 */

export const toolGroups = ["read", "edit", "browser", "command", "mcp", "modes"] as const

export const toolGroupsSchema = z.enum(toolGroups)

export type ToolGroup = z.infer<typeof toolGroupsSchema>

/**
 * ToolName
 */

export const toolNames = [
	"execute_command",
	"read_file",
	"write_to_file",
	"apply_diff",
	"insert_content",
	"search_and_replace",
	"search_files",
	"list_files",
	"list_code_definition_names",
	"browser_action",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"fetch_instructions",
	"codebase_search",
	// kilocode_change start
	"edit_file",
	"new_rule",
	"report_bug",
	"condense",
	// kilocode_change end
	"update_todo_list",
	"run_slash_command",
	"generate_image",
	//
	"code_search",
	"end_turn",
	"find_files",
	"glob",
	"list_directory",
	"lookup_agent_info",
	"read_docs",
	"read_files",
	"run_file_change_hooks",
	"run_terminal_command",
	"set_messages",
	"set_output",
	"spawn_agents",
	"spawn_agent_inline",
	"str_replace",
	"think_deeply",
	"web_search",
	"write_file",
] as const

export const toolNamesSchema = z.enum(toolNames)

export type ToolName = z.infer<typeof toolNamesSchema>

/**
 * ToolUsage
 */

export const toolUsageSchema = z.record(
	toolNamesSchema,
	z.object({
		attempts: z.number(),
		failures: z.number(),
	}),
)

export type ToolUsage = z.infer<typeof toolUsageSchema>
