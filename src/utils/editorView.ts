export interface EditorView {
  names: boolean; values: boolean; nodes: boolean; grid: boolean; polarity: boolean; snap: boolean;
}
export const DEFAULT_EDITOR_VIEW: EditorView = { names: true, values: true, nodes: false, grid: true, polarity: true, snap: true };
export function readEditorView(): EditorView {
  try {
    const saved = JSON.parse(localStorage.getItem('naps_editor_view') || '{}');
    return Object.fromEntries(Object.entries(DEFAULT_EDITOR_VIEW).map(([key, fallback]) =>
      [key, typeof saved?.[key] === 'boolean' ? saved[key] : fallback])) as unknown as EditorView;
  } catch { return { ...DEFAULT_EDITOR_VIEW }; }
}
