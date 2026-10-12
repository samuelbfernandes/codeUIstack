import { expect, test } from 'claude-code/testing'

import { addNames, notebookHasOutputs, parseNameStatus, parsePorcelain, personalColumns, planOf, stripNotebook } from '../hooks/detect'

test('planOf finds commit and add through chains, quotes and global options', () => {
  expect(planOf('git commit -m "a && git add ."')).toEqual({ commit: { isAll: false }, adds: [] })
  expect(planOf('cd x && git -C y add -A; git commit -am wip')).toEqual({ commit: { isAll: true }, adds: [{ isAll: true, isTrackedOnly: false, paths: [] }] })
  expect(planOf('GIT_X=1 git add a.csv "b c.csv" -- d')).toEqual({ commit: undefined, adds: [{ isAll: false, isTrackedOnly: false, paths: ['a.csv', 'b c.csv', 'd'] }] })
  expect(planOf('git add -n .').adds).toEqual([])
  expect(planOf('git add -p').adds).toEqual([])
  expect(planOf('git commit --all -m x').commit).toEqual({ isAll: true })
  expect(planOf('git commit -m "a" ').commit).toEqual({ isAll: false })
  expect(planOf('git commit -m wip --amend').commit).toEqual({ isAll: false })
  expect(planOf('git status && git push').commit).toBeUndefined()
  expect(planOf('echo hi')).toEqual({ commit: undefined, adds: [] })
})

test('parseNameStatus and parsePorcelain read the -z forms, renames and deletions', () => {
  expect(parseNameStatus('A\0a.csv\0M\0b.R\0R100\0old.R\0new.R\0D\0gone.R\0')).toEqual([
    { status: 'A', path: 'a.csv' },
    { status: 'M', path: 'b.R' },
    { status: 'R', path: 'new.R' },
  ])
  expect(parsePorcelain('?? new file.csv\0 M b.R\0R  new.R\0old.R\0 D gone\0')).toEqual([
    { x: '?', y: '?', path: 'new file.csv' },
    { x: ' ', y: 'M', path: 'b.R' },
    { x: 'R', y: ' ', path: 'new.R' },
  ])
})

test('addNames: dot, folders, globs, subfolder prefix', () => {
  expect(addNames('.', '', 'a/b.csv')).toBe(true)
  expect(addNames('.', 'sub', 'sub/b.csv')).toBe(true)
  expect(addNames('.', 'sub', 'other/b.csv')).toBe(false)
  expect(addNames('data', '', 'data/x/y.csv')).toBe(true)
  expect(addNames('data', '', 'database/y.csv')).toBe(false)
  expect(addNames('*.csv', '', 'a.csv')).toBe(true)
  expect(addNames('*.csv', '', 'd/a.csv')).toBe(false)
  expect(addNames('../x.csv', 'sub', 'x.csv')).toBe(true)
})

test('personalColumns: names that look personal, not plain name or filename', () => {
  expect(personalColumns('id,email,E-mail,SSN,dob,birth_date,Phone,home address,patient_id,MRN,first_name,lastName,surname,ip_address')).toHaveLength(13)
  expect(personalColumns('id,name,filename,username,hostname,score')).toEqual([])
  expect(personalColumns('﻿"Email";"x"')).toEqual(['Email'])
  expect(personalColumns('id\tphone')).toEqual(['phone'])
})

test('notebook outputs: detected, and stripped as nbformat writes', () => {
  const dirty = JSON.stringify({ cells: [{ cell_type: 'code', execution_count: 1, outputs: [], source: [] }] })
  expect(notebookHasOutputs(dirty)).toBe(true)
  expect(notebookHasOutputs(JSON.stringify({ cells: [{ cell_type: 'code', execution_count: null, outputs: [], source: [] }] }))).toBe(false)
  expect(notebookHasOutputs('not json')).toBe(false)
  expect(stripNotebook('not json')).toBeUndefined()
  const out = stripNotebook(JSON.stringify({ cells: [{ cell_type: 'code', execution_count: 1, outputs: [{ a: 1 }], source: ['é'] }], nbformat: 4 }))!
  expect(out).toBe('{\n "cells": [\n  {\n   "cell_type": "code",\n   "execution_count": null,\n   "outputs": [],\n   "source": [\n    "é"\n   ]\n  }\n ],\n "nbformat": 4\n}\n')
})
