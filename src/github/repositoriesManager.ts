/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Repository } from '../api/api';
import { AuthProvider } from '../common/authentication';
import { commands, contexts } from '../common/executeCommands';
import { Disposable, disposeAll } from '../common/lifecycle';
import Logger from '../common/logger';
import { ITelemetry } from '../common/telemetry';
import { EventType } from '../common/timelineEvent';
import { fromPRUri, fromRepoUri, Schemes } from '../common/uri';
import { compareIgnoreCase, isDescendant } from '../common/utils';
import { CredentialStore } from './credentials';
import { FolderRepositoryManager, ReposManagerState, ReposManagerStateContext } from './folderRepositoryManager';
import { PullRequestChangeEvent } from './githubRepository';
import { IssueModel } from './issueModel';
import { findDotComAndEnterpriseRemotes, getEnterpriseUri, hasEnterpriseUri, setEnterpriseUri } from './utils';

export interface ItemsResponseResult<T> {
	items: T[];
	hasMorePages: boolean;
	hasUnsearchedRepositories: boolean;
}

export interface PullRequestDefaults {
	owner: string;
	repo: string;
	base: string;
}

export class RepositoriesManager extends Disposable {
	static ID = 'RepositoriesManager';

	private _folderManagers: FolderRepositoryManager[] = [];
	private _subs: Map<FolderRepositoryManager, vscode.Disposable[]>;

	private _onDidChangeState = new vscode.EventEmitter<void>();
	readonly onDidChangeState: vscode.Event<void> = this._onDidChangeState.event;

	private _onDidChangeFolderRepositories = new vscode.EventEmitter<{ added?: FolderRepositoryManager }>();
	readonly onDidChangeFolderRepositories = this._onDidChangeFolderRepositories.event;

	private _onDidLoadAnyRepositories = new vscode.EventEmitter<void>();
	readonly onDidLoadAnyRepositories = this._onDidLoadAnyRepositories.event;

	private _onDidChangeAnyPullRequests = new vscode.EventEmitter<PullRequestChangeEvent[]>();
	readonly onDidChangeAnyPullRequests = this._onDidChangeAnyPullRequests.event;

	private _onDidAddPullRequest = new vscode.EventEmitter<IssueModel>();
	readonly onDidAddPullRequest = this._onDidAddPullRequest.event;

	private _onDidAddAnyGitHubRepository = new vscode.EventEmitter<FolderRepositoryManager>();
	readonly onDidChangeAnyGitHubRepository = this._onDidAddAnyGitHubRepository.event;

	private _state: ReposManagerState = ReposManagerState.Initializing;

	constructor(
		private _credentialStore: CredentialStore,
		private _telemetry: ITelemetry,
	) {
		super();
		this._subs = new Map();
		vscode.commands.executeCommand('setContext', ReposManagerStateContext, this._state);
	}

	private updateActiveReviewCount() {
		let count = 0;
		for (const folderManager of this._folderManagers) {
			if (folderManager.activePullRequest) {
				count++;
			}
		}
		commands.setContext(contexts.ACTIVE_PR_COUNT, count);
	}

	get folderManagers(): FolderRepositoryManager[] {
		return this._folderManagers;
	}

	private registerFolderListeners(folderManager: FolderRepositoryManager) {
		const disposables = [
			folderManager.onDidLoadRepositories(state => {
				this.state = state;
				this._onDidLoadAnyRepositories.fire();
			}),
			folderManager.onDidChangeActivePullRequest(() => this.updateActiveReviewCount()),
			folderManager.onDidDispose(() => this.removeRepo(folderManager.repository)),
			folderManager.onDidChangeAnyPullRequests(e => this._onDidChangeAnyPullRequests.fire(e)),
			folderManager.onDidAddPullRequest(e => this._onDidAddPullRequest.fire(e)),
			folderManager.onDidChangeGithubRepositories(() => this._onDidAddAnyGitHubRepository.fire(folderManager)),
		];
		this._subs.set(folderManager, disposables);
	}

