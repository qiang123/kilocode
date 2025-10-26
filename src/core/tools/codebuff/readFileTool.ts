import path from "path"
import { isBinaryFile } from "isbinaryfile"

import { Task } from "../../task/Task"
import { ClineSayTool } from "../../../shared/ExtensionMessage"
import { formatResponse } from "../../prompts/responses"
import { t } from "../../../i18n"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../../shared/tools"
import { RecordSource } from "../../context-tracking/FileContextTrackerTypes"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { getReadablePath } from "../../../utils/path"
import { countFileLines } from "../../../integrations/misc/line-counter"
import { readLines } from "../../../integrations/misc/read-lines"
import { extractTextFromFile, addLineNumbers, getSupportedBinaryFormats } from "../../../integrations/misc/extract-text"
import { parseSourceCodeDefinitionsForFile } from "../../../services/tree-sitter"
import { parseXml } from "../../../utils/xml"
import { blockFileReadWhenTooLarge } from "../kilocode"
import {
	DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
	DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
	isSupportedImageFormat,
	validateImageForProcessing,
	processImageFile,
	ImageMemoryTracker,
} from "../helpers/imageHelpers"
import { ToolHelpers } from "../../../../../sdk/src/index"

export function getReadFilesToolDescription(blockName: string, blockParams: any): string {
	// Handle both single path and multiple files via args
	if (blockParams.paths) {
		try {
			const parsed = blockParams as any
			const files = Array.isArray(parsed.paths) ? parsed.paths : [parsed.paths].filter(Boolean)
			const paths = files.map((f: any) => f?.path).filter(Boolean) as string[]

			if (paths.length === 0) {
				return `[${blockName} with no valid paths]`
			} else if (paths.length === 1) {
				// Modified part for single file
				return `[${blockName} for '${paths[0]}'. Reading multiple files at once is more efficient for the LLM. If other files are relevant to your current task, please read them simultaneously.]`
			} else if (paths.length <= 3) {
				const pathList = paths.map((p) => `'${p}'`).join(", ")
				return `[${blockName} for ${pathList}]`
			} else {
				return `[${blockName} for ${paths.length} files]`
			}
		} catch (error) {
			console.error("Failed to parse read_file args XML for description:", error)
			return `[${blockName} with unparsable args]`
		}
	} else {
		return `[${blockName} with missing paths]`
	}
}
// Types
interface LineRange {
	start: number
	end: number
}

interface FileEntry {
	path?: string
	// lineRanges?: LineRange[]
}

// New interface to track file processing state
interface FileResult {
	path: string
	status: "approved" | "denied" | "blocked" | "error" | "pending"
	content?: string
	error?: string
	notice?: string
	feedbackText?: string // User feedback text from approval/denial
	feedbackImages?: any[] // User feedback images from approval/denial
}

