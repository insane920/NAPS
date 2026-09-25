import { validateSimulation } from './validateSimulation';
self.onmessage = ({ data }) => {
  try { self.postMessage(validateSimulation(data.elements, data.wires, data.settings, data.results)); }
  catch (error) { self.postMessage({ status: 'failed', messages: [error instanceof Error ? error.message : 'Ошибка проверки.'] }); }
};
