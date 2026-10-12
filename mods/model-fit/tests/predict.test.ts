import { test, expect } from 'claude-code/testing'

import { namedFiles, predict } from '../hooks/predict'
import type { Tier } from '../hooks/predict'

// Labelled prompts: what a reasonable person would call the tier. The predictor is a heuristic,
// so this table is its regression suite, not proof of accuracy.
const TABLE: [Tier, string][] = [
  // light
  ['light', 'fix typo in README'],
  ['light', 'fix the typo in the second paragraph of the abstract'],
  ['light', 'rename the variable x to n_obs in analysis.R'],
  ['light', 'rename fit_model to fit_gblup everywhere it is defined'],
  ['light', 'add a comment above the loop explaining the seed'],
  ['light', 'add roxygen docstrings to the exported helper'],
  ['light', 'change the default timeout to 30 seconds'],
  ['light', 'bump the version to 0.2.0 in DESCRIPTION'],
  ['light', 'git status'],
  ['light', 'list the files in the data folder please'],
  ['light', 'write a commit message for the staged changes'],
  ['light', 'explain this line of the regex to me'],
  ['light', 'translate this paragraph into Portuguese'],
  ['light', 'regenerate the boilerplate for a new Rust CLI crate'],
  ['light', 'remove the unused imports from main.rs'],
  ['light', 'reformat this file with the project style'],
  ['light', 'what is the difference between lapply and sapply?'],
  ['light', 'quick one-liner to count rows per group in dplyr'],
  ['light', 'add a missing import to utils.R'],
  ['light', 'show me the first 20 lines of data/pheno.csv'],
  // standard
  ['standard', 'write a testthat test for foo()'],
  ['standard', 'add unit tests for the parse_config function in src/config.rs'],
  ['standard', 'implement a function that reads the pedigree csv and returns a tibble'],
  ['standard', 'fix the bug where the plot labels overlap in plot_results()'],
  ['standard', 'refactor the data loading code into a helper'],
  ['standard', 'add a --verbose flag to the cli'],
  ['standard', 'write a pytest test that checks the loader handles empty files'],
  ['standard', 'update the ggplot theme so the legend is at the bottom'],
  ['standard', 'rename the function and write a test for it'],
  ['standard', 'please help me with my analysis of the field trial'],
  ['standard', 'add a cargo test for the allele frequency calculation in lib.rs'],
  ['standard', 'fit a mixed model with lme4 for the yield data and print the summary'],
  // deep
  ['deep', 'derive the BLUP variance of the genomic breeding value under REML'],
  ['deep', 'prove that the estimator is unbiased when the relationship matrix is singular'],
  ['deep', 'design the architecture for a pipeline that scores a million genotypes per hour'],
  ['deep', 'why does my Rust code only sometimes deadlock when I use rayon?'],
  ['deep', 'there is a race condition somewhere in the worker pool, think carefully'],
  ['deep', 'the results are non-deterministic across runs even with a fixed seed, find out why'],
  ['deep', 'which statistical method should I use for unbalanced multi-environment trials with spatial correlation'],
  ['deep', 'refactor the whole codebase across all modules to use the new error type'],
  ['deep', 'implement a Gibbs sampler for the animal model with unknown variance components'],
  ['deep', 'investigate the numerical stability of the Cholesky update when the matrix is ill-conditioned'],
  ['deep', 'port the entire R package to Rust across all files and keep the API'],
  ['deep', 'do a security review of the upload handler and think hard about injection'],
  ['deep', 'what is the time complexity of this algorithm and can we prove an invariant for the loop?'],
  ['deep', 'update src/a.rs src/b.rs src/c.rs src/d.rs src/e.rs so they share one trait'],
  ['deep', 'compare REML and ML for the unbalanced GWAS and explain how the kinship matrix enters'],
  ['deep', 'the borrow checker rejects my lifetime annotations in this unsafe block'],
  ['deep', 'swap the likelihood in the mixed model for a t distribution and rethink the estimator'],
  ['deep', 'simulate a breeding program to compare selection index options'],
  ['deep', 'prove the lemma about the kinship matrix being positive semi-definite'],
  ['deep', 'wrap this C library with FFI and review the trait objects it needs'],
  // review
  ['review', 'review the REML implementation in fit_reml.R'],
  ['review', 'verify that the GWAS kinship correction in this script is right'],
  ['review', 'review my diff and try to falsify it'],
  ['review', 'give me a second opinion on this approach'],
  ['review', 'audit the data cleaning script for leakage'],
  ['review', 'check my derivation of the REML score equations'],
  ['review', 'review the PR and cite file:line for every issue'],
  ['review', 'try to falsify the claim that the model is identifiable'],
]

