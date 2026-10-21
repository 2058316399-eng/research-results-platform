export type Matrix = number[][];
export type CommunityAlgorithm = "roasnmf" | "masnmf";

export type CommunityOptions = {
  algorithm: CommunityAlgorithm;
  components: number;
  iterations: number;
  lambda: number;
  alpha: number;
  randomState: number;
  init: "random" | "svdInit";
};

export type CommunityHistoryPoint = {
  iteration: number;
  loss: number;
  modularity: number;
};

export type CommunityResult = {
  algorithm: CommunityAlgorithm;
  labels: number[];
  membership: Matrix;
  interaction: Matrix;
  history: CommunityHistoryPoint[];
  modularity: number;
  loss: number;
  confidence: number[];
  communitySizes: number[];
  directed: boolean;
  edgeCount: number;
  density: number;
};

export type NetworkPreset = {
  label: string;
  description: string;
  matrix: Matrix;
  recommendedK: number;
};

const EPSILON = 1e-12;

function zeros(rows: number, columns: number): Matrix {
  return Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
}

function transpose(matrix: Matrix): Matrix {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function multiply(left: Matrix, right: Matrix): Matrix {
  const rows = left.length;
  const middle = right.length;
  const columns = right[0].length;
  const result = zeros(rows, columns);
  for (let row = 0; row < rows; row += 1) {
    for (let inner = 0; inner < middle; inner += 1) {
      const value = left[row][inner];
      if (value === 0) continue;
      for (let column = 0; column < columns; column += 1) result[row][column] += value * right[inner][column];
    }
  }
  return result;
}

function outer(left: number[], right: number[]): Matrix {
  return left.map((value) => right.map((other) => value * other));
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMatrix(rows: number, columns: number, random: () => number): Matrix {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => Math.max(random(), 1e-6)));
}

function copyMatrix(matrix: Matrix): Matrix {
  return matrix.map((row) => row.slice());
}

function reconstruct(W: Matrix, H: Matrix): Matrix {
  return multiply(multiply(W, H), transpose(W));
}

function frobenius(matrix: Matrix): number {
  return Math.sqrt(matrix.reduce((total, row) => total + row.reduce((sum, value) => sum + value * value, 0), 0));
}

function relativeLoss(target: Matrix, approximation: Matrix): number {
  const difference = target.map((row, rowIndex) => row.map((value, columnIndex) => value - approximation[rowIndex][columnIndex]));
  return frobenius(difference) / Math.max(frobenius(target), EPSILON);
}

function labelsFromMembership(membership: Matrix): number[] {
  return membership.map((row) => {
    let best = 0;
    for (let index = 1; index < row.length; index += 1) if (row[index] > row[best]) best = index;
    return best;
  });
}

function confidenceFromMembership(membership: Matrix): number[] {
  return membership.map((row) => Math.max(...row) / Math.max(row.reduce((sum, value) => sum + value, 0), EPSILON));
}

export function networkModularity(adjacency: Matrix, labels: number[]): number {
  const n = adjacency.length;
  const outDegree = adjacency.map((row) => row.reduce((sum, value) => sum + value, 0));
  const inDegree = Array.from({ length: n }, (_, column) => adjacency.reduce((sum, row) => sum + row[column], 0));
  const totalWeight = outDegree.reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) return 0;
  let modularity = 0;
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      if (labels[row] === labels[column]) modularity += adjacency[row][column] - (outDegree[row] * inDegree[column]) / totalWeight;
    }
  }
  return modularity / totalWeight;
}

function summarize(adjacency: Matrix, options: CommunityOptions, W: Matrix, H: Matrix, history: CommunityHistoryPoint[]): CommunityResult {
  const labels = labelsFromMembership(W);
  const directed = adjacency.some((row, i) => row.some((value, j) => Math.abs(value - adjacency[j][i]) > 1e-9));
  const edgeCount = adjacency.reduce((count, row, i) => count + row.reduce((sum, value, j) => sum + (i !== j && value > 0 ? 1 : 0), 0), 0);
  const possible = directed ? adjacency.length * (adjacency.length - 1) : adjacency.length * (adjacency.length - 1) / 2;
  const visibleEdgeCount = directed ? edgeCount : edgeCount / 2;
  const communitySizes = Array.from({ length: options.components }, (_, community) => labels.filter((label) => label === community).length);
  const approximation = reconstruct(W, H);
  return {
    algorithm: options.algorithm,
    labels,
    membership: W,
    interaction: H,
    history,
    modularity: networkModularity(adjacency, labels),
    loss: relativeLoss(adjacency, approximation),
    confidence: confidenceFromMembership(W),
    communitySizes,
    directed,
    edgeCount: visibleEdgeCount,
    density: possible > 0 ? visibleEdgeCount / possible : 0,
  };
}

