import * as vscode from 'vscode';
import { generateDdl } from './ddl';
import { loadErm } from './erm/load';
import { validateDiagram } from './erm/validate';

export class ErdEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'erm-vsc.erdEditor';

  private static diagnostics: vscode.DiagnosticCollection;

  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    ErdEditorProvider.diagnostics = vscode.languages.createDiagnosticCollection('erm-vsc');
    context.subscriptions.push(ErdEditorProvider.diagnostics);
    return vscode.window.registerCustomEditorProvider(
      ErdEditorProvider.viewType,
      new ErdEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): void {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    const postDocument = () => {
      webviewPanel.webview.postMessage({ type: 'update', text: document.getText() });
      this.updateDiagnostics(document);
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        postDocument();
      }
    });
    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'ready':
          postDocument();
          break;
        case 'apply':
          this.replaceDocument(document, msg.text);
          break;
        case 'generateDdl':
          openDdlForText(document.getText());
          break;
        case 'exportSvg':
          saveExport(document, 'svg', Buffer.from(msg.svg, 'utf8'));
          break;
        case 'exportPng':
          saveExport(document, 'png', Buffer.from(msg.dataUrl.split(',')[1] ?? '', 'base64'));
          break;
      }
    });
  }

  private updateDiagnostics(document: vscode.TextDocument): void {
    let issues;
    try {
      issues = validateDiagram(loadErm(document.getText()));
    } catch {
      ErdEditorProvider.diagnostics.set(document.uri, []);
      return;
    }
    const text = document.getText();
    const searchFrom = new Map<string, number>();
    const result: vscode.Diagnostic[] = [];
    for (const issue of issues) {
      let range = new vscode.Range(0, 0, 0, 1);
      if (issue.anchor) {
        const from = searchFrom.get(issue.anchor) ?? 0;
        const idx = text.indexOf(issue.anchor, from);
        if (idx >= 0) {
          searchFrom.set(issue.anchor, idx + issue.anchor.length);
          range = new vscode.Range(
            document.positionAt(idx),
            document.positionAt(idx + issue.anchor.length),
          );
        }
      }
      result.push(
        new vscode.Diagnostic(
          range,
          issue.message,
          issue.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        ),
      );
    }
    ErdEditorProvider.diagnostics.set(document.uri, result);
  }

  private replaceDocument(document: vscode.TextDocument, text: string): void {
    if (document.getText() === text) {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
    vscode.workspace.applyEdit(edit);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css'),
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data: blob:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>ER Diagram</title>
</head>
<body>
  <div id="toolbar">
    <select id="sel-view-mode" title="Display mode">
      <option value="1">Physical</option>
      <option value="0">Logical</option>
      <option value="2">Both</option>
    </select>
    <select id="sel-database" title="Database dialect"></select>
    <span class="toolbar-spacer"></span>
    <button id="btn-categories" title="Categories (visual groups)">Groups</button>
    <button id="btn-ddl" title="Generate DDL">DDL</button>
    <button id="btn-export-svg" title="Export SVG">SVG</button>
    <button id="btn-export-png" title="Export PNG">PNG</button>
    <span id="parse-error"></span>
  </div>
  <div id="main">
    <div id="palette">
      <button class="tool-btn active" data-tool="select" title="Select (Esc)"><span class="tool-ico">↖</span><span class="tool-lbl">Select</span></button>
      <button class="tool-btn" data-tool="table" title="New table"><span class="tool-ico">▦</span><span class="tool-lbl">Table</span></button>
      <button class="tool-btn" data-tool="note" title="New note"><span class="tool-ico">\u{1F5D2}</span><span class="tool-lbl">Note</span></button>
      <button class="tool-btn" data-tool="relation" title="1:n relation — click parent then child"><span class="tool-ico">⎁</span><span class="tool-lbl">Relation</span></button>
    </div>
    <div id="canvas-wrap">
      <svg id="canvas"></svg>
      <div id="hint"></div>
    </div>
  </div>
  <div id="dialog-root"></div>
  <div id="context-menu" class="hidden"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export function openDdlForText(text: string): void {
  let ddl: string;
  try {
    ddl = generateDdl(loadErm(text));
  } catch (e) {
    vscode.window.showErrorMessage(`erm-vsc: cannot parse diagram — ${String(e)}`);
    return;
  }
  vscode.workspace.openTextDocument({ language: 'sql', content: ddl }).then((doc) => {
    vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  });
}

async function saveExport(document: vscode.TextDocument, ext: 'svg' | 'png', data: Buffer): Promise<void> {
  const base = document.uri.path.replace(/\.erm$/, '');
  const target = await vscode.window.showSaveDialog({
    defaultUri: document.uri.with({ path: `${base}.${ext}` }),
    filters: ext === 'svg' ? { SVG: ['svg'] } : { PNG: ['png'] },
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, data);
  vscode.window.showInformationMessage(`erm-vsc: exported ${target.path.split('/').pop()}`);
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
