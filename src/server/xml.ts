/**
 * A lossless editor for the trusted template XML. Bun.XML validates the document,
 * but its object representation groups same-name children and loses run order.
 * Keep tokens in document order so untouched formatting/control markup survives.
 */
export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: (XmlNode | string)[];
  open: string;
  close: string;
}
export const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const unescapeXml = (value: string): string =>
  value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[entity];
  });

export function parseXml(source: string): XmlNode {
  Bun.XML.parse(source);
  const document: XmlNode = { name: "#document", attributes: {}, children: [], open: "", close: "" };
  const stack = [document];
  for (const token of source.match(/<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/g) ?? []) {
    const parent = stack[stack.length - 1];
    if (token.startsWith("</")) {
      const node = stack.pop()!;
      if (node.name !== token.slice(2, -1)) throw new Error("Unbalanced template XML");
      node.close = token;
    } else if (token.startsWith("<?") || token.startsWith("<!")) {
      parent.children.push(token);
    } else if (token.startsWith("<")) {
      const name = /^<([^\s/>]+)/.exec(token)![1];
      const attributes: Record<string, string> = {};
      for (const match of token.matchAll(/([^\s=]+)="([^"]*)"/g)) attributes[match[1]] = unescapeXml(match[2]);
      const node: XmlNode = { name, attributes, children: [], open: token, close: "" };
      parent.children.push(node);
      if (!token.endsWith("/>")) stack.push(node);
    } else parent.children.push(token);
  }
  if (stack.length !== 1) throw new Error("Unclosed template XML");
  return document;
}
export const serialize = (node: XmlNode): string =>
  node.open + node.children.map((child) => typeof child === "string" ? child : serialize(child)).join("") + node.close;
export const children = (node: XmlNode, name?: string): XmlNode[] =>
  node.children.filter((child): child is XmlNode =>
    typeof child !== "string" && (!name || child.name === name));
export function descendants(node: XmlNode, name: string): XmlNode[] {
  return children(node).flatMap((child) =>
    child.name === name ? [child, ...descendants(child, name)] : descendants(child, name));
}
export const child = (node: XmlNode, name: string): XmlNode => {
  const found = children(node, name)[0];
  if (!found) throw new Error(`Missing ${name} in ${node.name}`);
  return found;
};
export const clone = (node: XmlNode): XmlNode => structuredClone(node);
export function setAttribute(node: XmlNode, key: string, value: string | number): void {
  const text = String(value);
  if (node.attributes[key] === text) return;
  node.attributes[key] = text;
  const pattern = new RegExp(`(\\s${key}=")[^"]*(")`);
  node.open = pattern.test(node.open)
    ? node.open.replace(pattern, (_, start: string, end: string) => start + escapeXml(text) + end)
    : node.open.replace(/\/?>$/, (end) => ` ${key}="${escapeXml(text)}"${end}`);
}
export function setText(node: XmlNode, text: string): void {
  node.open = node.open.replace(/\/>$/, ">");
  node.close = `</${node.name}>`;
  node.children = [escapeXml(text)];
}
export function element(source: string): XmlNode {
  return children(parseXml(source))[0];
}
export function textContent(node: XmlNode): string {
  if (node.name === "hp:fwSpace") return "\u3000";
  if (node.name === "hp:tab") return "\t";
  return node.children.map((c) => typeof c === "string" ? unescapeXml(c) : textContent(c)).join("");
}
