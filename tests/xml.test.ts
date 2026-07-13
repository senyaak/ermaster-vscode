import { describe, expect, it } from 'vitest';
import { child, escapeXml, parseXml, str } from '../src/erm/xml';

describe('escapeXml', () => {
  it('escapes special characters like ERMaster', () => {
    expect(escapeXml('a<b>&"\'')).toBe('a&lt;b&gt;&amp;&quot;&apos;');
    expect(escapeXml('line1\nline2\ttab\rcr')).toBe('line1&#x0A;line2&#x09;tab&#x0D;cr');
    expect(escapeXml(null)).toBe('');
    expect(escapeXml(undefined)).toBe('');
  });
});

describe('parseXml', () => {
  it('parses elements and text', () => {
    const root = parseXml('<?xml version="1.0"?>\n<a>\n\t<b>hello</b>\n\t<c></c>\n</a>');
    expect(root.tag).toBe('a');
    expect(str(root, 'b')).toBe('hello');
    expect(str(root, 'c')).toBe('');
    expect(str(root, 'missing')).toBeNull();
  });

  it('unescapes entities including numeric', () => {
    const root = parseXml('<a><b>x&#x0A;y&amp;&lt;&gt;&quot;&apos;</b></a>');
    expect(str(root, 'b')).toBe('x\ny&<>"\'');
  });

  it('ignores whitespace-only formatting between tags', () => {
    const root = parseXml('<a>\n\t<b>\n\t\t<c>1</c>\n\t</b>\n</a>');
    expect(child(root, 'b')!.text).toBe('');
    expect(str(child(root, 'b'), 'c')).toBe('1');
  });

  it('skips comments', () => {
    const root = parseXml('<a><!-- comment --><b>1</b></a>');
    expect(str(root, 'b')).toBe('1');
  });
});
