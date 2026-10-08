# Pindu.app (拼读)

[中文](./README.md) · [Install](./INSTALL.md) · [Contributing](./CONTRIBUTING.md) · [Security & privacy](./SECURITY.md)

Pindu.app (拼读) is an open-source desktop app by RedLark for learning English vocabulary, built for kids and adult self-learners. AI breaks words down with phonics, explains them and writes example sentences; a spaced-repetition schedule decides what to review; and AI-written stories or your own reading material put the words back into context for reading and listening practice.

Runs on macOS, Windows and Linux. Your learning data lives in a local SQLite database — no account required. AI and speech use your own API keys.

> The user interface is currently in Simplified Chinese only.

![Pindu.app home: study plans, statistics and activity heatmap](docs/screenshots/home.png)

## Features

**Word books**

- Three ways to build a book: type words in; describe what you want to learn and let AI generate the list; or extract new words from your own material (txt / md / srt / vtt / docx / pdf, or pasted text).
- AI phonics analysis: IPA, syllable split, phonics rules, meanings and graded example sentences, which you can extend or regenerate.
- Word explanations and an AI tutor: one explanation per word (with memory tips), and you can keep asking follow-up questions.

**Study plans and practice**

- Pick word books and a daily number of new words; the schedule is generated for you. Reviews are placed daily by memory level (1 / 3 / 7 / 14 / 30 days); words you miss come back sooner.
- Three-step practice: full information → English hidden → spell it from the Chinese meaning, syllables and pronunciation only.
- Plans can be paused and resumed (the schedule shifts automatically), extended with more word books, and re-paced at any time.
- Activity heatmap, calendar view, plan statistics and practice history.

**Passages**

- AI-written passages: pick target words from a word book or plan; AI first plans the content (one passage or several), then writes level-appropriate text with sentence-by-sentence translation.
- Import your own material: lessons, subtitles, articles. The original text is kept as is; AI only translates each sentence, suggests a title, estimates the level and marks key words. New words can be turned into a word book in one click.
- Comprehension questions: cloze, multiple choice, true/false and open questions. Objective questions are graded automatically; open answers are scored by AI with suggestions for improvement.
- Reading or listening mode, sentence-by-sentence read-aloud, and a focus mode that highlights only the current sentence.
- Passages can be added to a study plan and scheduled every N days.

**Personalization**

- Learner profile presets (primary school / secondary school / adult) with adjustable English level, explanation language, phonetic notation, detail level and tutor style.
- Different models per task; light / dark / system theme.

## Screenshots

<table>
  <tr><td width="50%"><img src="docs/screenshots/practice.png" alt="Word practice: phonics chunks, IPA, examples"><br>Word practice: phonics chunks, IPA, examples</td><td width="50%"><img src="docs/screenshots/passage.png" alt="Passage reader: target words, read-aloud"><br>Passage reader: target words, read-aloud</td></tr>
  <tr><td width="50%"><img src="docs/screenshots/plan.png" alt="Plan detail: memory levels and daily schedule"><br>Plan detail: memory levels and daily schedule</td><td width="50%"><img src="docs/screenshots/wordbook.png" alt="Word book: AI phonics analysis"><br>Word book: AI phonics analysis</td></tr>
</table>

Screenshots use demo data.

## Install

The app is not code-signed, so there are no prebuilt installers. Build it on your own machine with one command:

```bash
git clone https://github.com/abbish/pindu.git
cd pindu
./build.sh            # macOS / Linux
build.cmd             # Windows (or double-click it)
```

You need Node.js 20+, Rust, and your platform's build tools; `npm run package:check` tells you what is missing.
Installers end up in `release/`. Full steps, first-run setup of AI and speech, upgrading and FAQ: **[INSTALL.md](./INSTALL.md)** (in Chinese).

## Services you bring

| Used for | Service | Required? |
|---|---|---|
| Phonics analysis, examples, explanations, passages, translation, question generation and grading | Any OpenAI-compatible LLM API (presets for OpenRouter, MiniMax, Moonshot, DeepSeek and more) | For AI features |
| Word and sentence pronunciation | [Volcengine Doubao TTS](https://www.volcengine.com/product/tts) | For audio |

Without them you can still create word books by hand, build plans, practice and view statistics.

## Privacy

- Word books, study history and settings are stored in the local app data directory. There is no server and no usage data is collected.
- When you use AI or speech, the relevant content (words, sentences, imported material, your written answers) is sent directly to **the provider you configured** and handled under its privacy policy.
- API keys are stored in plain text in the local database and never written to logs. See [SECURITY.md](./SECURITY.md).

## Development

```bash
npm install
npm run agent:install   # dependencies of the built-in AI agent sidecar (first time only)
npm run tauri:dev       # dev mode: frontend HMR + automatic Rust rebuilds
npm run verify          # pre-commit check: static checks + frontend and backend tests
```

| Layer | Stack |
|---|---|
| UI | React 19 · TypeScript · Vite · shadcn/ui · Tailwind CSS v4 |
| Desktop shell | Tauri 2 |
| Backend | Rust · tokio · SQLite (sqlx, migrations run on startup) |
| AI | Built-in agent ([pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) RPC sidecar compiled to a single binary with Bun); model output is validated by tools and re-checked in Rust |
| Speech | Volcengine Doubao TTS with a local audio cache |

Architecture, layering rules, database and AI task details are in [CLAUDE.md](./CLAUDE.md) (which doubles as the guide for AI coding assistants); the agent design is in [docs/agent-harness/](./docs/agent-harness/DESIGN.md). Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before sending changes. Most project docs are written in Chinese; issues and pull requests in English are welcome.

## License

[MIT](./LICENSE) © 2023-2026 abbish and RedLark contributors
