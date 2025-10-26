export interface ApiStreamNativeToolCallsChunk {
	type: "native_tool_calls"
	toolCalls: Array<{
		index?: number // OpenAI uses index to track tool calls across streaming deltas
		id?: string // Only present in first delta
		type?: string
		function?: {
			name: string
			arguments: string // JSON string
		}
	}>
}

export interface ApiStreamToolCallChunk {
	type: "tool_call"
	toolCall: {
		toolCallId?: string // Only present in first delta
		toolName?: string
		type?: string
		input: Record<string, any>
		agentId?: string
		parentAgentId?: string
	}
}
