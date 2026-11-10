"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
  drawSelection,
  gutterLineClass,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (code: string) => void;
  /** line highlighted because a gate is hovered (0: none) */
  hoverLine: number;
  /** line of the current error (0: none) */
  errorLine: number;
  /** line holding the caret while the editor has focus (0 when blurred) */
  onCaretLine: (line: number) => void;
};

// Colours of the prototype's regex highlighter, mapped onto Lezer tags.
const prototypeHighlight = HighlightStyle.define([
  { tag: t.comment, class: "tk-c" },
  { tag: [t.string, t.special(t.string)], class: "tk-s" },
  { tag: [t.number, t.bool, t.null], class: "tk-n" },
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.self], class: "tk-k" },
  { tag: t.meta, class: "tk-d" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], class: "tk-f" },
]);

// "qml." dimmed and the PennyLane name after it in ice blue, as in the prototype.
const qmlMatcher = new MatchDecorator({
  regexp: /\bqml\.([A-Za-z_]\w*)/g,
  decorate: (add, from, to, match) => {
    add(from, from + 4, Decoration.mark({ class: "tk-q" }));
    add(from + 4, to, Decoration.mark({ class: "tk-g" }));
    void match;
  },
});
const qmlNames = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = qmlMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = qmlMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

// Line highlights driven from outside (hovered gate, error line).
const setLines = StateEffect.define<{ hover: number; error: number }>();
const lines = StateField.define<{ hover: number; error: number }>({
  create: () => ({ hover: 0, error: 0 }),
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setLines) ? e.value : acc), v),
});
const lineDecorations = EditorView.decorations.compute([lines], (state) => {
  const { hover, error } = state.field(lines);
  const marks: [number, string][] = [];
  if (error > 0 && error <= state.doc.lines) marks.push([error, "lh-err"]);
  if (hover > 0 && hover <= state.doc.lines && hover !== error) marks.push([hover, "lh-hover"]);
  marks.sort((a, b) => a[0] - b[0]);
  const b = new RangeSetBuilder<Decoration>();
  for (const [n, cls] of marks) {
    const l = state.doc.line(n);
    b.add(l.from, l.from, Decoration.line({ class: cls }));
  }
  return b.finish();
});
const badMarker = new (class extends GutterMarker {
  elementClass = "bad";
})();
const errorGutter = gutterLineClass.compute([lines], (state) => {
  const { error } = state.field(lines);
  const b = new RangeSetBuilder<GutterMarker>();
  if (error > 0 && error <= state.doc.lines) b.add(state.doc.line(error).from, state.doc.line(error).from, badMarker);
  return b.finish();
});

const theme = EditorView.theme({ "&.cm-focused": { outline: "none" } }, { dark: true });

/** CodeMirror 6 editor styled like the prototype's editor. */
export function CodeEditor({ value, onChange, hoverLine, errorLine, onCaretLine }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onCaretLine });
  useEffect(() => {
    callbacks.current = { onChange, onCaretLine };
  });

  useEffect(() => {
    const caret = (v: EditorView) => (v.hasFocus ? v.state.doc.lineAt(v.state.selection.main.head).number : 0);
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          indentUnit.of("    "),
          EditorState.tabSize.of(4),
          python(),
          syntaxHighlighting(prototypeHighlight),
          qmlNames,
          lines,
          lineDecorations,
          errorGutter,
          theme,
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ "aria-label": "Code Python du circuit", spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
            if (u.docChanged || u.selectionSet || u.focusChanged) callbacks.current.onCaretLine(caret(u.view));
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is created once; `value` changes from outside are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value change (e.g. another fixture loaded): replace the document.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setLines.of({ hover: hoverLine, error: errorLine }) });
  }, [hoverLine, errorLine]);

  return <div ref={host} className="code" />;
}
