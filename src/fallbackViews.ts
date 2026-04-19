import * as path from 'path';
import * as vscode from 'vscode';
import { TwoWayDiffModel } from './diffEngine';

export function openDiffPreview(file1: vscode.Uri, file2: vscode.Uri, diffModel: TwoWayDiffModel): Thenable<vscode.TextEditor> {
    const renderCell = (content: string) => content.length === 0 ? '(empty)' : content;
    const document = `
# Diff: ${path.basename(file1.path)} ↔ ${path.basename(file2.path)}

Structured rows: ${diffModel.rows.length}

\`\`\`text
${diffModel.rows.map((row) => `${renderCell(row.left.content)}    |    ${renderCell(row.right.content)}`).join('\n')}
\`\`\`
        `;

    return vscode.workspace.openTextDocument({
        content: document,
        language: 'markdown'
    }).then((doc) => vscode.window.showTextDocument(doc));
}
