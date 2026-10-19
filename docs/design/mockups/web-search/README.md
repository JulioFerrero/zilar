# Web search keys (approved 2026-10-19)

Julio approved this design on 2026-10-19 ("the canva looks great") on the canvas https://claude.ai/artifact/9wDLt9GpmXNZZ2s2JWNu85. The canvas is private, so these files are the copy workers read. They are D24 only (`docs/design/ui-style.md`) and extend the approved Connections boards (`../connections/`).

## Boards
- **`AddKey.dc.html`:** the web Add key dialog, step 1 · Provider, with the dropdown open. Two groups:
  - **Models:** the existing catalog list, with a green dot when a key is added. DeepSeek is tagged `Search · Read` in mono.
  - **Web search:** Brave Search (`Search`), Exa, Firecrawl, Jina and Tavily (`Search · Read`). The chosen row has a check.

  The steps are Provider and Key, and the Key step is the existing one.
- **`Connections.dc.html`:** the web Connections page with two sections:
  - **Models,** for example DeepSeek, `Personal key · Model, search, read · Oct 12`;
  - **Web search,** with the muted hint "for AIs whose model has none". Rows such as Brave Search (`Search · Oct 19`), and a failing key shown with the red reason (`Key rejected · Read · Oct 19`).

  Rows, dots, ⋮ keys and the menu are the Connections board's.
- **`PhoneAddKey.dc.html`:** the phone Add key sheet, the same two groups as 48 px rows, with a 40 px close key.
- **`PhoneConnections.dc.html`:** the phone Connections screen with the Models and Web search cards. The hint sits on the section label.

## Rules
- **Which source an AI uses:** an AI uses its model provider's own search and read when that provider has them (DeepSeek today). Otherwise it uses the owner's first working Web search key that has the capability.
- **Where providers appear:** web search providers show only in Connections' Add key, never in the New AI provider step.
- **Status:** the dot is the status, as in Connections.
- **Kit sizes:** the same as the Connections README.