function historyPoint(iteration: number, adjacency: Matrix, W: Matrix, H: Matrix): CommunityHistoryPoint {
  const labels = labelsFromMembership(W);
  return {
    iteration,
    loss: relativeLoss(adjacency, reconstruct(W, H)),
    modularity: networkModularity(adjacency, labels),
  };
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / Math.max(norm, EPSILON));
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function matrixVector(matrix: Matrix, vector: number[]): number[] {
  return matrix.map((row) => dot(row, vector));
}

function approximateSvd(adjacency: Matrix, components: number, random: () => number) {
  const n = adjacency.length;
  let residual = copyMatrix(adjacency);
  const leftVectors: number[][] = [];
  const rightVectors: number[][] = [];
  const singularValues: number[] = [];
  for (let component = 0; component < components; component += 1) {
    let right = normalizeVector(Array.from({ length: n }, () => random() - 0.5));
    for (let iteration = 0; iteration < 45; iteration += 1) {
      const leftStep = matrixVector(residual, right);
      const nextRight = matrixVector(transpose(residual), leftStep);
      right = normalizeVector(nextRight);
    }
    const projected = matrixVector(residual, right);
    const singular = Math.sqrt(projected.reduce((sum, value) => sum + value * value, 0));
    const left = projected.map((value) => value / Math.max(singular, EPSILON));
    leftVectors.push(left);
    rightVectors.push(right);
    singularValues.push(singular);
    residual = residual.map((row, i) => row.map((value, j) => value - singular * left[i] * right[j]));
  }
  return { leftVectors, rightVectors, singularValues };
}

function mnnsvdInit(adjacency: Matrix, components: number, random: () => number): [Matrix, Matrix] {
  const n = adjacency.length;
  const { leftVectors, rightVectors, singularValues } = approximateSvd(adjacency, components, random);
  const W = zeros(n, components);
  const basis = zeros(n, components);
  const D = zeros(components, components);
  const threshold = adjacency.flat().reduce((sum, value) => sum + value, 0) / (n * n);
  for (let component = 0; component < components; component += 1) {
    const left = leftVectors[component];
    const right = rightVectors[component];
    const leftPositive = left.map((value) => Math.max(value, 0));
    const leftNegative = left.map((value) => Math.max(-value, 0));
    const rightPositive = right.map((value) => Math.max(value, 0));
    const rightNegative = right.map((value) => Math.max(-value, 0));
    const positiveMagnitude = Math.sqrt(dot(leftPositive, leftPositive)) * Math.sqrt(dot(rightPositive, rightPositive));
    const negativeMagnitude = Math.sqrt(dot(leftNegative, leftNegative)) * Math.sqrt(dot(rightNegative, rightNegative));
    const selectedLeft = positiveMagnitude > negativeMagnitude ? leftPositive : leftNegative;
    const selectedRight = positiveMagnitude > negativeMagnitude ? rightPositive : rightNegative;
    const magnitude = Math.max(positiveMagnitude, negativeMagnitude);
    const normalizedLeft = normalizeVector(selectedLeft);
    const normalizedRight = normalizeVector(selectedRight);
    for (let row = 0; row < n; row += 1) {
      W[row][component] = Math.max(normalizedLeft[row], threshold, EPSILON);
      basis[row][component] = normalizedRight[row];
    }
    D[component][component] = magnitude * magnitude * singularValues[component];
  }
  const H = multiply(multiply(D, transpose(basis)), W).slice(0, components).map((row) => row.slice(0, components).map((value) => Math.max(value, threshold, EPSILON)));
  return [W, H];
}

