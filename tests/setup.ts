// The webview modules call acquireVsCodeApi() at import time; stub it so they
// can be imported in the test environment.
(globalThis as unknown as { acquireVsCodeApi: () => { postMessage(): void } }).acquireVsCodeApi = () => ({
  postMessage() {},
});
