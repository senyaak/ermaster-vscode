/**
 * Minimal XML support for the ERMaster .erm format.
 * ERMaster writes elements + text only (no attributes, no CDATA),
 * via a hand-rolled StringBuilder serializer — so this mirrors exactly that.
 */

export interface XmlElement {
  tag: string;
  children: XmlElement[];
  /** concatenated text content of direct text nodes */
  text: string;
}

/** Escape exactly like ERMaster's PersistentXmlImpl.escape(). */
export function escapeXml(s: string | null | undefined): string {
  if (s === null || s === undefined) {
    return '';
  }
  let out = '';
  for (const ch of s) {
    switch (ch) {
      case '<': out += '&lt;'; break;
      case '>': out += '&gt;'; break;
      case '"': out += '&quot;'; break;
      case "'": out += '&apos;'; break;
      case '&': out += '&amp;'; break;
      case '\r': out += '&#x0D;'; break;
      case '\n': out += '&#x0A;'; break;
      case '\t': out += '&#x09;'; break;
      default: out += ch;
    }
  }
  return out;
}

function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X'
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return isNaN(code) ? m : String.fromCodePoint(code);
    }
    switch (ent) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      case 'amp': return '&';
      default: return m;
    }
  });
}

/** Parse an XML document, returning the root element. Attributes are ignored. */
export function parseXml(input: string): XmlElement {
  let pos = 0;
  const len = input.length;

  function error(msg: string): never {
    throw new Error(`XML parse error at offset ${pos}: ${msg}`);
  }

  function skipMisc(): void {
    for (;;) {
      while (pos < len && /\s/.test(input[pos])) {
        pos++;
      }
      if (input.startsWith('<?', pos)) {
        const end = input.indexOf('?>', pos);
        if (end < 0) error('unterminated processing instruction');
        pos = end + 2;
      } else if (input.startsWith('<!--', pos)) {
        const end = input.indexOf('-->', pos);
        if (end < 0) error('unterminated comment');
        pos = end + 3;
      } else if (input.startsWith('<!', pos)) {
        const end = input.indexOf('>', pos);
        if (end < 0) error('unterminated declaration');
        pos = end + 1;
      } else {
        return;
      }
    }
  }

  function parseElement(): XmlElement {
    if (input[pos] !== '<') error('expected element');
    pos++;
    const nameEnd = input.slice(pos).search(/[\s/>]/);
    if (nameEnd <= 0) error('bad element name');
    const tag = input.slice(pos, pos + nameEnd);
    pos += nameEnd;
    // skip attributes (ERMaster writes none, but be lenient)
    while (pos < len && input[pos] !== '>' && !input.startsWith('/>', pos)) {
      pos++;
    }
    const el: XmlElement = { tag, children: [], text: '' };
    if (input.startsWith('/>', pos)) {
      pos += 2;
      return el;
    }
    pos++; // consume '>'

    for (;;) {
      if (pos >= len) error(`unterminated element <${tag}>`);
      if (input.startsWith('</', pos)) {
        const end = input.indexOf('>', pos);
        if (end < 0) error('unterminated closing tag');
        pos = end + 1;
        return el;
      }
      if (input.startsWith('<!--', pos)) {
        const end = input.indexOf('-->', pos);
        if (end < 0) error('unterminated comment');
        pos = end + 3;
        continue;
      }
      if (input[pos] === '<') {
        el.children.push(parseElement());
        continue;
      }
      const next = input.indexOf('<', pos);
      const stop = next < 0 ? len : next;
      const raw = input.slice(pos, stop);
      // ERMaster escapes real newlines/tabs as entities, so raw whitespace
      // between tags is always formatting — ignore it
      if (raw.trim() !== '') {
        el.text += unescapeXml(raw);
      }
      pos = stop;
    }
  }

  skipMisc();
  const root = parseElement();
  return root;
}

// ------------------------------------------------------------ read helpers
// These mirror XMLLoader's getElement/getStringValue but look at DIRECT
// children only (the writer's layout guarantees uniqueness at each level).

export function child(el: XmlElement | null, tag: string): XmlElement | null {
  if (!el) {
    return null;
  }
  for (const c of el.children) {
    if (c.tag === tag) {
      return c;
    }
  }
  return null;
}

export function childrenOf(el: XmlElement | null, tag: string): XmlElement[] {
  if (!el) {
    return [];
  }
  return el.children.filter((c) => c.tag === tag);
}

/** null when the element is absent, '' when present but empty — like XMLLoader. */
export function str(el: XmlElement | null, tag: string): string | null {
  const c = child(el, tag);
  if (!c) {
    return null;
  }
  return c.text;
}

export function strAll(el: XmlElement | null, tag: string): string[] {
  return childrenOf(el, tag).map((c) => c.text);
}

/** Serialize an element subtree back to ERMaster-style XML lines (used for raw passthrough). */
export function rawXml(el: XmlElement): string {
  if (el.children.length === 0) {
    return `<${el.tag}>${escapeXml(el.text)}</${el.tag}>\n`;
  }
  let inner = '';
  for (const c of el.children) {
    inner += rawXml(c);
  }
  return `<${el.tag}>\n${indent(inner)}</${el.tag}>\n`;
}

/**
 * ERMaster's PersistentXmlImpl.tab(): indents a block one level.
 * str = str.replaceAll("\n\t", "\n\t\t"); str = str.replaceAll("\n<", "\n\t<"); "\t" + str
 */
export function indent(block: string | null): string {
  if (block === null) {
    return 'null';
  }
  let s = block;
  s = s.split('\n\t').join('\n\t\t');
  s = s.split('\n<').join('\n\t<');
  return '\t' + s;
}