function runRoAsNMF(adjacency: Matrix, options: CommunityOptions): CommunityResult {
  const n = adjacency.length;
  const k = options.components;
  const random = seededRandom(options.randomState);
  let U = randomMatrix(n, n, random);
  let W = randomMatrix(n, k, random);
  let H = randomMatrix(k, k, random);
  const history: CommunityHistoryPoint[] = [historyPoint(0, adjacency, W, H)];
  const recordEvery = Math.max(1, Math.floor(options.iterations / 40));

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const rowError = adjacency.map((row, rowIndex) => Math.sqrt(row.reduce((sum, value, columnIndex) => sum + (value - U[rowIndex][columnIndex]) ** 2, 0)));
    const q = rowError.map((value) => 1 / Math.max(value, EPSILON));
    const factorization = reconstruct(W, H);
    U = U.map((row, i) => row.map((value, j) => {
      const numerator = options.alpha * adjacency[i][j] * q[j] + factorization[i][j];
      const denominator = options.alpha * value * q[j] + value;
      return Math.max(EPSILON, value * Math.sqrt(Math.max(numerator, EPSILON) / Math.max(denominator, EPSILON)));
    }));

    const WT = transpose(W);
    const HT = transpose(H);
    const numeratorW1 = multiply(multiply(U, W), HT);
    const numeratorW2 = multiply(multiply(transpose(U), W), H);
    const denominatorW1 = multiply(multiply(multiply(multiply(W, H), WT), W), HT);
    const denominatorW2 = multiply(multiply(multiply(multiply(W, HT), WT), W), H);
    W = W.map((row, i) => {
      const rowSum = row.reduce((sum, value) => sum + value, 0);
      return row.map((value, j) => {
        const numerator = numeratorW1[i][j] + numeratorW2[i][j] + options.lambda;
        const denominator = denominatorW1[i][j] + denominatorW2[i][j] + options.lambda * rowSum;
        return Math.max(EPSILON, value * (Math.max(numerator, EPSILON) / Math.max(denominator, EPSILON)) ** 0.25);
      });
    });

    const gram = multiply(transpose(W), W);
    const numeratorH = multiply(multiply(transpose(W), U), W);
    const denominatorH = multiply(multiply(gram, H), gram);
    H = H.map((row, i) => row.map((value, j) => Math.max(EPSILON, value * numeratorH[i][j] / Math.max(denominatorH[i][j], EPSILON))));
    if (iteration % recordEvery === 0 || iteration === options.iterations) history.push(historyPoint(iteration, adjacency, W, H));
  }
  return summarize(adjacency, options, W, H, history);
}

function runMAsNMF(adjacency: Matrix, options: CommunityOptions): CommunityResult {
  const n = adjacency.length;
  const k = options.components;
  const random = seededRandom(options.randomState);
  const outDegree = adjacency.map((row) => row.reduce((sum, value) => sum + value, 0));
  const inDegree = Array.from({ length: n }, (_, column) => adjacency.reduce((sum, row) => sum + row[column], 0));
  const totalWeight = Math.max(outDegree.reduce((sum, value) => sum + value, 0), EPSILON);
  const B1 = outer(outDegree, inDegree).map((row) => row.map((value) => value / totalWeight));
  const X = adjacency.map((row) => row.map((value) => options.alpha * value));
  let W: Matrix;
  let H: Matrix;
  let hatW: Matrix;
  if (options.init === "svdInit") {
    [W, H] = mnnsvdInit(adjacency, k, random);
    hatW = Array.from({ length: n }, () => new Array<number>(k).fill(1 / n));
  } else {
    W = randomMatrix(n, k, random);
    H = randomMatrix(k, k, random);
    hatW = randomMatrix(n, k, random);
  }
  const history: CommunityHistoryPoint[] = [historyPoint(0, adjacency, W, H)];
  const recordEvery = Math.max(1, Math.floor(options.iterations / 40));

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const WT = transpose(W);
    const HT = transpose(H);
    const numeratorW1 = multiply(multiply(X, W), HT);
    const numeratorW2 = multiply(multiply(transpose(X), W), H);
    const denominatorW1 = multiply(multiply(multiply(multiply(W, H), WT), W), HT);
    const denominatorW2 = multiply(multiply(multiply(multiply(W, HT), WT), W), H);
    W = W.map((row, i) => row.map((value, j) => {
      const numerator = numeratorW1[i][j] + numeratorW2[i][j] + options.lambda * hatW[i][j];
      const denominator = denominatorW1[i][j] + denominatorW2[i][j] + options.lambda;
      return Math.max(EPSILON, value * (Math.max(numerator, EPSILON) / Math.max(denominator, EPSILON)) ** 0.25);
    }));

    const gram = multiply(transpose(W), W);
    const numeratorH = multiply(multiply(transpose(W), X), W);
    const denominatorH = multiply(multiply(gram, H), gram);
    H = H.map((row, i) => row.map((value, j) => Math.max(EPSILON, value * numeratorH[i][j] / Math.max(denominatorH[i][j], EPSILON))));

    const numeratorHat1 = multiply(adjacency, hatW);
    const numeratorHat2 = multiply(transpose(adjacency), hatW);
    const denominatorHat1 = multiply(B1, hatW);
    const denominatorHat2 = multiply(transpose(B1), hatW);
    hatW = hatW.map((row, i) => row.map((value, j) => {
      const numerator = numeratorHat1[i][j] + numeratorHat2[i][j] + 2 * options.lambda * W[i][j];
      const denominator = denominatorHat1[i][j] + denominatorHat2[i][j] + 2 * options.lambda * value;
      return Math.max(EPSILON, value * Math.max(numerator, EPSILON) / Math.max(denominator, EPSILON));
    }));
    hatW = hatW.map((row) => {
      const sum = row.reduce((total, value) => total + value, 0);
      return row.map((value) => value / Math.max(sum, EPSILON));
    });
    if (iteration % recordEvery === 0 || iteration === options.iterations) history.push(historyPoint(iteration, adjacency, W, H));
  }
  return summarize(adjacency, options, W, H, history);
}

