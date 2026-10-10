import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFormOf } from './morphy.ts';
import cases from './cases.json' with { type: 'json' };

test('词形还原：与 Rust 端共用 cases.json', () => {
  for (const [token, base] of cases.forms) assert.ok(isFormOf(token, base), `${token} → ${base}`);
  for (const [token, base] of cases.not_forms) assert.ok(!isFormOf(token, base), `${token} ✗ ${base}`);
});

test('词组位置：标注的写法 + 连着出现可变形（与 Rust 端共用 cases.json）', async () => {
  const { phraseSpans, formMatchesPhrase } = await import('./phrase.ts');
  const words = (s: string) => s.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? [];
  for (const [text, phrase, forms, expected] of cases.phrases as [string, string, string[], boolean][]) {
    assert.equal(phraseSpans(words(text), phrase, forms).length > 0, expected, `${text} / ${phrase} / ${forms.join('|')}`);
  }
  for (const [form, phrase, expected] of cases.forms_check as [string, string, boolean][]) {
    assert.equal(formMatchesPhrase(form, phrase), expected, `${form} ~ ${phrase}`);
  }
});
