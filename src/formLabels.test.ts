import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, it, expect } from "vitest";

// Every form control needs a name a screen reader can announce, and a visible
// <label> has to be wired to the control it captions — otherwise tapping the
// label does nothing and the field is read out as just "edit text". The app
// had ~60 fields like that; this scan keeps new ones from creeping back in.
//
// A control is named when it sits inside a <label>, has aria-label /
// aria-labelledby / title, or has an id that a <label htmlFor> in the same
// file points at. A caption for a GROUP of buttons isn't a label at all: give
// it an id and put role="group" aria-labelledby on the group.

const SRC = path.resolve(__dirname);
const CONTROLS = new Set(["input", "select", "textarea"]);

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return full.endsWith(".tsx") && !full.includes(".test.") ? [full] : [];
  });

type JsxTag = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

const attrText = (tag: JsxTag): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const a of tag.attributes.properties) {
    if (ts.isJsxAttribute(a)) {
      out[a.name.getText()] = a.initializer ? a.initializer.getText() : "true";
    } else {
      out["...spread"] = "true";
    }
  }
  return out;
};

const enclosingTags = (node: ts.Node): string[] => {
  const tags: string[] = [];
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p)) tags.push(p.openingElement.tagName.getText());
  }
  return tags;
};

const scan = (file: string): string[] => {
  const sf = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const where = (n: ts.Node) =>
    `${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const labelTargets = new Set<string>();
  const controls: Array<{ tag: JsxTag; attrs: Record<string, string> }> = [];
  const problems: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const open = node.openingElement;
      if (open.tagName.getText() === "label") {
        const attrs = attrText(open);
        if (attrs.htmlFor) labelTargets.add(attrs.htmlFor);
        else {
          // A wrapping label names whatever control it contains; `{children}`
          // is a wrapper component that receives the control from its caller.
          let wraps = false;
          const look = (n: ts.Node) => {
            if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
              const t = n.tagName.getText();
              if (CONTROLS.has(t) || t === "button") wraps = true;
            }
            if (ts.isJsxExpression(n) && n.expression?.getText() === "children")
              wraps = true;
            if (!wraps) ts.forEachChild(n, look);
          };
          node.children.forEach(look);
          if (!wraps)
            problems.push(
              `${where(node)} <label> captions nothing — add htmlFor, or make it a group caption`,
            );
        }
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (CONTROLS.has(node.tagName.getText()))
        controls.push({ tag: node, attrs: attrText(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  for (const { tag, attrs } of controls) {
    if (/hidden/.test(attrs.type || "")) continue;
    if (attrs["aria-label"] || attrs["aria-labelledby"] || attrs.title)
      continue;
    if (attrs["...spread"]) continue;
    const parents = enclosingTags(tag);
    // <Field label="…"> and friends wrap their children in a <label>.
    if (parents.some((t) => t === "label" || /^(Field|Labeled)/.test(t)))
      continue;
    // `id={id}`: the id comes from the caller, which owns the <label>.
    if (attrs.id === "{id}") continue;
    // Compare the bare expression, so a label that only points at the control
    // while it is rendered (`htmlFor={cond ? id : undefined}`) still matches.
    const idExpr = (attrs.id || "").replace(/^\{|\}$/g, "");
    if (idExpr && [...labelTargets].some((target) => target.includes(idExpr)))
      continue;
    problems.push(
      `${where(tag)} <${tag.tagName.getText()}> has no label — link one with htmlFor/id, or add aria-label`,
    );
  }
  return problems;
};

describe("form controls", () => {
  it("each has an accessible name, and each <label> is wired to a control", () => {
    const problems = sourceFiles(SRC).flatMap(scan);
    expect(problems).toEqual([]);
  });
});