export function runCommunityDetection(adjacency: Matrix, options: CommunityOptions): CommunityResult {
  validateAdjacency(adjacency);
  const n = adjacency.length;
  if (!Number.isInteger(options.components) || options.components < 2 || options.components > Math.min(10, n)) throw new Error("社区数 k 必须是 2 到 min(10, 节点数) 之间的整数。");
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 1000) throw new Error("迭代次数必须是 1–1,000 的整数。");
  if (![options.lambda, options.alpha, options.randomState].every(Number.isFinite) || options.lambda < 0 || options.alpha <= 0) throw new Error("λ 应不小于 0，α 应大于 0，随机种子必须有效。");
  return options.algorithm === "roasnmf" ? runRoAsNMF(adjacency, options) : runMAsNMF(adjacency, options);
}

export function validateAdjacency(adjacency: Matrix) {
  const n = adjacency.length;
  if (n < 3 || n > 80) throw new Error("邻接矩阵支持 3–80 个节点。");
  if (adjacency.some((row) => row.length !== n)) throw new Error("邻接矩阵必须是方阵，每行列数应与节点数一致。");
  if (adjacency.some((row) => row.some((value) => !Number.isFinite(value) || value < 0))) throw new Error("邻接矩阵只能包含有限的非负数。");
  if (adjacency.flat().every((value) => value === 0)) throw new Error("邻接矩阵至少需要一条非零边。");
}

export function parseAdjacency(text: string): Matrix {
  const rows = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(/[\s,，;；\t]+/).filter(Boolean).map(Number));
  validateAdjacency(rows);
  return rows;
}

export function matrixToText(matrix: Matrix): string {
  return matrix.map((row) => row.join(",")).join("\n");
}

function blockNetwork(sizes: number[], bridges: Array<[number, number]>, directed = false): Matrix {
  const n = sizes.reduce((sum, value) => sum + value, 0);
  const matrix = zeros(n, n);
  let offset = 0;
  sizes.forEach((size) => {
    for (let i = offset; i < offset + size; i += 1) {
      for (let j = offset; j < offset + size; j += 1) {
        if (i !== j && ((i + j) % 3 !== 0 || Math.abs(i - j) === 1)) matrix[i][j] = 1;
      }
    }
    offset += size;
  });
  bridges.forEach(([source, target], index) => {
    matrix[source][target] = index % 2 === 0 ? 1 : 0.7;
    if (!directed) matrix[target][source] = matrix[source][target];
  });
  return matrix;
}

export const NETWORK_PRESETS: Record<string, NetworkPreset> = {
  twoBlocks: {
    label: "双社区桥接网络",
    description: "12 个节点，两个高密度社群由少量桥边连接",
    matrix: blockNetwork([6, 6], [[2, 7], [4, 9]]),
    recommendedK: 2,
  },
  threeBlocks: {
    label: "三社区网络",
    description: "18 个节点，适合观察三个社区的边界节点",
    matrix: blockNetwork([6, 6, 6], [[1, 8], [5, 13], [10, 16]]),
    recommendedK: 3,
  },
  directed: {
    label: "有向核心—边缘网络",
    description: "15 个节点，验证 MAsNMF 对非对称关系的处理",
    matrix: blockNetwork([5, 5, 5], [[0, 6], [7, 12], [13, 3], [4, 10]], true),
    recommendedK: 3,
  },
};
