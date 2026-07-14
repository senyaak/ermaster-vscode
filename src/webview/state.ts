import { ErmDiagram, ErmNode, ErmRelation } from '../erm/model';
import { loadErm } from '../erm/load';
import { writeErm } from '../erm/write';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const vscode = acquireVsCodeApi();

export type Tool = 'select' | 'table' | 'note' | 'relation';

export interface AppState {
  doc: ErmDiagram | null;
  selectedIndex: number;
  tool: Tool;
  /** during relation tool: index of the picked parent table, or -1 */
  relationSource: number;
  /** the relation whose bendpoints are being edited, or null */
  selectedRelation: ErmRelation | null;
  view: { x: number; y: number; scale: number };
  parseError: string;
}

export const app: AppState = {
  doc: null,
  selectedIndex: -1,
  tool: 'select',
  relationSource: -1,
  selectedRelation: null,
  view: { x: 40, y: 40, scale: 1 },
  parseError: '',
};

let lastText = '';
const listeners: (() => void)[] = [];

export function onChange(cb: () => void): void {
  listeners.push(cb);
}

export function notify(): void {
  for (const l of listeners) {
    l();
  }
}

export function post(msg: unknown): void {
  vscode.postMessage(msg);
}

/** Apply document text from the host. Returns false if it was our own echo. */
export function setDocFromText(text: string): boolean {
  if (text === lastText) {
    return false;
  }
  lastText = text;
  try {
    app.doc = loadErm(text);
    app.parseError = '';
  } catch (e) {
    app.parseError = `Invalid .erm file: ${String(e)}`;
    return true;
  }
  if (app.selectedIndex >= (app.doc?.contents.length ?? 0)) {
    app.selectedIndex = -1;
  }
  // relation objects are rebuilt on load; a held reference is now stale
  app.selectedRelation = null;
  return true;
}

/** Persist the current model to the host and refresh the UI. */
export function commit(): void {
  if (!app.doc) {
    return;
  }
  lastText = writeErm(app.doc);
  post({ type: 'apply', text: lastText });
  notify();
}

export function selectedNode(): ErmNode | null {
  if (!app.doc || app.selectedIndex < 0 || app.selectedIndex >= app.doc.contents.length) {
    return null;
  }
  return app.doc.contents[app.selectedIndex];
}

export function ready(): void {
  post({ type: 'ready' });
}
