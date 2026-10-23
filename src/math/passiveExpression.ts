/** A deliberately small expression language for passive laws. It never executes JavaScript. */
type Variable = 'x' | 'n' | 'x0' | 'y0';
type FunctionName = 'sin' | 'cos' | 'tanh' | 'exp' | 'log';
type Node = { kind: 'number'; value: number } | { kind: 'variable'; name: Variable } |
  { kind: 'unary'; operand: Node } | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Node; right: Node } |
  { kind: 'power'; base: Node; exponent: number } | { kind: 'function'; name: FunctionName; argument: Node };
type Dimension = { input: number; output: number };
type Dual = { value: number; derivative: number };

const variableDimensions: Record<Variable, Dimension> = {
  x: { input: 1, output: 0 }, n: { input: -1, output: 1 },
  x0: { input: 1, output: 0 }, y0: { input: 0, output: 1 },
};
const functions = new Set<FunctionName>(['sin', 'cos', 'tanh', 'exp', 'log']);
const sameDimension = (a: Dimension, b: Dimension) => a.input === b.input && a.output === b.output;
const dimensionless = { input: 0, output: 0 };
const resultDimension = { input: 0, output: 1 };
const cache = new Map<string, Node>();

function tokenize(expression: string): string[] {
  if (!expression.trim() || expression.length > 512) throw new Error('Формула должна содержать 1–512 символов.');
  const tokens: string[] = [];
  const pattern = /\s*((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9]*|[()+*/^\-])/y;
  let offset = 0;
  while (offset < expression.length) {
    if (/^\s*$/.test(expression.slice(offset))) break;
    pattern.lastIndex = offset;
    const match = pattern.exec(expression);
    if (!match) throw new Error(`Недопустимый символ в формуле на позиции ${offset + 1}.`);
    tokens.push(match[1]);
    if (tokens.length > 128) throw new Error('Формула слишком сложная (более 128 токенов).');
    offset = pattern.lastIndex;
  }
  return tokens;
}

function parse(expression: string): Node {
  const cached = cache.get(expression);
  if (cached) return cached;
  const tokens = tokenize(expression);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const primary = (depth: number): Node => {
    if (depth > 32) throw new Error('Формула имеет слишком большую вложенность.');
    const token = take();
    if (!token) throw new Error('Формула неожиданно закончилась.');
    if (token === '(') {
      const value = sum(depth + 1);
      if (take() !== ')') throw new Error('В формуле отсутствует закрывающая скобка.');
      return value;
    }
    if (/^(?:\d|\.)/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error('Число в формуле вне допустимого диапазона.');
      return { kind: 'number', value };
    }
    if (token in variableDimensions) return { kind: 'variable', name: token as Variable };
    if (functions.has(token as FunctionName)) {
      if (take() !== '(') throw new Error(`После ${token} нужна открывающая скобка.`);
      const argument = sum(depth + 1);
      if (take() !== ')') throw new Error(`После ${token} нужна закрывающая скобка.`);
      return { kind: 'function', name: token as FunctionName, argument };
    }
    throw new Error(`Неизвестное имя или знак в формуле: ${token}.`);
  };
  const power = (depth: number): Node => {
    let value = primary(depth);
    if (peek() === '^') {
      take();
      const exponent = Number(take());
      if (!Number.isInteger(exponent) || exponent < 0 || exponent > 12) {
        throw new Error('Степень должна быть целым числом от 0 до 12.');
      }
      value = { kind: 'power', base: value, exponent };
    }
    return value;
  };
  const unary = (depth: number): Node => {
    if (peek() === '+' || peek() === '-') {
      const op = take();
      const operand = unary(depth + 1);
      return op === '+' ? operand : { kind: 'unary', operand };
    }
    return power(depth);
  };
  const product = (depth: number): Node => {
    let value = unary(depth);
    while (peek() === '*' || peek() === '/') {
      const op = take() as '*' | '/';
      value = { kind: 'binary', op, left: value, right: unary(depth) };
    }
    return value;
  };
  const sum = (depth: number): Node => {
    let value = product(depth);
    while (peek() === '+' || peek() === '-') {
      const op = take() as '+' | '-';
      value = { kind: 'binary', op, left: value, right: product(depth) };
    }
    return value;
  };
  const root = sum(0);
  if (index !== tokens.length) throw new Error(`Лишний фрагмент формулы: ${peek()}.`);
  const dimension = dimensionOf(root);
  if (!sameDimension(dimension, resultDimension)) {
    throw new Error('Размерность формулы неверна: результат должен иметь единицы выходной величины. Используйте x0 и y0 для масштабов.');
  }
  if (cache.size >= 100) cache.clear();
  cache.set(expression, root);
  return root;
}

