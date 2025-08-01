/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as vscode from 'vscode';
import { ITelemetry } from '../../common/telemetry';
import { CopilotRemoteAgentManager } from '../../github/copilotRemoteAgent';
import { CredentialStore } from '../../github/credentials';
import { RepositoriesManager } from '../../github/repositoriesManager';
import { ChatParticipantState } from '../participants';
import { ActivePullRequestTool } from './activePullRequestTool';
import { CopilotRemoteAgentTool } from './copilotRemoteAgentTool';
import { DisplayIssuesTool } from './displayIssuesTool';
import { FetchIssueTool } from './fetchIssueTool';
import { FetchNotificationTool } from './fetchNotificationTool';
import { ConvertToSearchSyntaxTool, SearchTool } from './searchTools';
import { SuggestFixTool } from './suggestFixTool';
import { IssueSummarizationTool } from './summarizeIssueTool';
import { NotificationSummarizationTool } from './summarizeNotificationsTool';

export function registerTools(context: vscode.ExtensionContext, credentialStore: CredentialStore, repositoriesManager: RepositoriesManager, chatParticipantState: ChatParticipantState, copilotRemoteAgentManager: CopilotRemoteAgentManager, telemetry: ITelemetry) {
	registerFetchingTools(context, credentialStore, repositoriesManager, chatParticipantState);
	registerSummarizationTools(context);
	registerSuggestFixTool(context, credentialStore, repositoriesManager, chatParticipantState);
	registerSearchTools(context, credentialStore, repositoriesManager, chatParticipantState);
	registerCopilotAgentTools(context, copilotRemoteAgentManager, telemetry);
	context.subscriptions.push(vscode.lm.registerTool(ActivePullRequestTool.toolId, new ActivePullRequestTool(repositoriesManager, copilotRemoteAgentManager)));
}

function registerFetchingTools(context: vscode.ExtensionContext, credentialStore: CredentialStore, repositoriesManager: RepositoriesManager, chatParticipantState: ChatParticipantState) {
	context.subscriptions.push(vscode.lm.registerTool(FetchIssueTool.toolId, new FetchIssueTool(credentialStore, repositoriesManager, chatParticipantState)));
	context.subscriptions.push(vscode.lm.registerTool(FetchNotificationTool.toolId, new FetchNotificationTool(credentialStore, repositoriesManager, chatParticipantState)));
}

function registerSummarizationTools(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.lm.registerTool(IssueSummarizationTool.toolId, new IssueSummarizationTool()));
	context.subscriptions.push(vscode.lm.registerTool(NotificationSummarizationTool.toolId, new NotificationSummarizationTool()));
}

function registerSuggestFixTool(context: vscode.ExtensionContext, credentialStore: CredentialStore, repositoriesManager: RepositoriesManager, chatParticipantState: ChatParticipantState) {
	context.subscriptions.push(vscode.lm.registerTool(SuggestFixTool.toolId, new SuggestFixTool(credentialStore, repositoriesManager, chatParticipantState)));
}

function registerCopilotAgentTools(context: vscode.ExtensionContext, copilotRemoteAgentManager: CopilotRemoteAgentManager, telemetry: ITelemetry) {
	context.subscriptions.push(vscode.lm.registerTool(CopilotRemoteAgentTool.toolId, new CopilotRemoteAgentTool(copilotRemoteAgentManager, telemetry)));
}

function registerSearchTools(context: vscode.ExtensionContext, credentialStore: CredentialStore, repositoriesManager: RepositoriesManager, chatParticipantState: ChatParticipantState) {
	context.subscriptions.push(vscode.lm.registerTool(ConvertToSearchSyntaxTool.toolId, new ConvertToSearchSyntaxTool(credentialStore, repositoriesManager, chatParticipantState)));
	context.subscriptions.push(vscode.lm.registerTool(SearchTool.toolId, new SearchTool(credentialStore, repositoriesManager, chatParticipantState)));
	context.subscriptions.push(vscode.lm.registerTool(DisplayIssuesTool.toolId, new DisplayIssuesTool(context, chatParticipantState)));
}