# Apex Language Basics

Registers the Apex languages and provides basic syntax highlighting for **SIID**:

- `apex` — Apex classes and triggers (`.cls`, `.trigger`)
- `apex-anon` — Anonymous Apex scripts (`.apex`)

The grammar in `syntaxes/apex.tmLanguage.json` is a **basic** hand-written
grammar (keywords, types, annotations, strings, numbers, comments, inline SOQL).
It is intended to be replaced later by the official Apex TextMate grammar
(`forcedotcom/apex-tmLanguage`).

> Note: this is static (no build step). Registering `apex` for `.cls` also
> requires removing `.cls` from the built-in `latex` extension so Apex wins the
> file association. LWC files need no new language — `.html`/`.js` are handled by
> the built-in HTML/JavaScript extensions.
