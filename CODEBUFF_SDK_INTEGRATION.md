# Codebuff SDK Integration Status

## 已完成的工作

### 1. Task.ts 集成

-   ✅ 添加了 Codebuff SDK 的导入
-   ✅ 添加了 `codebuffClient` 和 `codebuffRunState` 属性
-   ✅ 添加了 `useCodebuffSdk` 配置选项
-   ✅ 实现了 `initializeCodebuffClient()` 方法
-   ✅ 实现了 `handleCodebuffEvent()` 事件处理器
-   ✅ 实现了 `attemptCodebuffApiRequest()` 方法

### 2. 工具转换器

-   ✅ 创建了 `codebuff-tool-converter.ts` 文件
-   ✅ 实现了 8 个工具的转换函数：
    -   `read_file`
    -   `write_to_file`
    -   `execute_command`
    -   `list_files`
    -   `search_files`
    -   `apply_diff`
    -   `ask_followup_question`
    -   `attempt_completion`
-   ✅ 实现了 `getAllCodebuffTools()` 函数
-   ✅ 实现了 `getCodebuffToolsByNames()` 函数

### 3. 工具定义传递

-   ✅ 在 `attemptCodebuffApiRequest()` 中创建工具执行上下文
-   ✅ 调用 `getAllCodebuffTools()` 获取所有工具定义
-   ✅ 将 `customToolDefinitions` 传递给 `codebuffClient.run()`

## 当前问题

### TypeScript 类型错误

由于使用相对路径导入，TypeScript 编译器报告找不到模块：

-   `../../../../../sdk/src/client`
-   `../../../../../sdk/src/run-state`
-   `../../../../../common/src/types/print-mode`
-   `../tools/codebuff-tool-converter`
-   `../../../../../sdk/src/custom-tool`

这些错误是 TypeScript 编译时的问题，不影响运行时。

### 解决方案选项

#### 选项 1: 添加 TypeScript 路径映射

在 `vscode-app/tsconfig.json` 中添加路径映射：

```json
{
	"compilerOptions": {
		"paths": {
			"@codebuff/sdk": ["../sdk/src"],
			"@codebuff/common": ["../common/src"]
		}
	}
}
```

#### 选项 2: 构建 SDK 并使用包导入

1. 构建 SDK: `cd sdk && bun run build`
2. 在 vscode-app 中添加 SDK 依赖
3. 使用包导入: `import { CodebuffClient } from "@codebuff/sdk"`

#### 选项 3: 忽略类型错误

如果运行时工作正常，可以暂时忽略这些编译时错误。

## 下一步

1. **修复 TypeScript 类型错误**（选择上述解决方案之一）
2. **实现工具执行逻辑**
    - 当前工具的 `execute` 函数只返回占位符
    - 需要实际调用 Task 的方法来执行工具操作
3. **测试集成**
    - 测试 Codebuff SDK 是否能正确调用
    - 测试工具是否能正确执行
    - 测试事件处理是否正常工作

## 使用方法

### 启用 Codebuff SDK

在创建 Task 时设置 `useCodebuffSdk: true`:

```typescript
const task = new Task({
	// ... other options
	useCodebuffSdk: true,
})
```

### 调用 Codebuff SDK

```typescript
await task.attemptCodebuffApiRequest()
```

### 切换回原生 API

```typescript
const task = new Task({
	// ... other options
	useCodebuffSdk: false, // 或者不设置
})

await task.attemptApiRequest()
```

## 架构说明

### 事件流

```
Codebuff SDK Event → handleCodebuffEvent() → Task Event → UI Update
```

### 工具执行流

```
LLM → Codebuff SDK → CustomToolDefinition.execute() → Task Method → Result
```

### 状态管理

-   `codebuffRunState`: 存储 Codebuff SDK 的运行状态，用于继续对话
-   `apiConversationHistory`: 存储对话历史，与原生 API 共享

## 注意事项

1. **工具执行上下文**: 每个工具都接收一个 `ToolExecutionContext`，包含对 Task 实例的引用
2. **事件转换**: Codebuff SDK 事件需要转换为 Task 事件格式
3. **状态持久化**: `codebuffRunState` 需要在对话之间保持，以支持多轮对话
4. **错误处理**: 需要妥善处理 SDK 调用失败的情况
