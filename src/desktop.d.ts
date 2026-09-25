export {};

declare global {
  interface Window {
    desktop?: {
      openCircuit(): Promise<{ name: string; content: string } | null>;
      saveCircuit(content: string, name: string): Promise<string | null>;
    };
  }
}
