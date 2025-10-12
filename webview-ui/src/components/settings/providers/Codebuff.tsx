import { useCallback, useState, useEffect, useRef } from "react"
import { VSCodeTextField, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, type OrganizationAllowList, codebuffDefaultModelId } from "@roo-code/types"

import { RouterName } from "@roo/api"
import { ExtensionMessage } from "@roo/ExtensionMessage"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

type CodebuffProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const Codebuff = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	modelValidationError,
}: CodebuffProps) => {
	const { t } = useAppTranslation()
	const { routerModels } = useExtensionState()
	const [refreshStatus, setRefreshStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
	const [refreshError, setRefreshError] = useState<string | undefined>()
	const codebuffErrorJustReceived = useRef(false)

	useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (message.type === "singleRouterModelFetchResponse" && !message.success) {
				const providerName = message.values?.provider as RouterName
				if (providerName === "codebuff") {
					codebuffErrorJustReceived.current = true
					setRefreshStatus("error")
					setRefreshError(message.error)
				}
			} else if (message.type === "routerModels") {
				// If we were loading and no specific error for codebuff was just received, mark as success.
				// The ModelPicker will show available models or "no models found".
				if (refreshStatus === "loading") {
					if (!codebuffErrorJustReceived.current) {
						setRefreshStatus("success")
					}
					// If codebuffErrorJustReceived.current is true, status is already (or will be) "error".
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [refreshStatus, refreshError, setRefreshStatus, setRefreshError])

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const handleRefreshModels = useCallback(() => {
		codebuffErrorJustReceived.current = false // Reset flag on new refresh action
		setRefreshStatus("loading")
		setRefreshError(undefined)

		const key = apiConfiguration.codebuffApiKey
		const url = apiConfiguration.codebuffBaseUrl

		if (!key || !url) {
			setRefreshStatus("error")
			setRefreshError(t("settings:providers.refreshModels.missingConfig"))
			return
		}

		vscode.postMessage({ type: "requestRouterModels", values: { codebuffApiKey: key, codebuffBaseUrl: url } })
	}, [apiConfiguration, setRefreshStatus, setRefreshError, t])

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.codebuffBaseUrl || ""}
				onInput={handleInputChange("codebuffBaseUrl")}
				placeholder={t("settings:placeholders.baseUrl")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.codebuffBaseUrl")}</label>
			</VSCodeTextField>

			<VSCodeTextField
				value={apiConfiguration?.codebuffApiKey || ""}
				type="password"
				onInput={handleInputChange("codebuffApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.codebuffApiKey")}</label>
			</VSCodeTextField>

			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>

			<Button
				variant="outline"
				onClick={handleRefreshModels}
				disabled={
					refreshStatus === "loading" || !apiConfiguration.codebuffApiKey || !apiConfiguration.codebuffBaseUrl
				}
				className="w-full">
				<div className="flex items-center gap-2">
					{refreshStatus === "loading" ? (
						<span className="codicon codicon-loading codicon-modifier-spin" />
					) : (
						<span className="codicon codicon-refresh" />
					)}
					{t("settings:providers.refreshModels.label")}
				</div>
			</Button>
			{refreshStatus === "loading" && (
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.refreshModels.loading")}
				</div>
			)}
			{refreshStatus === "success" && (
				<div className="text-sm text-vscode-foreground">{t("settings:providers.refreshModels.success")}</div>
			)}
			{refreshStatus === "error" && (
				<div className="text-sm text-vscode-errorForeground">
					{refreshError || t("settings:providers.refreshModels.error")}
				</div>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				defaultModelId={codebuffDefaultModelId}
				models={routerModels?.codebuff ?? {}}
				modelIdKey="codebuffAgentId"
				serviceName="Codebuff"
				serviceUrl="http://localhost:3000/"
				setApiConfigurationField={setApiConfigurationField}
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>

			{/* Show prompt caching option if the selected model supports it */}
			{(() => {
				const selectedModelId = apiConfiguration.codebuffAgentId || codebuffDefaultModelId
				const selectedModel = routerModels?.codebuff?.[selectedModelId]
				if (selectedModel?.supportsPromptCache) {
					return (
						<div className="mt-4">
							<VSCodeCheckbox
								checked={apiConfiguration.codebuffUsePromptCache || false}
								onChange={(e: any) => {
									setApiConfigurationField("codebuffUsePromptCache", e.target.checked)
								}}>
								<span className="font-medium">{t("settings:providers.enablePromptCaching")}</span>
							</VSCodeCheckbox>
							<div className="text-sm text-vscode-descriptionForeground ml-6 mt-1">
								{t("settings:providers.enablePromptCachingTitle")}
							</div>
						</div>
					)
				}
				return null
			})()}
		</>
	)
}
