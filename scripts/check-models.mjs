import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function loadModel(name) {
  const source = await readFile(new URL(`../src/app/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
function finiteValues(value) {
  if (typeof value === "number") assert(Number.isFinite(value), "计算结果不应含 NaN 或 Infinity");
  else if (Array.isArray(value)) value.forEach(finiteValues);
  else if (value && typeof value === "object") Object.values(value).forEach(finiteValues);
}
const malaria = await loadModel("malaria-model");
for (const scenario of ["DFE", "EE"]) {
  const result = malaria.simulateMalaria({ scenario, initial: malaria.DEFAULT_INITIALS[scenario], duration: 60, step: 0.1 });
  assert(result.series.length > 1);
  assert.equal(Object.keys(result.finalState).length, 10);
  finiteValues(result);
  finiteValues(malaria.computeR0(malaria.DEFAULT_R0_INPUTS[scenario]));
}
const xu = await loadModel("xu-models");
const svir = xu.simulateSVIR({ parameters: xu.SVIR_PRESETS.fig5.parameters, initial: xu.DEFAULT_SVIR_INITIAL, tEnd: 40, dt: 0.5, incidenceScale: 1 });
assert.equal(svir.times.length, svir.states.length);
finiteValues(svir);
finiteValues(xu.analyzeSVIR(xu.SVIR_PRESETS.fig5.parameters));
const sir = xu.simulateStochasticSIR(xu.DEFAULT_SIR_PARAMETERS, [0.7, 0.2, 0.1], 20, 0.1, 2025);
assert.equal(sir.times.length, sir.states.length);
assert.deepEqual(sir, xu.simulateStochasticSIR(xu.DEFAULT_SIR_PARAMETERS, [0.7, 0.2, 0.1], 20, 0.1, 2025), "固定随机种子结果应可复现");
finiteValues(sir);
const community = await loadModel("community-models");
for (const algorithm of ["roasnmf", "masnmf"]) {
  const result = community.runCommunityDetection(community.NETWORK_PRESETS.twoBlocks.matrix, {
    algorithm, components: 2, iterations: 60, lambda: 0.1, alpha: 1, randomState: 42, init: "svdInit",
  });
  assert.equal(result.labels.length, 12);
  assert.equal(result.membership.length, 12);
  finiteValues(result);
}
const siqh = await loadModel("delayed-siqh-model");
const delayed = siqh.simulateDelayedSIQH({ parameters: siqh.DEFAULT_SIQH_PARAMETERS, initial: siqh.DEFAULT_SIQH_INITIAL, tEnd: 30, dt: 0.5, controls: { u1: 0.15, u2: 0.15 } });
assert.equal(delayed.times.length, delayed.I.length);
finiteValues(delayed);
console.log("六模型数值冒烟检查通过：序列维度一致、结果有限、随机种子可复现。此检查不替代研究模型的专业验证。");
