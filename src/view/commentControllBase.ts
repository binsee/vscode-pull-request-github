/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../common/lifecycle';
import { ITelemetry } from '../common/telemetry';
import { Schemes } from '../common/uri';
import { FolderRepositoryManager } from '../github/folderRepositoryManager';
import { GitHubRepository } from '../github/githubRepository';
import { isCopilotOnMyBehalf, PullRequestModel } from '../github/pullRequestModel';

export abstract class CommentControllerBase extends Disposable {
	constructor(
		protected _folderRepoManager: FolderRepositoryManager,
		protected _telemetry: ITelemetry

	) {
		super();

		this._register(vscode.window.onDidChangeActiveTextEditor(e => this.onDidChangeActiveTextEditor(e)));
	}

	protected _commentController: vscode.CommentController;

	public get commentController(): vscode.CommentController {
		return this._commentController;
	}

	protected githubReposForPullRequest(pullRequest: undefined): undefined;
	protected githubReposForPullRequest(pullRequest: PullRequestModel): GitHubRepository[];
	protected githubReposForPullRequest(pullRequest: PullRequestModel | undefined): GitHubRepository[] | undefined;
	protected githubReposForPullRequest(pullRequest: PullRequestModel | undefined): GitHubRepository[] | undefined {
		const githubRepositories = pullRequest ? [pullRequest.githubRepository] : undefined;
		if (githubRepositories && pullRequest?.head) {
			const headRepo = this._folderRepoManager.findExistingGitHubRepository({ owner: pullRequest.head.owner, repositoryName: pullRequest.remote.repositoryName });
			if (headRepo) {
				githubRepositories.push(headRepo);
			}
		}
		return githubRepositories;
	}

	protected abstract onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined);

	protected async tryAddCopilotMention(editor: vscode.TextEditor, pullRequest: PullRequestModel) {
		if (editor.document.uri.scheme !== Schemes.Comment) {
			return;
		}

		if (editor.document.lineCount < 1 || editor.document.lineAt(0).text.length > 0) {
			return;
		}

		const currentUser = await this._folderRepoManager.getCurrentUser();
		if (!await isCopilotOnMyBehalf(pullRequest, currentUser)) {
			return;
		}

		return editor.edit(editBuilder => {
			editBuilder.insert(new vscode.Position(0, 0), '@copilot ');
		});
	}
}

