# LLM Playground

LLM Playground is a browser-based chat UI for testing OpenAI-compatible APIs with a lightweight Vite + TypeScript stack.

It is designed for quick experimentation with models, prompts, tools, attachments, and structured outputs without needing a backend application.

## Highlights

- Multi-tab chat workspace with clone, close, and clear actions
- Per-tab model configuration for endpoint, model name, and API key
- Streaming responses over Server-Sent Events
- Support for reasoning content and tool call rendering
- Advanced request controls for system instructions, reasoning effort, sampling, stop sequences, and max tokens
- Tools editor with ready-to-use presets for web search and math
- Structured JSON output editor with response schema presets
- Attachment support for images, audio, PDF, TXT, CSV, and JSON files
- Voice recording through the browser microphone
- Local media library loaded from the `medialib/` folder
- Markdown rendering with sanitization via `marked` and `dompurify`
- Theme toggle and persistent local state with `localStorage`
- Chat export as JSON and request export as cURL
- Shareable URL parameters for model, endpoint, and API key

## Tech Stack

- Vite
- TypeScript
- `@cypherpotato/el` for DOM composition
- `marked` for Markdown parsing
- `dompurify` for HTML sanitization

## Project Structure

```text
.
|-- index.html
|-- medialib/
|-- src/
|   |-- api.ts
|   |-- main.ts
|   |-- markdown.ts
|   |-- storage.ts
|   |-- styles/
|   |   `-- app.css
|   `-- types.ts
|-- package.json
|-- tsconfig.json
`-- vite.config.ts
```

## Requirements

- Bun installed locally
- A valid API key for an OpenAI-compatible provider

## Getting Started

Install dependencies:

```bash
bun install
```

Start the development server:

```bash
bun run dev
```

Then open the local URL shown by Vite in your browser.

## Available Scripts

```bash
bun run dev
```

Starts the Vite development server.

```bash
bun run check-syntax
```

Runs TypeScript in no-emit mode to validate the project.

```bash
bun run build
```

Runs the syntax check and creates a production build.

## Build Process

The production build follows this sequence:

1. `tsc --noEmit` validates the TypeScript source.
2. `vite build` bundles the app for production.
3. The generated files are written to `dist/`.

Build the project with:

```bash
bun run build
```

Because the app is fully client-side, no server bundle is produced. You can deploy the contents of `dist/` to any static hosting provider.

## How It Works

- The UI runs entirely in the browser.
- Chat requests are sent directly from the browser to the configured API endpoint.
- Conversation state, tab state, and theme selection are persisted in `localStorage`.
- Media examples placed in `medialib/` are exposed in the in-app content library.

## Notes

- This project expects an OpenAI-compatible `/chat/completions` endpoint.
- API keys are entered in the browser and can also be shared through URL parameters, so use development or scoped credentials when appropriate.
- Microphone recording depends on browser support for `MediaRecorder` and user permission.
