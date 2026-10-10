# Pindu.app (拼读)

[中文](./README.md) · [Install](./INSTALL.md) · [Contributing](./CONTRIBUTING.md) · [Security & privacy](./SECURITY.md)

Pindu is a desktop app for learning English vocabulary, built around phonics. Instead of memorizing a word as one block of letters, you first break it into chunks you can sound out (luggage → lug · gage), then learn the meaning and the spelling. Besides single words it handles phrases (give up, pick sb up), and you can study words in passages and video clips too. Explanations follow a learner profile: primary school, secondary school or adult.

It runs on macOS, Windows and Linux. Everything is stored on your own computer, there is no account, and AI and speech use API keys you bring yourself.

> The interface is in Simplified Chinese only for now.

![Home](docs/screenshots/home.png)

## Getting words in

Create a vocabulary book and describe what it's for ("taking a pet to the vet"); the AI suggests a few vocabulary topics for that scene, and you pick some to generate a word list. You can also describe what you want in your own words, type words in by hand, or drop in your own material (txt, md, srt, vtt, docx, pdf) and have it pick out the new words and the phrases worth learning as a whole.

Each entry then gets its IPA, syllables, phonics chunks and a few example sentences, from easy to harder; phrases are labelled by type (phrasal verb, collocation, idiom) and whether they can be split. If you don't like the examples, add more or regenerate. Vocabulary books, passages and videos share tags, and the sidebar groups related material by tag.

![Vocabulary book](docs/screenshots/wordbook.png)

## Practising

Create a study plan: pick vocabulary books, choose how many new words a day, and the schedule is laid out for you.

Every new word goes through three steps. First you see everything (phonics chunks, IPA, meaning, examples) and read along; then the English is hidden and you write it from memory; finally you only get the Chinese meaning and the sound and spell it from scratch.

![Word practice](docs/screenshots/practice.png)

When a word won't stick, open "AI 老师" (AI tutor) on the word card. Ask it to walk through the word: what it means, why it's spelled that way, other words that follow the same phonics pattern, how it's used, what it's easily confused with, and ways to remember it; then keep asking, like "can you give me another example?". Depth and detail follow the learner profile.

<table><tr>
<td width="50%"><img src="docs/screenshots/explain.png" alt="AI tutor explaining a word"></td>
<td width="50%"><img src="docs/screenshots/tutor.png" alt="Asking the AI tutor"></td>
</tr></table>

Reviews take care of themselves. Each word has a memory level, and the gap between reviews grows from 1 day to 3, 7, 14 and 30 days; a correct answer pushes it further out, a miss brings it back tomorrow. Today's reviews are already in today's task list when you open the app. Need a break? Pause the plan, and the rest of the schedule shifts when you resume.

![Plan detail](docs/screenshots/plan.png)

## Putting words back into text

Word lists alone are easy to forget, so there are passages too. Pick words you've studied and the AI plans the content, then writes a passage at your level with a sentence-by-sentence translation. Or import your own English material: the text stays exactly as it is, and only the translation and level are added.

Target words are highlighted while you read; click one to open its word card. For a sentence you don't follow, open "sentence analysis" to see its pattern, parts, grammar points and what it does in conversation, then ask the tutor about it. You can play the passage sentence by sentence or hide the text and just listen; the voice and reading style (teacher, natural, storytelling, …) are set in settings. Afterwards you can generate a comprehension set: cloze, multiple-choice and true/false questions are graded automatically, and open questions are scored by the AI with suggestions. Passages can be added to a study plan, one every few days.

![Passage reader](docs/screenshots/passage.png)

## Learning from video

Import a video with its subtitles and the AI plans how to cut it into scene-sized clips; preview and adjust them in the clip editor, then cut. Each clip can be studied line by line, shadowed with recording, or used for listen-and-write practice, and clips can go into a study plan. Search an English word in the video library to find every clip where it's said. The ffmpeg used for video processing ships with the app.

<sub>Screenshots use demo data.</sub>

## Installing

Download the installer for your system from the [Releases page](https://github.com/abbish/pindu/releases): `.dmg` for macOS, `-setup.exe` for Windows, AppImage, deb or rpm for Linux. The app isn't signed with an Apple or Microsoft developer certificate, so your system will stop it the first time you open it; allow it once (steps in [INSTALL.md](./INSTALL.md#1-下载安装包)). After that, new versions show up as a notice at the top of the window and install with one click, and each update is checked against the app's signing key before it's installed.

After installing, add your API keys in settings: AI works with any OpenAI-compatible endpoint (OpenRouter, MiniMax, Moonshot and DeepSeek are preset), and speech uses Volcengine's Doubao TTS. Without keys you can still build vocabulary books by hand, practise and see your stats; only the AI and audio parts are off.

Step-by-step instructions, upgrading and troubleshooting are in [INSTALL.md](./INSTALL.md) (Chinese). To build installers yourself, see [CONTRIBUTING.md](./CONTRIBUTING.md#本地打包).

## Privacy

There is no Pindu server and no usage tracking. The app only goes online in two cases: when you use AI or speech, the relevant content (words, sentences, material you imported, answers you wrote) goes straight to the provider you configured; and when it checks GitHub for a new version, which you can turn off in settings. API keys are stored in plain text in the local database and never written to logs. See [SECURITY.md](./SECURITY.md).

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