export async function readFilesTool(
	cline: Task,
	filePaths: string[],
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
) {
	// Check if the current model supports images at the beginning
	const modelInfo = cline.api.getModel().info
	const supportsImages = modelInfo.supportsImages ?? false

	// Handle partial message first
	const fullPaths = filePaths.map((filePath) => getReadablePath(filePath ? path.resolve(cline.cwd, filePath) : ""))
	const sharedMessageProps: ClineSayTool = {
		tool: "readFiles",
		filePaths: fullPaths,
	}
	const partialMessage = JSON.stringify({
		...sharedMessageProps,
		content: undefined,
	} satisfies ClineSayTool)
	await cline.ask("tool", partialMessage, true).catch(() => {})

	// const fileEntries: FileEntry[] = []
	const fsSource = () => require("fs")
	const fs = typeof fsSource === "function" ? fsSource() : fsSource
	const fileEntries = await ToolHelpers.getFiles({ filePaths, cwd: cline.cwd, fs })
	console.log("Result of read_files tool:", fileEntries)

	// If, after trying both new and legacy, no valid file entries are found.
	if (Object.keys(fileEntries).length === 0) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("read_files")
		const errorMsg = await cline.sayAndCreateMissingParamError("read_files", "paths (containing valid file paths)")
		pushToolResult(`<paths><error>${errorMsg}</error></paths>`)
		return fileEntries
	}

	// Create an array to track the state of each file
	const fileResults: FileResult[] = []
	Object.keys(fileEntries).forEach((key) => {
		// let fileEntry = fileEntries[key]
		fileResults.push({
			path: key,
			status: "pending",
		})
	})

	// Function to update file result status
	const updateFileResult = (path: string, updates: Partial<FileResult>) => {
		const index = fileResults.findIndex((result) => result.path === path)
		if (index !== -1) {
			fileResults[index] = { ...fileResults[index], ...updates }
		}
	}

	try {
		// First validate all files and prepare for batch approval
		const filesToApprove: FileResult[] = []

		for (let i = 0; i < fileResults.length; i++) {
			const fileResult = fileResults[i]
			const relPath = fileResult.path
			const fullPath = path.resolve(cline.cwd, relPath)

			// Then check RooIgnore validation
			if (fileResult.status === "pending") {
				const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath)
				if (!accessAllowed) {
					await cline.say("rooignore_error", relPath)
					const errorMsg = formatResponse.rooIgnoreError(relPath)
					updateFileResult(relPath, {
						status: "blocked",
						error: errorMsg,
					})
					continue
				}

				// Add to files that need approval
				filesToApprove.push(fileResult)
			}
		}

		// Handle batch approval if there are multiple files to approve
		if (filesToApprove.length > 0) {
			const { maxReadFileLine = -1 } = (await cline.providerRef.deref()?.getState()) ?? {}

			// Prepare batch file data
			const batchFiles = filesToApprove.map((fileResult) => {
				const relPath = fileResult.path
				const fullPath = path.resolve(cline.cwd, relPath)
				const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

				const readablePath = getReadablePath(cline.cwd, relPath)

				return {
					path: readablePath,
					isOutsideWorkspace,
					content: fullPath, // Include full path for content
				}
			})

			const completeMessage = JSON.stringify({
				tool: "readFiles",
				batchFiles,
			} satisfies ClineSayTool)

			const { response, text, images } = await cline.ask("tool", completeMessage, false)

			// Process batch response
			if (response === "yesButtonClicked") {
				// Approve all files
				if (text) {
					await cline.say("user_feedback", text, images)
				}
				filesToApprove.forEach((fileResult) => {
					updateFileResult(fileResult.path, {
						status: "approved",
						feedbackText: text,
						feedbackImages: images,
					})
				})
			} else if (response === "noButtonClicked") {
				// Deny all files
				if (text) {
					await cline.say("user_feedback", text, images)
				}
				cline.didRejectTool = true
				filesToApprove.forEach((fileResult) => {
					updateFileResult(fileResult.path, {
						status: "denied",
						feedbackText: text,
						feedbackImages: images,
					})
				})
			} else {
				// Handle individual permissions from objectResponse
				// if (text) {
				// 	await cline.say("user_feedback", text, images)
				// }

				try {
					const individualPermissions = JSON.parse(text || "{}")
					let hasAnyDenial = false

					batchFiles.forEach((batchFile, index) => {
						const fileResult = filesToApprove[index]
						const approved = individualPermissions[batchFile.path] === true

						if (approved) {
							updateFileResult(fileResult.path, {
								status: "approved",
							})
						} else {
							hasAnyDenial = true
							updateFileResult(fileResult.path, {
								status: "denied",
							})
						}
					})

					if (hasAnyDenial) {
						cline.didRejectTool = true
					}
				} catch (error) {
					// Fallback: if JSON parsing fails, deny all files
					console.error("Failed to parse individual permissions:", error)
					cline.didRejectTool = true
					filesToApprove.forEach((fileResult) => {
						updateFileResult(fileResult.path, {
							status: "denied",
						})
					})
				}
			}
		} else if (filesToApprove.length === 1) {
			// Handle single file approval (existing logic)
			const fileResult = filesToApprove[0]
			const relPath = fileResult.path
			const fullPath = path.resolve(cline.cwd, relPath)
			const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

			const completeMessage = JSON.stringify({
				tool: "readFile",
				path: getReadablePath(cline.cwd, relPath),
				isOutsideWorkspace,
				content: fullPath,
				reason: "",
			} satisfies ClineSayTool)

			const { response, text, images } = await cline.ask("tool", completeMessage, false)

			if (response !== "yesButtonClicked") {
				// Handle both messageResponse and noButtonClicked with text
				if (text) {
					await cline.say("user_feedback", text, images)
				}
				cline.didRejectTool = true

				updateFileResult(relPath, {
					status: "denied",
					feedbackText: text,
					feedbackImages: images,
				})
			} else {
				// Handle yesButtonClicked with text
				if (text) {
					await cline.say("user_feedback", text, images)
				}

				updateFileResult(relPath, {
					status: "approved",
					feedbackText: text,
					feedbackImages: images,
				})
			}
		}

		// Track total image memory usage across all files
		const imageMemoryTracker = new ImageMemoryTracker()
		const state = await cline.providerRef.deref()?.getState()
		const {
			maxReadFileLine = -1,
			maxImageFileSize = DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
			maxTotalImageSize = DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
		} = state ?? {}

		// Then process only approved files
		for (const fileResult of fileResults) {
			// Skip files that weren't approved
			if (fileResult.status !== "approved") {
				continue
			}

			const relPath = fileResult.path
			const fullPath = path.resolve(cline.cwd, relPath)

			// Process approved files
			try {
				const [totalLines, isBinary] = await Promise.all([countFileLines(fullPath), isBinaryFile(fullPath)])

				// Handle binary files (but allow specific file types that extractTextFromFile can handle)
				if (isBinary) {
					const fileExtension = path.extname(relPath).toLowerCase()
					const supportedBinaryFormats = getSupportedBinaryFormats()

					// Check if it's a supported image format
					if (isSupportedImageFormat(fileExtension)) {
						try {
							// Validate image for processing
							const validationResult = await validateImageForProcessing(
								fullPath,
								supportsImages,
								maxImageFileSize,
								maxTotalImageSize,
								imageMemoryTracker.getTotalMemoryUsed(),
							)

							if (!validationResult.isValid) {
								// Track file read
								await cline.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

								updateFileResult(relPath, {
									content: `<file><path>${relPath}</path>\n<notice>${validationResult.notice}</notice>\n</file>`,
								})
								continue
							}

							// Process the image
							const imageResult = await processImageFile(fullPath)

							// Track memory usage for this image
							imageMemoryTracker.addMemoryUsage(imageResult.sizeInMB)

							// Track file read
							await cline.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

							// Store image data URL separately - NOT in XML
							updateFileResult(relPath, {
								content: `<file><path>${relPath}</path>\n<notice>${imageResult.notice}</notice>\n</file>`,
								// imageDataUrl: imageResult.dataUrl,
							})
							continue
						} catch (error) {
							const errorMsg = error instanceof Error ? error.message : String(error)
							updateFileResult(relPath, {
								status: "error",
								error: `Error reading image file: ${errorMsg}`,
								content: `<file><path>${relPath}</path><error>Error reading image file: ${errorMsg}</error></file>`,
							})
							await handleError(
								`reading image file ${relPath}`,
								error instanceof Error ? error : new Error(errorMsg),
							)
							continue
						}
					}

					// Check if it's a supported binary format that can be processed
					if (supportedBinaryFormats && supportedBinaryFormats.includes(fileExtension)) {
						// For supported binary formats (.pdf, .docx, .ipynb), continue to extractTextFromFile
						// Fall through to the normal extractTextFromFile processing below
					} else {
						// Handle unknown binary format
						const fileFormat = fileExtension.slice(1) || "bin" // Remove the dot, fallback to "bin"
						updateFileResult(relPath, {
							notice: `Binary file format: ${fileFormat}`,
							content: `<file><path>${relPath}</path>\n<binary_file format="${fileFormat}">Binary file - content not displayed</binary_file>\n</file>`,
						})
						continue
					}
				}

				// Handle normal file read
				const content = await extractTextFromFile(fullPath)

				// kilocode_change start: limit output size based on token count
				const blockResult = await blockFileReadWhenTooLarge(cline, relPath, content)
				if (blockResult) {
					updateFileResult(relPath, blockResult)
					continue
				}
				// kilocode_change end

				const lineRangeAttr = ` lines="1-${totalLines}"`
				let xmlInfo = totalLines > 0 ? `<content${lineRangeAttr}>\n${content}</content>\n` : `<content/>`

				if (totalLines === 0) {
					xmlInfo += `<notice>File is empty</notice>\n`
				}

				// Track file read
				await cline.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

				updateFileResult(relPath, {
					content: `<file><path>${relPath}</path>\n${xmlInfo}</file>`,
				})
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				updateFileResult(relPath, {
					status: "error",
					error: `Error reading file: ${errorMsg}`,
				})
				await handleError(`reading file ${relPath}`, error instanceof Error ? error : new Error(errorMsg))
			}
		}

		// Generate final XML result from all file results
		const xmlResults = fileResults.filter((result) => result.path).map((result) => result.path)
		const filesXml = `<files>\n${xmlResults.join("\n")}\n</files>`
		// Process all feedback in a unified way without branching
		let statusMessage = ""
		let feedbackImages: any[] = []

		// Handle denial with feedback (highest priority)
		const deniedWithFeedback = fileResults.find((result) => result.status === "denied" && result.feedbackText)

		if (deniedWithFeedback && deniedWithFeedback.feedbackText) {
			statusMessage = formatResponse.toolDeniedWithFeedback(deniedWithFeedback.feedbackText)
			feedbackImages = deniedWithFeedback.feedbackImages || []
		}
		// Handle generic denial
		else if (cline.didRejectTool) {
			statusMessage = formatResponse.toolDenied()
		}
		// Handle approval with feedback
		else {
			const approvedWithFeedback = fileResults.find(
				(result) => result.status === "approved" && result.feedbackText,
			)

			if (approvedWithFeedback && approvedWithFeedback.feedbackText) {
				statusMessage = formatResponse.toolApprovedWithFeedback(approvedWithFeedback.feedbackText)
				feedbackImages = approvedWithFeedback.feedbackImages || []
			}
		}

		// Combine all images: feedback images first, then file images
		const allImages = [...feedbackImages]

		// Re-check if the model supports images before including them, in case it changed during execution.
		const finalModelSupportsImages = cline.api.getModel().info.supportsImages ?? false
		const imagesToInclude = finalModelSupportsImages ? allImages : []

		// Push the result with appropriate formatting
		if (statusMessage || imagesToInclude.length > 0) {
			// Always use formatResponse.toolResult when we have a status message or images
			const result = formatResponse.toolResult(
				statusMessage || filesXml,
				imagesToInclude.length > 0 ? imagesToInclude : undefined,
			)

			// Handle different return types from toolResult
			if (typeof result === "string") {
				if (statusMessage) {
					pushToolResult(`${result}\n${filesXml}`)
				} else {
					pushToolResult(result)
				}
			} else {
				// For block-based results, append the files XML as a text block if not already included
				if (statusMessage) {
					const textBlock = { type: "text" as const, text: filesXml }
					pushToolResult([...result, textBlock])
				} else {
					pushToolResult(result)
				}
			}
		} else {
			// No images or status message, just push the files XML
			pushToolResult(filesXml)
		}
	} catch (error) {
		// Handle all errors using per-file format for consistency
		const relPath = fileResults[0]?.path || "unknown"
		const errorMsg = error instanceof Error ? error.message : String(error)

		// If we have file results, update the first one with the error
		if (fileResults.length > 0) {
			updateFileResult(relPath, {
				status: "error",
				error: `Error reading file: ${errorMsg}`,
			})
		}

		await handleError(`reading file ${relPath}`, error instanceof Error ? error : new Error(errorMsg))

		// Generate final XML result from all file results
		const xmlResults = fileResults.filter((result) => result.path).map((result) => result.path)

		pushToolResult(`<paths> [${xmlResults.join("\n")}\n</paths>`)
	}
	return fileEntries
}
