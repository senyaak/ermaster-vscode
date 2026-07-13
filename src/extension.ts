import * as vscode from 'vscode';
import { ErdEditorProvider, openDdlForText } from './erdEditorProvider';
import { importDdl } from './erm/importDdl';
import { emptyDiagram } from './erm/ops';
import { writeErm } from './erm/write';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(ErdEditorProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand('erdesigner.newDiagram', newDiagram),
    vscode.commands.registerCommand('erdesigner.generateDdl', generateDdlCommand),
    vscode.commands.registerCommand('erdesigner.importDdl', importDdlCommand),
  );
}

async function importDdlCommand(uri?: vscode.Uri): Promise<void> {
  let source = uri;
  if (!source) {
    const picked = await vscode.window.showOpenDialog({
      filters: { SQL: ['sql', 'ddl'] },
      canSelectMany: false,
      title: 'Import DDL file',
    });
    source = picked?.[0];
  }
  if (!source) {
    return;
  }
  const sql = Buffer.from(await vscode.workspace.fs.readFile(source)).toString('utf8');
  let diagram;
  try {
    diagram = importDdl(sql);
  } catch (e) {
    vscode.window.showErrorMessage(`ER Designer: DDL import failed — ${String(e)}`);
    return;
  }
  const target = await vscode.window.showSaveDialog({
    defaultUri: source.with({ path: source.path.replace(/\.(sql|ddl)$/i, '.erm') }),
    filters: { 'ERMaster Diagram': ['erm'] },
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, Buffer.from(writeErm(diagram), 'utf8'));
  await vscode.commands.executeCommand('vscode.openWith', target, ErdEditorProvider.viewType);
}

async function newDiagram(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const target = await vscode.window.showSaveDialog({
    defaultUri: workspaceRoot ? vscode.Uri.joinPath(workspaceRoot, 'diagram.erm') : undefined,
    filters: { 'ERMaster Diagram': ['erm'] },
  });
  if (!target) {
    return;
  }
  const content = writeErm(emptyDiagram());
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
  await vscode.commands.executeCommand('vscode.openWith', target, ErdEditorProvider.viewType);
}

async function generateDdlCommand(uri?: vscode.Uri): Promise<void> {
  let target = uri;
  if (!target && vscode.window.activeTextEditor?.document.fileName.endsWith('.erm')) {
    target = vscode.window.activeTextEditor.document.uri;
  }
  if (!target) {
    const picked = await vscode.window.showOpenDialog({
      filters: { 'ERMaster Diagram': ['erm'] },
      canSelectMany: false,
    });
    target = picked?.[0];
  }
  if (!target) {
    return;
  }
  const doc = await vscode.workspace.openTextDocument(target);
  openDdlForText(doc.getText());
}

export function deactivate(): void {}
