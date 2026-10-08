# Pindu.app (拼读)

[中文](./README.md) · [Install](./INSTALL.md) · [Contributing](./CONTRIBUTING.md) · [Security & privacy](./SECURITY.md)

Pindu is a desktop app for learning English vocabulary, built around phonics. Instead of memorizing a word as one block of letters, you first break it into chunks you can sound out (luggage → lug · gage), then learn the meaning and the spelling. Explanations are written for primary-school kids by default; you can switch to a secondary-school or adult profile in settings.

It runs on macOS, Windows and Linux. Everything is stored on your own computer, there is no account, and AI and speech use API keys you bring yourself.

> The interface is in Simplified Chinese only for now.

![Home](docs/screenshots/home.png)

## Getting words in

Type words in by hand, tell the AI what you want to learn ("airport and hotel words") and let it draft a list, or drop in your own material (txt, md, srt, vtt, docx, pdf) and have it pick out the new words.

Each word then gets its IPA, syllables, phonics chunks and a few example sentences, from easy to harder. If you don't like them, add more or regenerate.

![Word book](docs/screenshots/wordbook.png)

## Practising

Create a study plan: pick word books, choose how many new words a day, and the schedule is laid out for you.

Every new word goes through three steps. First you see everything (phonics chunks, IPA, meaning, examples) and read along; then the English is hidden and you write it from memory; finally you only get the Chinese meaning and the sound and spell it from scratch. When a word won't stick, open "AI 讲解" for a memory hint and ask follow-up questions.

![Word practice](docs/screenshots/practice.png)

Reviews take care of themselves. Each word has a memory level, and the gap between reviews grows from 1 day to 3, 7, 14 and 30 days; a correct answer pushes it further out, a miss brings it back tomorrow. Today's reviews are already in today's task list when you open the app. Need a break? Pause the plan, and the rest of the schedule shifts when you resume.

![Plan detail](docs/screenshots/plan.png)

## Putting words back into text

Word lists alone are easy to forget, so there are passages too. Pick words you've studied and the AI plans the content, then writes a passage at your level with a sentence-by-sentence translation. Or import your own English material: the text stays exactly as it is, and only the translation and level are added.

Target words are highlighted while you read. You can play it sentence by sentence or hide the text and just listen. Afterwards you can generate a comprehension set: cloze, multiple-choice and true/false questions are graded automatically, and open questions are scored by the AI with suggestions. Passages can be added to a study plan, one every few days.

![Passage reader](docs/screenshots/passage.png)

<sub>Screenshots use demo data.</sub>

## Installing

There are no prebuilt installers. The app isn't code-signed, and an unsigned binary from a stranger isn't something you should have to trust, so you build it yourself with one command:

```bash
git clone https://github.com/abbish/pindu.git
cd pindu
./build.sh            # macOS / Linux
build.cmd             # Windows (double-clicking works too)
```

You need Node.js 20+, Rust and your platform's build tools first; `npm run package:check` tells you what's missing. After installing, add your API keys in settings: AI works with any OpenAI-compatible endpoint (OpenRouter, MiniMax, Moonshot and DeepSeek are preset), and speech uses Volcengine's Doubao TTS. Without keys you can still build word books by hand, practise and see your stats; only the AI and audio parts are off.

Step-by-step instructions, upgrading and troubleshooting are in [INSTALL.md](./INSTALL.md) (Chinese).

## Privacy

There is no Pindu server and no usage tracking. Content only leaves your machine when you use AI or speech, and then it goes straight to the provider you configured: words, sentences, material you imported, answers you wrote. API keys are stored in plain text in the local database and never written to logs. See [SECURITY.md](./SECURITY.md).

## Development

```bash
npm install
npm run agent:install   # first time only: dependencies of the built-in AI agent
npm run tauri:dev       # dev mode
npm run verify          # before committing: static checks plus frontend and backend tests
```

The UI is React 19 with shadcn/ui and Tailwind CSS v4, the shell is Tauri 2, and the backend is Rust with SQLite. All AI work goes through a bundled agent process (built on [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and compiled to a single binary with Bun). Model output is validated by tools and then checked again in Rust against the input; phonics analysis, for example, only accepts the words that were asked for and fills in any it missed.

How the code is layered, what's in the database and how each AI task runs are documented in [CLAUDE.md](./CLAUDE.md), which also serves as the guide for AI coding assistants and describes the code as it is today. The agent design is in [docs/agent-harness/](./docs/agent-harness/DESIGN.md). Most docs are in Chinese, but issues and pull requests in English are welcome.

Found a bug or have an idea? Open an [issue](https://github.com/abbish/pindu/issues). If you'd like to send code, read [CONTRIBUTING.md](./CONTRIBUTING.md) first. Please report security problems privately as described in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © 2023-2026 abbish and RedLark contributors