function dimensionOf(node: Node): Dimension {
  if (node.kind === 'number') return dimensionless;
  if (node.kind === 'variable') return variableDimensions[node.name];
  if (node.kind === 'unary') return dimensionOf(node.operand);
  if (node.kind === 'power') {
    const base = dimensionOf(node.base);
    return { input: base.input * node.exponent, output: base.output * node.exponent };
  }
  if (node.kind === 'function') {
    if (!sameDimension(dimensionOf(node.argument), dimensionless)) {
      throw new Error(`${node.name} принимает только безразмерный аргумент.`);
    }
    return dimensionless;
  }
  const left = dimensionOf(node.left), right = dimensionOf(node.right);
  if (node.op === '+' || node.op === '-') {
    if (!sameDimension(left, right)) throw new Error('Слагаемые формулы имеют разные физические размерности.');
    return left;
  }
  const sign = node.op === '*' ? 1 : -1;
  return { input: left.input + sign * right.input, output: left.output + sign * right.output };
}

function evaluate(node: Node, variables: Record<Variable, Dual>): Dual {
  if (node.kind === 'number') return { value: node.value, derivative: 0 };
  if (node.kind === 'variable') return variables[node.name];
  if (node.kind === 'unary') {
    const value = evaluate(node.operand, variables);
    return { value: -value.value, derivative: -value.derivative };
  }
  if (node.kind === 'power') {
    const base = evaluate(node.base, variables);
    return { value: base.value ** node.exponent,
      derivative: node.exponent === 0 ? 0 : node.exponent * base.value ** (node.exponent - 1) * base.derivative };
  }
  if (node.kind === 'function') {
    const argument = evaluate(node.argument, variables);
    if (node.name === 'log' && argument.value <= 0) throw new Error('Логарифм вне области определения.');
    const value = node.name === 'sin' ? Math.sin(argument.value) : node.name === 'cos' ? Math.cos(argument.value)
      : node.name === 'tanh' ? Math.tanh(argument.value) : node.name === 'exp' ? Math.exp(argument.value) : Math.log(argument.value);
    const slope = node.name === 'sin' ? Math.cos(argument.value) : node.name === 'cos' ? -Math.sin(argument.value)
      : node.name === 'tanh' ? 1 - value * value : node.name === 'exp' ? value : 1 / argument.value;
    return { value, derivative: slope * argument.derivative };
  }
  const left = evaluate(node.left, variables), right = evaluate(node.right, variables);
  if (node.op === '+') return { value: left.value + right.value, derivative: left.derivative + right.derivative };
  if (node.op === '-') return { value: left.value - right.value, derivative: left.derivative - right.derivative };
  if (node.op === '*') return { value: left.value * right.value, derivative: left.derivative * right.value + left.value * right.derivative };
  if (Math.abs(right.value) < 1e-24) throw new Error('Деление на ноль в пользовательской зависимости.');
  return { value: left.value / right.value,
    derivative: (left.derivative * right.value - left.value * right.derivative) / (right.value * right.value) };
}

export function evaluatePassiveExpression(expression: string, input: number, nominalSlope: number,
  inputScale: number, outputScale: number): Dual {
  const tree = parse(expression);
  return evaluate(tree, {
    x: { value: input, derivative: 1 }, n: { value: nominalSlope, derivative: 0 },
    x0: { value: inputScale, derivative: 0 }, y0: { value: outputScale, derivative: 0 },
  });
}

export function validatePassiveExpression(expression: string): void { parse(expression); }