	insertFolderManager(folderManager: FolderRepositoryManager) {
		this.registerFolderListeners(folderManager);

		// Try to insert the new repository in workspace folder order
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders) {
			const index = workspaceFolders.findIndex(
				folder => isDescendant(folder.uri.fsPath, folderManager.repository.rootUri.fsPath) || isDescendant(folderManager.repository.rootUri.fsPath, folder.uri.fsPath),
			);
			if (index > -1) {
				const arrayEnd = this._folderManagers.slice(index, this._folderManagers.length);
				this._folderManagers = this._folderManagers.slice(0, index);
				this._folderManagers.push(folderManager);
				this._folderManagers.push(...arrayEnd);
				this.updateActiveReviewCount();
				this._onDidChangeFolderRepositories.fire({ added: folderManager });
				return;
			}
		}
		this._folderManagers.push(folderManager);
		this.updateActiveReviewCount();
		this._onDidChangeFolderRepositories.fire({ added: folderManager });
	}

	removeRepo(repo: Repository) {
		const existingFolderManagerIndex = this._folderManagers.findIndex(
			manager => manager.repository.rootUri.toString() === repo.rootUri.toString(),
		);
		if (existingFolderManagerIndex > -1) {
			const folderManager = this._folderManagers[existingFolderManagerIndex];
			disposeAll(this._subs.get(folderManager)!);
			this._subs.delete(folderManager);
			this._folderManagers.splice(existingFolderManagerIndex);
			folderManager.dispose();
			this.updateActiveReviewCount();
			this._onDidChangeFolderRepositories.fire({});
		}
	}

	getManagerForIssueModel(issueModel: IssueModel | undefined): FolderRepositoryManager | undefined {
		if (issueModel === undefined) {
			return undefined;
		}
		return this.getManagerForRepository(issueModel.remote.owner, issueModel.remote.repositoryName);
	}

	getManagerForFile(uri: vscode.Uri): FolderRepositoryManager | undefined {
		if (uri.scheme === 'untitled') {
			return this._folderManagers[0];
		}

		const repoInfo = ((uri.scheme === Schemes.Repo) ? fromRepoUri(uri) : undefined);
		const prInfo = ((uri.scheme === Schemes.Pr) ? fromPRUri(uri) : undefined);

		// Prioritize longest path first to handle nested workspaces
		const folderManagers = this._folderManagers
			.slice()
			.sort((a, b) => b.repository.rootUri.path.length - a.repository.rootUri.path.length);

		for (const folderManager of folderManagers) {
			const managerPath = folderManager.repository.rootUri.path;

			if (repoInfo && folderManager.findExistingGitHubRepository({ owner: repoInfo.owner, repositoryName: repoInfo.repo })) {
				return folderManager;
			} else if (prInfo && folderManager.repository.state.remotes.find(remote => remote.name === prInfo.remoteName)) {
				return folderManager;
			} else {
				const testUriRelativePath = uri.path.substring(
					managerPath.length > 1 ? managerPath.length + 1 : managerPath.length,
				);
				if (compareIgnoreCase(vscode.Uri.joinPath(folderManager.repository.rootUri, testUriRelativePath).path, uri.path) === 0) {
					return folderManager;
				}
			}
		}
		return undefined;
	}

	getManagerForRepository(owner: string, repo: string) {
		const issueRemoteUrl = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
		for (const folderManager of this._folderManagers) {
			if (
				folderManager.gitHubRepositories
					.map(repo =>
						`${repo.remote.owner.toLowerCase()}/${repo.remote.repositoryName.toLowerCase()}`
					)
					.includes(issueRemoteUrl)
			) {
				return folderManager;
			}
		}
	}

	get state() {
		return this._state;
	}

	set state(state: ReposManagerState) {
		const stateChange = state !== this._state;
		this._state = state;
		if (stateChange) {
			vscode.commands.executeCommand('setContext', ReposManagerStateContext, state);
			this._onDidChangeState.fire();
		}
	}

	get credentialStore(): CredentialStore {
		return this._credentialStore;
	}

	async clearCredentialCache(): Promise<void> {
		await this._credentialStore.reset();
		this.state = ReposManagerState.Initializing;
	}

	async authenticate(enterprise?: boolean): Promise<boolean> {
		if (enterprise === false) {
			return !!this._credentialStore.login(AuthProvider.github);
		}
		const { dotComRemotes, enterpriseRemotes, unknownRemotes } = await findDotComAndEnterpriseRemotes(this.folderManagers);
		const yes = vscode.l10n.t('Yes');

		if (enterprise) {
			let remoteToUse = getEnterpriseUri()?.toString() ?? (enterpriseRemotes.length ? enterpriseRemotes[0].normalizedHost : (unknownRemotes.length ? unknownRemotes[0].normalizedHost : undefined));
			if (enterpriseRemotes.length === 0 && unknownRemotes.length === 0) {
				Logger.appendLine(`Enterprise login selected, but no possible enterprise remotes discovered (${dotComRemotes.length} .com)`, RepositoriesManager.ID);
			}
			if (remoteToUse) {
				const no = vscode.l10n.t('No, manually set {0}', 'github-enterprise.uri');
				const promptResult = await vscode.window.showInformationMessage(vscode.l10n.t('Would you like to set up GitHub Pull Requests and Issues to authenticate with the enterprise server {0}?', remoteToUse),
					{ modal: true }, yes, no);
				if (promptResult === yes) {
					await setEnterpriseUri(remoteToUse);
				} else if (promptResult === no) {
					remoteToUse = undefined;
				} else {
					return false;
				}
			}
			if (!remoteToUse) {
				const setEnterpriseUriPrompt = await vscode.window.showInputBox({
					placeHolder: vscode.l10n.t('Set a GitHub Enterprise server URL'), ignoreFocusOut: true, validateInput: (value) => {
						const pattern = /^(?:$|(https?):\/\/(?!github\.com).*)/;
						if (!pattern.test(value)) {
							return vscode.l10n.t('Please enter a valid GitHub Enterprise server URL. A "github.com" URL is not valid for GitHub Enterprise.');
						}
						return undefined;
					}
				});
				if (setEnterpriseUriPrompt) {
					await setEnterpriseUri(setEnterpriseUriPrompt);
				} else {
					return false;
				}
			}
		}
		// If we have no github.com remotes, but we do have github remotes, then we likely have github enterprise remotes.
		else if (!hasEnterpriseUri() && (dotComRemotes.length === 0) && (enterpriseRemotes.length > 0)) {
			const promptResult = await vscode.window.showInformationMessage(vscode.l10n.t('It looks like you might be using GitHub Enterprise. Would you like to set up GitHub Pull Requests and Issues to authenticate with the enterprise server {0}?', enterpriseRemotes[0].normalizedHost),
				{ modal: true }, yes, vscode.l10n.t('No, use GitHub.com'));
			if (promptResult === yes) {
				await setEnterpriseUri(enterpriseRemotes[0].normalizedHost);
			} else if (promptResult === undefined) {
				return false;
			}
		}

		let githubEnterprise;
		const hasNonDotComRemote = (enterpriseRemotes.length > 0) || (unknownRemotes.length > 0);
		if ((hasEnterpriseUri() || (dotComRemotes.length === 0)) && hasNonDotComRemote) {
			githubEnterprise = await this._credentialStore.login(AuthProvider.githubEnterprise);
		}
		let github;
		if (!githubEnterprise && (!hasEnterpriseUri() || enterpriseRemotes.length === 0)) {
			github = await this._credentialStore.login(AuthProvider.github);
		}
		return !!github || !!githubEnterprise;
	}

	override dispose() {
		this._subs.forEach(sub => disposeAll(sub));
	}
}

export function getEventType(text: string) {
	switch (text) {
		case 'committed':
			return EventType.Committed;
		case 'mentioned':
			return EventType.Mentioned;
		case 'subscribed':
			return EventType.Subscribed;
		case 'commented':
			return EventType.Commented;
		case 'reviewed':
			return EventType.Reviewed;
		default:
			return EventType.Other;
	}
}