test('the labelled table: at least 50 prompts, each lands on its tier', () => {
  expect(TABLE.length).toBeGreaterThanOrEqual(50)
  const wrong = TABLE.filter(([tier, text]) => predict(text).tier !== tier).map(([tier, text]) => `${tier}: ${text} -> ${predict(text).tier}`)
  expect(wrong).toEqual([])
})

test('every tier appears in the table', () => {
  for (const tier of ['light', 'standard', 'deep', 'review'] as const) expect(TABLE.some(([t]) => t === tier)).toBe(true)
})

test('shape of a prediction: confidence in range, reasons never empty', () => {
  for (const [, text] of TABLE) {
    const p = predict(text)
    expect(p.confidence).toBeGreaterThanOrEqual(0.3)
    expect(p.confidence).toBeLessThanOrEqual(0.97)
    expect(p.reasons.length).toBeGreaterThan(0)
  }
})

test('decided tiers are confident, a standard guess with no signal is not', () => {
  expect(predict('derive the BLUP variance of the genomic breeding value under REML').confidence).toBeGreaterThanOrEqual(0.9)
  expect(predict('fix typo in README').confidence).toBeGreaterThanOrEqual(0.7)
  expect(predict('please help me with my analysis of the field trial').confidence).toBeLessThan(0.7)
})

test('security review is deep, a plain audit is review', () => {
  expect(predict('do a security review of the login flow').tier).toBe('deep')
  expect(predict('audit the loader for off-by-one errors').tier).toBe('review')
})

test('translating text is light, translating code is not', () => {
  expect(predict('translate the abstract into Spanish').tier).toBe('light')
  expect(predict('translate this R function to Rust').tier).not.toBe('light')
})

test('explicit user words nudge but do not decide alone', () => {
  expect(predict('just do the analysis').tier).toBe('standard')
  expect(predict('thoroughly go through the results').tier).toBe('standard')
})

test('length and many files push toward deep', () => {
  const long = Array.from({ length: 600 }, () => 'word').join(' ')
  const p = predict(long)
  expect(p.tier).toBe('deep')
  expect(p.reasons.join(' ')).toContain('very long prompt')
  expect(predict(Array.from({ length: 300 }, () => 'word').join(' ')).tier).toBe('standard') // length alone is a nudge
  const many = predict('look at a.R b.R c.R d.R e.R and make them consistent')
  expect(many.tier).toBe('deep')
  expect(many.reasons.join(' ')).toContain('names 5 files')
})

test('code blocks make a prompt at least standard, never light', () => {
  const p = predict('rename\n```r\nx <- 1\n```\nand also write a test for it')
  expect(p.tier).toBe('standard')
})

test('namedFiles counts distinct paths and @mentions on any OS spelling', () => {
  expect(namedFiles('edit src/a.rs and src\\b.rs and @notes.md and src/a.rs')).toHaveLength(3)
  expect(namedFiles('fix typo in README')).toEqual([])
  expect(namedFiles('see "data/raw.csv", (R/fit.R)')).toHaveLength(2)
})

test('empty and odd input never throws', () => {
  for (const text of ['', '   ', '?', '```', '\n\n', 'a'.repeat(100_000)]) expect(() => predict(text)).not.toThrow()
})

test('a short question that leans on the conversation is not a plain lookup', () => {
  expect(predict('does this look right to you given the output above?').tier).toBe('standard')
  expect(predict('what is the difference between lapply and sapply?').tier).toBe('light')
})

test('a decided tier needs only a lead of 1: confidence 0.6 for a thin lead, 0.8 for a clear one', () => {
  // deep 3 (numerical method) against standard 2 (library + data handling): a lead of exactly 1
  const thin = predict('load the data with dplyr and check the convergence')
  expect(thin.tier).toBe('deep')
  expect(thin.confidence).toBe(0.6)
  // deep 4 and nothing against it: a lead of 4 (capped at 0.9 by the 0.5 + 0.1 x lead rule)
  expect(predict('the borrow checker complains').confidence).toBe(0.9)
  // light 3 against standard 2: lead 1, confidence 0.6
  const light = predict('rename the file reader and parse the data with dplyr')
  expect(light.tier).toBe('light')
  expect(light.confidence).toBe(0.6)
})

test('the new vocabulary names its cues in plain words', () => {
  expect(predict('the borrow checker rejects my lifetime annotations in this unsafe block').reasons).toEqual(expect.arrayContaining(['hard debugging', 'advanced Rust']))
  expect(predict('compare REML and ML for the unbalanced GWAS and explain how the kinship matrix enters').reasons).toContain('quantitative genetics')
  expect(predict('simulate a breeding program to compare selection index options').reasons).toContain('simulation')
  expect(predict('review the REML implementation in fit_reml.R').reasons).toContain('review of method code')
})

test('confidence is always rounded to two decimals', () => {
  for (const [, text] of TABLE) {
    const c = predict(text).confidence
    expect(Math.round(c * 100) / 100).toBe(c)
  }
})
