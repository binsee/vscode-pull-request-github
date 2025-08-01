/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import React, { ReactNode } from 'react';
import { gitHubLabelColor } from '../../src/common/utils';
import { DisplayLabel } from '../../src/github/views';

export interface LabelProps {
	label: DisplayLabel & { canDelete: boolean; isDarkTheme: boolean };
}

export function Label(label: DisplayLabel & { canDelete: boolean; isDarkTheme: boolean; children?: ReactNode}) {
	const { displayName, canDelete, color } = label;
	const labelColor = gitHubLabelColor(color, label.isDarkTheme, false);
	return (
		<div
			className="section-item label"
			style={{
				backgroundColor: labelColor.backgroundColor,
				color: labelColor.textColor,
				borderColor: `${labelColor.borderColor}`,
				paddingRight: canDelete ? '2px' : '8px'
			}}
		>
			{displayName}{label.children}
		</div>
	);
}

export function LabelCreate(label: DisplayLabel & { canDelete: boolean; isDarkTheme: boolean; children?: ReactNode}) {
	const { displayName, color } = label;
	const labelColor = gitHubLabelColor(color, label.isDarkTheme, false);
	return (
		<li
		style={{
			backgroundColor: labelColor.backgroundColor,
			color: labelColor.textColor,
			borderColor: `${labelColor.borderColor}`
		}}>
			{displayName}{label.children}</li>
	);
}
